/**
 * Session Database Operations
 *
 * Manages session metadata in SQLite. Session content (messages, criteria, todos)
 * is stored in the events table and derived via EventStore folding.
 */

import type { Session, SessionSummary, SessionMode, SessionPhase } from '../../shared/types.js'
import { getDatabase } from './index.js'
import { resolveDefaultAgentId } from '../agents/registry.js'
export type DangerLevel = 'normal' | 'dangerous'

function getProjectDangerLevel(projectId: string): DangerLevel {
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT danger_level FROM projects WHERE id = ?').get(projectId) as
      { danger_level: string | null } | undefined
    return (row?.danger_level as DangerLevel) ?? 'normal'
  } catch {
    return 'normal'
  }
}

// ============================================================================
// Session Operations
// ============================================================================

export function createSession(
  projectId: string,
  workdir: string,
  title?: string,
  providerId?: string | null,
  providerModel?: string | null,
  workspace?: string,
  branch?: string,
): Session {
  const db = getDatabase()
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  const dangerLevel = getProjectDangerLevel(projectId)

  const defaultAgent = resolveDefaultAgentId(projectId)

  db.prepare(
    `
    INSERT INTO sessions (id, project_id, workdir, workspace, branch, phase, mode, workflow_phase, is_running, created_at, updated_at, title, provider_id, provider_model, danger_level)
    VALUES (?, ?, ?, ?, ?, 'idle', ?, 'plan', 0, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    id,
    projectId,
    workdir,
    workspace ?? null,
    branch ?? null,
    defaultAgent,
    now,
    now,
    title ?? null,
    providerId ?? null,
    providerModel ?? null,
    dangerLevel,
  )

  return {
    id,
    projectId,
    workdir,
    ...(workspace ? { workspace } : {}),
    ...(branch ? { branch } : {}),
    mode: defaultAgent,
    phase: 'plan',
    isRunning: false,
    providerId: providerId ?? null,
    providerModel: providerModel ?? null,
    createdAt: now,
    updatedAt: now,
    messages: [],
    criteria: [],
    contextWindows: [],
    executionState: null,
    metadata: {
      ...(title ? { title } : {}),
      totalTokensUsed: 0,
      totalToolCalls: 0,
      iterationCount: 0,
    },
    metadataEntries: {},
    dangerLevel,
  }
}

export function getSession(id: string): Session | null {
  const db = getDatabase()

  const row = db
    .prepare(
      `
    SELECT * FROM sessions WHERE id = ?
  `,
    )
    .get(id) as SessionRow | undefined

  if (!row) {
    return null
  }

  // Note: messages, criteria, contextWindows, executionState are derived from EventStore
  // This function returns the DB row data only - caller should enrich with event data
  return {
    ...mapSessionBase(row),
    ...(row.branch ? { branch: row.branch } : {}),
    messages: [],
    criteria: [],
    contextWindows: [],
    executionState: null,
    metadata: {
      ...(row.title ? { title: row.title } : {}),
      totalTokensUsed: row.total_tokens_used,
      totalToolCalls: row.total_tool_calls,
      iterationCount: row.iteration_count,
    },
    metadataEntries: {},
    dangerLevel: (row.danger_level ?? 'normal') as DangerLevel,
  }
}

export function updateSessionProvider(id: string, providerId: string | null, providerModel: string | null): void {
  const db = getDatabase()
  const now = new Date().toISOString()

  db.prepare(
    `
    UPDATE sessions SET provider_id = ?, provider_model = ?, updated_at = ? WHERE id = ?
  `,
  ).run(providerId, providerModel, now, id)
}

export function updateSessionMode(id: string, mode: SessionMode): void {
  const db = getDatabase()
  const now = new Date().toISOString()

  db.prepare(
    `
    UPDATE sessions SET mode = ?, updated_at = ? WHERE id = ?
  `,
  ).run(mode, now, id)
}

export function updateSessionDangerLevel(id: string, dangerLevel: DangerLevel): void {
  const db = getDatabase()
  const now = new Date().toISOString()

  db.prepare(
    `
    UPDATE sessions SET danger_level = ?, updated_at = ? WHERE id = ?
  `,
  ).run(dangerLevel, now, id)
}

export function updateSessionPhase(id: string, phase: SessionPhase): void {
  const db = getDatabase()
  const now = new Date().toISOString()

  db.prepare(
    `
    UPDATE sessions SET workflow_phase = ?, updated_at = ? WHERE id = ?
  `,
  ).run(phase, now, id)
}

export function updateSessionRunning(id: string, isRunning: boolean): void {
  const db = getDatabase()
  const now = new Date().toISOString()

  db.prepare(
    `
    UPDATE sessions SET is_running = ?, updated_at = ? WHERE id = ?
  `,
  ).run(isRunning ? 1 : 0, now, id)
}

export function updateSessionMetadata(id: string, metadata: Partial<Session['metadata']>): void {
  const db = getDatabase()
  const now = new Date().toISOString()

  const updates: string[] = ['updated_at = ?']
  const values: (string | number)[] = [now]

  if (metadata.title !== undefined) {
    updates.push('title = ?')
    values.push(metadata.title ?? '')
  }
  if (metadata.totalTokensUsed !== undefined) {
    updates.push('total_tokens_used = ?')
    values.push(metadata.totalTokensUsed)
  }
  if (metadata.totalToolCalls !== undefined) {
    updates.push('total_tool_calls = ?')
    values.push(metadata.totalToolCalls)
  }
  if (metadata.iterationCount !== undefined) {
    updates.push('iteration_count = ?')
    values.push(metadata.iterationCount)
  }

  values.push(id)

  db.prepare(
    `
    UPDATE sessions SET ${updates.join(', ')} WHERE id = ?
  `,
  ).run(...values)
}

export function updateSessionMcpDisabledServers(id: string, disabledServers: string[]): void {
  const db = getDatabase()
  const value = disabledServers.length > 0 ? JSON.stringify(disabledServers) : null
  db.prepare(`UPDATE sessions SET mcp_disabled_servers = ? WHERE id = ?`).run(value, id)
}

export function updateSessionCachedPrompt(
  id: string,
  systemPrompt: string,
  tools: import('../llm/types.js').LLMToolDefinition[],
  hash: string,
): void {
  const db = getDatabase()
  const now = new Date().toISOString()

  db.prepare(
    `
    UPDATE sessions SET cached_system_prompt = ?, cached_tools = ?, cached_hash = ?, updated_at = ? WHERE id = ?
  `,
  ).run(systemPrompt, JSON.stringify(tools), hash, now, id)
}

export function getSessionCachedPrompt(id: string): {
  systemPrompt: string
  tools: import('../llm/types.js').LLMToolDefinition[]
  hash: string
} | null {
  const db = getDatabase()
  const row = db
    .prepare(
      `
    SELECT cached_system_prompt, cached_tools, cached_hash FROM sessions WHERE id = ?
  `,
    )
    .get(id) as
    { cached_system_prompt: string | null; cached_tools: string | null; cached_hash: string | null } | undefined

  if (!row || !row.cached_system_prompt || !row.cached_tools || !row.cached_hash) {
    return null
  }

  try {
    const tools = JSON.parse(row.cached_tools) as import('../llm/types.js').LLMToolDefinition[]
    return { systemPrompt: row.cached_system_prompt, tools, hash: row.cached_hash }
  } catch {
    return null
  }
}

export function updateSessionMessageCount(id: string, delta: number): void {
  try {
    const db = getDatabase()
    const now = new Date().toISOString()

    db.prepare(
      `
      UPDATE sessions SET message_count = message_count + ?, updated_at = ? WHERE id = ?
    `,
    ).run(delta, now, id)
  } catch {
    // Database not initialized (test scenarios) - silently skip
  }
}

export function getSessionMessageCount(id: string): number {
  try {
    const db = getDatabase()
    const row = db.prepare(`SELECT message_count FROM sessions WHERE id = ?`).get(id) as
      { message_count: number } | undefined
    return row?.message_count ?? 0
  } catch {
    // Database not initialized (test scenarios) - return 0
    return 0
  }
}

export function listSessions(): SessionSummary[] {
  const db = getDatabase()

  const rows = db
    .prepare(
      `
    SELECT
      s.id,
      s.project_id,
      s.workdir,
      s.workspace,
      s.branch,
      s.mode,
      s.workflow_phase,
      s.is_running,
      s.is_favorite,
      s.created_at,
      s.updated_at,
      s.title,
      s.provider_id,
      s.provider_model,
      s.message_count
    FROM sessions s
    ORDER BY s.is_favorite DESC, s.updated_at DESC
  `,
    )
    .all() as SessionSummaryRow[]

  return rows.map(mapSessionSummaryRow)
}

export function listSessionsByProject(
  projectId: string,
  limit = 20,
  offset = 0,
): { sessions: SessionSummary[]; hasMore: boolean } {
  return listSessionsPaged(projectId, limit, offset)
}

/**
 * The most recently updated sessions across ALL projects, bounded (used by the
 * legacy global list refresh — the homepage itself uses listHomeSessions).
 */
export function listSessionsLimited(limit = 20, offset = 0): { sessions: SessionSummary[]; hasMore: boolean } {
  return listSessionsPaged(null, limit, offset)
}

function listSessionsPaged(
  projectId: string | null,
  limit: number,
  offset: number,
): { sessions: SessionSummary[]; hasMore: boolean } {
  const db = getDatabase()
  const where = projectId ? 'WHERE s.project_id = ?' : ''

  const rows = db
    .prepare(
      `
    SELECT
      s.id,
      s.project_id,
      s.workdir,
      s.workspace,
      s.branch,
      s.mode,
      s.workflow_phase,
      s.is_running,
      s.is_favorite,
      s.created_at,
      s.updated_at,
      s.title,
      s.provider_id,
      s.provider_model,
      s.message_count
    FROM sessions s
    ${where}
    ORDER BY s.is_favorite DESC, s.updated_at DESC
    LIMIT ? OFFSET ?
  `,
    )
    .all(...(projectId ? [projectId] : []), limit + 1, offset) as SessionSummaryRow[]

  const hasMore = rows.length > limit
  const sessions = rows.slice(0, limit).map(mapSessionSummaryRow)

  return { sessions, hasMore }
}

/**
 * The lightweight homepage list: the N most recently updated sessions per
 * project, summaries only. Deliberately does NOT load recent user prompts —
 * that requires parsing each session's snapshot, which is the slow path the
 * homepage must avoid. Returns a flat list ordered by last activity.
 */
export function listHomeSessions(sessionsPerProject = 5): SessionSummary[] {
  const db = getDatabase()

  const rows = db
    .prepare(
      `
    SELECT
      s.id,
      s.project_id,
      s.workdir,
      s.workspace,
      s.branch,
      s.mode,
      s.workflow_phase,
      s.is_running,
      s.is_favorite,
      s.created_at,
      s.updated_at,
      s.title,
      s.provider_id,
      s.provider_model,
      s.message_count
    FROM sessions s
    ORDER BY s.updated_at DESC
  `,
    )
    .all() as SessionSummaryRow[]

  const seen = new Map<string, number>()
  const result: SessionSummary[] = []
  for (const row of rows) {
    const count = seen.get(row.project_id) ?? 0
    if (count >= sessionsPerProject) continue
    seen.set(row.project_id, count + 1)
    result.push(mapSessionSummaryRow(row))
  }
  return result
}

export function updateSessionWorkdir(
  id: string,
  workdir: string,
  workspace: string | null,
  branch?: string | null,
): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  db.prepare(
    branch !== undefined
      ? 'UPDATE sessions SET workdir = ?, workspace = ?, branch = ?, updated_at = ? WHERE id = ?'
      : 'UPDATE sessions SET workdir = ?, workspace = ?, updated_at = ? WHERE id = ?',
  ).run(workdir, workspace, ...(branch !== undefined ? [branch, now, id] : [now, id]))
}

export function updateSessionBranch(id: string, branch: string): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  db.prepare('UPDATE sessions SET branch = ?, updated_at = ? WHERE id = ?').run(branch, now, id)
}

export function deleteSession(id: string): void {
  const db = getDatabase()
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

function mapSessionBase(row: SessionRow | SessionSummaryRow): {
  id: string
  projectId: string
  workdir: string
  workspace?: string
  branch?: string
  mode: SessionMode
  phase: SessionPhase
  isRunning: boolean
  providerId: string | null
  providerModel: string | null
  createdAt: string
  updatedAt: string
} {
  return {
    id: row.id,
    projectId: row.project_id,
    workdir: row.workdir,
    ...(row.workspace ? { workspace: row.workspace } : {}),
    ...(row.branch ? { branch: row.branch } : {}),
    mode: (row.mode ?? 'planner') as SessionMode,
    phase: (row.workflow_phase ?? 'plan') as SessionPhase,
    isRunning: Boolean(row.is_running),
    providerId: row.provider_id ?? null,
    providerModel: row.provider_model ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapSessionSummaryRow(row: SessionSummaryRow): SessionSummary {
  return {
    ...mapSessionBase(row),
    ...(row.title ? { title: row.title } : {}),
    criteriaCount: 0,
    criteriaCompleted: 0,
    messageCount: row.message_count,
    isFavorite: Boolean(row.is_favorite),
  }
}

export function toggleFavorite(id: string, isFavorite: boolean): void {
  const db = getDatabase()
  db.prepare(`UPDATE sessions SET is_favorite = ? WHERE id = ?`).run(isFavorite ? 1 : 0, id)
}

// ============================================================================
// Row Types
// ============================================================================

interface SessionRow {
  id: string
  project_id: string
  workdir: string
  workspace: string | null
  branch: string | null
  phase: string
  mode: string
  workflow_phase: string
  is_running: number
  summary: string | null
  provider_id: string | null
  provider_model: string | null
  created_at: string
  updated_at: string
  title: string | null
  total_tokens_used: number
  total_tool_calls: number
  iteration_count: number
  danger_level: string
  cached_system_prompt: string | null
  cached_tools: string | null
  cached_hash: string | null
}

interface SessionSummaryRow {
  id: string
  project_id: string
  workdir: string
  workspace: string | null
  branch: string | null
  mode: string
  workflow_phase: string
  is_running: number
  is_favorite: number
  created_at: string
  updated_at: string
  title: string | null
  provider_id: string | null
  provider_model: string | null
  message_count: number
}

// ============================================================================
// Workflow Execution Operations
// ============================================================================

export interface WorkflowExecutionRow {
  id: string
  session_id: string
  workflow_id: string
  workflow_name: string
  workflow_color: string | null
  status: string
  current_step_id: string | null
  current_step_name: string | null
  step_output: string | null
  params: string | null
  pending_choices: string | null
  sub_group: string | null
  created_at: number
  updated_at: number
}

export function createWorkflowExecution(
  id: string,
  sessionId: string,
  workflowId: string,
  workflowName: string,
  workflowColor: string | undefined,
  params: Record<string, string>,
  subGroup?: string,
): void {
  const db = getDatabase()
  const now = Date.now()
  db.prepare(
    `INSERT INTO workflow_executions (id, session_id, workflow_id, workflow_name, workflow_color, status, step_output, params, sub_group, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'running', '{}', ?, ?, ?, ?)`,
  ).run(
    id,
    sessionId,
    workflowId,
    workflowName,
    workflowColor ?? null,
    JSON.stringify(params),
    subGroup ?? null,
    now,
    now,
  )
}

export function updateWorkflowExecutionStatus(
  executionId: string,
  status: string,
  stepId?: string,
  stepName?: string,
  stepOutput?: Record<string, string>,
  pendingChoices?: import('../../shared/types.js').UserStepChoice[],
): void {
  const db = getDatabase()
  const now = Date.now()
  const stepOutputJson = stepOutput ? JSON.stringify(stepOutput) : undefined
  const pendingChoicesJson = pendingChoices ? JSON.stringify(pendingChoices) : undefined
  db.prepare(
    `UPDATE workflow_executions SET status = ?, current_step_id = COALESCE(?, current_step_id), current_step_name = COALESCE(?, current_step_name), step_output = COALESCE(?, step_output), pending_choices = COALESCE(?, pending_choices), updated_at = ? WHERE id = ?`,
  ).run(status, stepId ?? null, stepName ?? null, stepOutputJson ?? null, pendingChoicesJson ?? null, now, executionId)
}

export function getActiveWorkflowExecution(sessionId: string): WorkflowExecutionRow | undefined {
  const db = getDatabase()
  const row = db
    .prepare(
      `SELECT * FROM workflow_executions WHERE session_id = ? AND status IN ('running', 'waiting') ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(sessionId) as WorkflowExecutionRow | undefined
  return row
}

/**
 * Latest execution for a session regardless of status. Used to re-activate a
 * blocked execution when the user retries its step (blocked rows are excluded
 * from getActiveWorkflowExecution).
 */
export function getLatestWorkflowExecution(sessionId: string): WorkflowExecutionRow | undefined {
  const db = getDatabase()
  const row = db
    .prepare(`SELECT * FROM workflow_executions WHERE session_id = ? ORDER BY updated_at DESC LIMIT 1`)
    .get(sessionId) as WorkflowExecutionRow | undefined
  return row
}

export function clearWorkflowExecution(executionId: string): void {
  const db = getDatabase()
  const now = Date.now()
  db.prepare(`UPDATE workflow_executions SET updated_at = ? WHERE id = ?`).run(now, executionId)
}
