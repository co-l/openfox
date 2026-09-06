/**
 * Project Tasks Database Operations
 *
 * Low-level SQL for the project-scoped task board: tasks, task↔session links,
 * per-project gate config, per-task gate values, the audit trail, and the
 * project task settings (slot limit, queue pause).
 *
 * All business logic (transition enforcement, gate checks, slot allocation,
 * reminders, broadcasts) lives in src/server/tasks/service.ts — this module
 * only reads and writes rows.
 */

import { randomBytes } from 'node:crypto'
import type {
  ProjectTask,
  TaskGateConfig,
  TaskGateValue,
  TaskAuditEntry,
  TaskStatus,
  TaskRunState,
  TaskActor,
  ProjectTaskSettings,
  Attachment,
} from '../../shared/types.js'
import { getDatabase } from './index.js'

// ============================================================================
// Row Types
// ============================================================================

interface TaskRow {
  id: string
  project_id: string
  prompt: string
  attachments: string
  status: string
  run_state: string | null
  position: number
  version: number
  agent_id: string | null
  provider_id: string | null
  model: string | null
  workflow_choice?: string | null
  created_at: string
  updated_at: string
}

interface TaskLinkRow {
  task_id: string
  session_id: string
  active: number
  created_at: string
}

interface TaskGateRow {
  id: string
  project_id: string
  name: string
  description: string
  required: number
  variant: string
  sort_order: number
  created_at: string
}

interface TaskGateValueRow {
  id: string
  task_id: string
  gate_id: string
  value: string
  actor: string
  actor_name: string | null
  session_id: string | null
  created_at: string
}

interface TaskAuditRow {
  id: string
  task_id: string
  actor: string
  actor_name: string | null
  action: string
  detail: string
  created_at: string
}

// ============================================================================
// Task CRUD
// ============================================================================

export interface CreateTaskInput {
  prompt: string
  attachments?: Attachment[]
  agentId?: string
  providerId?: string
  model?: string
}

export function createTask(projectId: string, input: CreateTaskInput): ProjectTask {
  const db = getDatabase()
  const now = new Date().toISOString()
  const id = randomBytes(8).toString('hex')

  const position = db
    .prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM tasks WHERE project_id = ? AND status = 'backlog'`)
    .get(projectId) as { pos: number }

  db.prepare(
    `INSERT INTO tasks (id, project_id, prompt, attachments, status, run_state, position, version, agent_id, provider_id, model, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'backlog', NULL, ?, 1, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    projectId,
    input.prompt,
    JSON.stringify(input.attachments ?? []),
    position.pos,
    input.agentId ?? null,
    input.providerId ?? null,
    input.model ?? null,
    now,
    now,
  )

  return getTask(id)!
}

export function getTask(id: string): ProjectTask | null {
  const db = getDatabase()
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as TaskRow | undefined
  if (!row) return null
  return hydrateTask(row)
}

export function listTasks(projectId: string): ProjectTask[] {
  const db = getDatabase()
  const rows = db.prepare(`SELECT * FROM tasks WHERE project_id = ? ORDER BY position ASC`).all(projectId) as TaskRow[]
  return rows.map(hydrateTask)
}

export function updateTask(
  id: string,
  patch: {
    prompt?: string
    attachments?: Attachment[]
    agentId?: string | null
    providerId?: string | null
    model?: string | null
  },
): ProjectTask | null {
  const db = getDatabase()
  const now = new Date().toISOString()

  const sets: string[] = ['updated_at = ?', 'version = version + 1']
  const values: (string | number | null)[] = [now]

  if (patch.prompt !== undefined) {
    sets.push('prompt = ?')
    values.push(patch.prompt)
  }
  if (patch.attachments !== undefined) {
    sets.push('attachments = ?')
    values.push(JSON.stringify(patch.attachments))
  }
  if (patch.agentId !== undefined) {
    sets.push('agent_id = ?')
    values.push(patch.agentId)
  }
  if (patch.providerId !== undefined) {
    sets.push('provider_id = ?')
    values.push(patch.providerId)
  }
  if (patch.model !== undefined) {
    sets.push('model = ?')
    values.push(patch.model)
  }

  values.push(id)
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  return getTask(id)
}

export function setTaskStatus(id: string, status: TaskStatus): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  db.prepare(`UPDATE tasks SET status = ?, run_state = NULL, version = version + 1, updated_at = ? WHERE id = ?`).run(
    status,
    now,
    id,
  )
}

export function setTaskRunState(id: string, runState: TaskRunState | null): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  db.prepare(`UPDATE tasks SET run_state = ?, version = version + 1, updated_at = ? WHERE id = ?`).run(
    runState,
    now,
    id,
  )
}

/** Persist the workflow picked for a task after planning (null clears it). */
export function setTaskWorkflowChoice(id: string, workflowId: string | null): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  db.prepare(`UPDATE tasks SET workflow_choice = ?, version = version + 1, updated_at = ? WHERE id = ?`).run(
    workflowId,
    now,
    id,
  )
}

export function deleteTask(id: string): void {
  const db = getDatabase()
  db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id)
}

/**
 * Append a task to the bottom of a column. Used when a task enters the
 * In Progress queue so the FIFO order (oldest first, by position) matches
 * the visible stacking and the per-task queue position.
 */
export function appendToBottom(id: string, status: TaskStatus): void {
  const db = getDatabase()
  const task = getTask(id)
  if (!task) return
  const row = db
    .prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM tasks WHERE project_id = ? AND status = ?`)
    .get(task.projectId, status) as { pos: number }
  db.prepare(`UPDATE tasks SET position = ?, version = version + 1, updated_at = ? WHERE id = ?`).run(
    row.pos,
    new Date().toISOString(),
    id,
  )
}

export function cloneTask(sourceId: string): ProjectTask | null {
  const source = getTask(sourceId)
  if (!source) return null
  return createTask(source.projectId, {
    prompt: source.prompt,
    attachments: source.attachments,
    ...(source.agentId ? { agentId: source.agentId } : {}),
    ...(source.providerId ? { providerId: source.providerId } : {}),
    ...(source.model ? { model: source.model } : {}),
  })
}

/**
 * Reorder a task within its column. Moves it to the given index (0-based)
 * among siblings of the same status.
 */
export function reorderTask(id: string, status: TaskStatus, toIndex: number): void {
  const db = getDatabase()
  const task = getTask(id)
  if (!task) return

  const rows = db
    .prepare(`SELECT id FROM tasks WHERE project_id = ? AND status = ? ORDER BY position ASC, created_at ASC`)
    .all(task.projectId, status) as { id: string }[]
  const ids = rows.map((r) => r.id).filter((tid) => tid !== id)
  const clamped = Math.max(0, Math.min(toIndex, ids.length))
  ids.splice(clamped, 0, id)

  const update = db.prepare(`UPDATE tasks SET position = ?, version = version + 1, updated_at = ? WHERE id = ?`)
  const now = new Date().toISOString()
  for (const [idx, tid] of ids.entries()) {
    update.run(idx, now, tid)
  }
}

// ============================================================================
// Task ↔ Session links
// ============================================================================

export function addTaskLink(taskId: string, sessionId: string, active: boolean): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  db.prepare(`INSERT OR IGNORE INTO task_links (task_id, session_id, active, created_at) VALUES (?, ?, ?, ?)`).run(
    taskId,
    sessionId,
    active ? 1 : 0,
    now,
  )
  if (active) {
    db.prepare(`UPDATE task_links SET active = 0 WHERE task_id = ? AND session_id != ?`).run(taskId, sessionId)
    db.prepare(`UPDATE task_links SET active = 1 WHERE task_id = ? AND session_id = ?`).run(taskId, sessionId)
  }
}

export function listTaskLinks(taskId: string): TaskLinkRow[] {
  const db = getDatabase()
  return db.prepare(`SELECT * FROM task_links WHERE task_id = ? ORDER BY created_at ASC`).all(taskId) as TaskLinkRow[]
}

export function clearActiveTaskLink(taskId: string): void {
  const db = getDatabase()
  db.prepare(`UPDATE task_links SET active = 0 WHERE task_id = ?`).run(taskId)
}

/** Most recently linked task for a session (board lookup from the session side). */
export function findTaskIdBySession(sessionId: string): string | null {
  const db = getDatabase()
  const row = db
    .prepare(`SELECT task_id FROM task_links WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(sessionId) as { task_id: string } | undefined
  return row?.task_id ?? null
}

/** Drop a link entirely (revert to To Do) or all links (task deleted). */
export function removeTaskLinks(taskId: string, sessionId?: string): void {
  const db = getDatabase()
  if (sessionId) {
    db.prepare(`DELETE FROM task_links WHERE task_id = ? AND session_id = ?`).run(taskId, sessionId)
  } else {
    db.prepare(`DELETE FROM task_links WHERE task_id = ?`).run(taskId)
  }
}

// ============================================================================
// Gates
// ============================================================================

export function getGateConfig(projectId: string): TaskGateConfig[] {
  const db = getDatabase()
  const rows = db
    .prepare(`SELECT * FROM task_gates WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC`)
    .all(projectId) as TaskGateRow[]
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    required: Boolean(r.required),
    variant: r.variant === 'ready' ? 'ready' : 'done',
  }))
}

export function replaceGateConfig(projectId: string, gates: TaskGateConfig[]): TaskGateConfig[] {
  const db = getDatabase()
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM task_gates WHERE project_id = ?`).run(projectId)
    const insert = db.prepare(
      `INSERT INTO task_gates (id, project_id, name, description, required, variant, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const now = new Date().toISOString()
    gates.forEach((gate, i) => {
      insert.run(gate.id, projectId, gate.name, gate.description, gate.required ? 1 : 0, gate.variant, i, now)
    })
    // Prune values for gates that no longer exist, so removed gates never
    // leave orphaned evidence chips on tasks.
    const keepIds = gates.map((g) => g.id)
    const prune = db.prepare(
      `DELETE FROM task_gate_values
       WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)
         AND gate_id NOT IN (${keepIds.map(() => '?').join(', ') || "''"})`,
    )
    prune.run(projectId, ...keepIds)
  })
  tx()
  return getGateConfig(projectId)
}

export function getGateValues(taskId: string): TaskGateValue[] {
  const db = getDatabase()
  const rows = db
    .prepare(`SELECT * FROM task_gate_values WHERE task_id = ? ORDER BY created_at ASC`)
    .all(taskId) as TaskGateValueRow[]
  return rows.map((r) => ({
    gateId: r.gate_id,
    value: r.value,
    actor: r.actor as TaskActor,
    ...(r.actor_name ? { actorName: r.actor_name } : {}),
    ...(r.session_id ? { sessionId: r.session_id } : {}),
    timestamp: r.created_at,
  }))
}

export function setGateValue(
  taskId: string,
  gateId: string,
  value: string,
  actor: TaskActor,
  actorName?: string,
  sessionId?: string,
): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  db.prepare(`DELETE FROM task_gate_values WHERE task_id = ? AND gate_id = ?`).run(taskId, gateId)
  db.prepare(
    `INSERT INTO task_gate_values (id, task_id, gate_id, value, actor, actor_name, session_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), taskId, gateId, value, actor, actorName ?? null, sessionId ?? null, now)
  db.prepare(`UPDATE tasks SET version = version + 1, updated_at = ? WHERE id = ?`).run(now, taskId)
}

// ============================================================================
// Audit trail
// ============================================================================

export function addAuditEntry(
  taskId: string,
  actor: TaskActor,
  action: string,
  detail: string,
  actorName?: string,
): void {
  const db = getDatabase()
  db.prepare(
    `INSERT INTO task_audit (id, task_id, actor, actor_name, action, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), taskId, actor, actorName ?? null, action, detail, new Date().toISOString())
}

export function getAuditTrail(taskId: string): TaskAuditEntry[] {
  const db = getDatabase()
  const rows = db
    .prepare(`SELECT * FROM task_audit WHERE task_id = ? ORDER BY created_at ASC`)
    .all(taskId) as TaskAuditRow[]
  return rows.map((r) => ({
    id: r.id,
    timestamp: r.created_at,
    actor: r.actor as TaskActor,
    ...(r.actor_name ? { actorName: r.actor_name } : {}),
    action: r.action,
    detail: r.detail,
  }))
}

// ============================================================================
// Project settings
// ============================================================================

export function getTaskSettings(projectId: string): ProjectTaskSettings {
  const db = getDatabase()
  const row = db.prepare(`SELECT * FROM project_task_settings WHERE project_id = ?`).get(projectId) as
    { slot_limit: number; queue_paused: number } | undefined
  if (!row) return { slotLimit: 1, queuePaused: false }
  return { slotLimit: row.slot_limit, queuePaused: Boolean(row.queue_paused) }
}

export function setTaskSettings(projectId: string, settings: Partial<ProjectTaskSettings>): ProjectTaskSettings {
  const db = getDatabase()
  const current = getTaskSettings(projectId)
  const slotLimit = settings.slotLimit ?? current.slotLimit
  const queuePaused = settings.queuePaused ?? current.queuePaused
  db.prepare(
    `INSERT INTO project_task_settings (project_id, slot_limit, queue_paused) VALUES (?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET slot_limit = excluded.slot_limit, queue_paused = excluded.queue_paused`,
  ).run(projectId, slotLimit, queuePaused ? 1 : 0)
  return { slotLimit, queuePaused }
}

// ============================================================================
// Hydration
// ============================================================================

function hydrateTask(row: TaskRow): ProjectTask {
  const links = listTaskLinks(row.id)
  const sessionIds = links.map((l) => l.session_id)
  const activeLink = links.find((l) => Boolean(l.active))
  const runState = row.status === 'in_progress' ? (row.run_state as TaskRunState) : undefined
  const task: ProjectTask = {
    id: row.id,
    projectId: row.project_id,
    prompt: row.prompt,
    attachments: safeParseAttachments(row.attachments),
    status: row.status as TaskStatus,
    ...(runState ? { runState } : {}),
    position: row.position,
    version: row.version,
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    ...(row.provider_id ? { providerId: row.provider_id } : {}),
    ...(row.model ? { model: row.model } : {}),
    ...(row.workflow_choice ? { workflowChoice: row.workflow_choice } : {}),
    sessionIds,
    ...(activeLink ? { activeSessionId: activeLink.session_id } : {}),
    gateValues: getGateValues(row.id),
    auditTrail: getAuditTrail(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  return withQueuePosition(task)
}

/**
 * Attach the 1-based queue position for queued In Progress tasks. Computed
 * server-side (FIFO by position) so the agent tool and the modal read the
 * same server truth — queue positions are never client-side only.
 */
function withQueuePosition(task: ProjectTask): ProjectTask {
  if (task.status !== 'in_progress' || task.runState !== 'queued') return task
  try {
    const db = getDatabase()
    const rows = db
      .prepare(
        `SELECT id FROM tasks WHERE project_id = ? AND status = 'in_progress' AND run_state = 'queued'
         ORDER BY position ASC, created_at ASC`,
      )
      .all(task.projectId) as { id: string }[]
    const rank = rows.findIndex((r) => r.id === task.id)
    if (rank < 0) return task
    return { ...task, queuePosition: rank + 1 }
  } catch {
    return task
  }
}

function safeParseAttachments(raw: string): Attachment[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Attachment[]) : []
  } catch {
    return []
  }
}
