/**
 * Project Tasks Service
 *
 * Domain logic for the project-scoped task board. Owns the state machine
 * (To Do → In Progress {running|queued} → Done, with reverts), gate checks,
 * slot allocation / FIFO auto-launch, session seeding, and system reminders.
 *
 * Transitions are enforced here — never by clients. All mutations run inside
 * a per-project lock so concurrent actors (two agents, or an agent and the
 * human) serialize instead of corrupting state. Callers may pass
 * `expectedUpdatedAt` for optimistic concurrency: if the task changed since
 * their view, the operation fails with a structured CONFLICT error.
 *
 * Dependencies (session manager, config, broadcast) are injected so the
 * service stays testable and free of singletons.
 */

import type { Config, ProjectTask, ProjectTaskCounts, ProjectTaskSettings, TaskStatus } from '../../shared/types.js'
import type { SessionManager } from '../session/manager.js'
import type { TasksUpdatePayload } from '../../shared/protocol.js'
import type { Attachment, WorkflowLaunchScope } from '../../shared/types.js'
import { parseDefaultModelSelection } from '../provider-manager.js'
import { getProject } from '../db/projects.js'
import { resolveSlashLaunch, type SlashLaunch } from './slash.js'
import {
  createTask as dbCreateTask,
  updateTask as dbUpdateTask,
  getTask as dbGetTask,
  listTasks as dbListTasks,
  deleteTask as dbDeleteTask,
  cloneTask as dbCloneTask,
  reorderTask as dbReorderTask,
  setTaskStatus as dbSetTaskStatus,
  setTaskRunState as dbSetTaskRunState,
  addTaskLink as dbAddTaskLink,
  removeTaskLinks as dbRemoveTaskLinks,
  clearActiveTaskLink as dbClearActiveTaskLink,
  appendToBottom as dbAppendToBottom,
  getGateConfig as dbGetGateConfig,
  replaceGateConfig as dbReplaceGateConfig,
  setGateValue as dbSetGateValue,
  addAuditEntry as dbAddAuditEntry,
  getTaskSettings as dbGetTaskSettings,
  setTaskSettings as dbSetTaskSettings,
} from '../db/tasks.js'
import type { TaskGateConfig, TaskActor } from '../../shared/types.js'

export type TaskDestination = 'todo' | 'in_progress' | 'done'

export interface TaskActorInfo {
  actor: TaskActor
  actorName?: string
}

export interface MoveOptions extends TaskActorInfo {
  /** For agent moves: bind to this session (current-session rule). */
  sessionId?: string
  /** Optional short reason recorded in the audit trail (e.g. revert rationale). */
  reason?: string
  /** Optimistic concurrency guard: fail with CONFLICT if the task version differs. */
  expectedVersion?: number
}

export interface TaskConflictError extends Error {
  code: 'CONFLICT'
  task: ProjectTask
}

export interface TaskGateError extends Error {
  code: 'GATE_BLOCKED'
  missing: { gateId: string; name: string; description: string }[]
  task: ProjectTask
}

export function isTaskConflictError(err: unknown): err is TaskConflictError {
  return err instanceof Error && (err as { code?: string }).code === 'CONFLICT'
}

export function isTaskGateError(err: unknown): err is TaskGateError {
  return err instanceof Error && (err as { code?: string }).code === 'GATE_BLOCKED'
}

export interface TasksService {
  snapshot(projectId: string): { tasks: ProjectTask[]; settings: ProjectTaskSettings; counts: ProjectTaskCounts }
  list(projectId: string): ProjectTask[]
  get(projectId: string, taskId: string): ProjectTask | null
  create(projectId: string, input: CreateTaskServiceInput, actor: TaskActorInfo): ProjectTask
  update(
    projectId: string,
    taskId: string,
    patch: UpdateTaskServiceInput,
    actor: TaskActorInfo,
    expectedVersion?: number,
  ): Promise<{ task: ProjectTask; conflict: boolean }>
  duplicate(projectId: string, taskId: string, actor: TaskActorInfo): ProjectTask
  remove(projectId: string, taskId: string, actor: TaskActorInfo): Promise<void>
  move(
    projectId: string,
    taskId: string,
    to: TaskDestination,
    opts: MoveOptions,
  ): Promise<{
    task: ProjectTask
    sessionId?: string
    autoLaunched?: { taskId: string; taskTitle: string; sessionId: string; projectId: string }
  }>
  setGateValue(
    projectId: string,
    taskId: string,
    gateId: string,
    value: string,
    actor: TaskActorInfo,
    sessionId?: string,
    expectedVersion?: number,
  ): Promise<{ task: ProjectTask; conflict: boolean }>
  setGateConfig(projectId: string, gates: TaskGateConfig[], actor: TaskActorInfo): TaskGateConfig[]
  setSettings(projectId: string, settings: Partial<ProjectTaskSettings>): Promise<ProjectTaskSettings>
  reorder(projectId: string, taskId: string, status: TaskDestination, toIndex: number): ProjectTask
  counts(projectId: string): ProjectTaskCounts
}

export interface CreateTaskServiceInput {
  prompt: string
  attachments?: Attachment[]
  agentId?: string
  providerId?: string
  model?: string
}

export interface UpdateTaskServiceInput {
  prompt?: string
  attachments?: Attachment[]
  agentId?: string | null
  providerId?: string | null
  model?: string | null
}

export interface TasksServiceDeps {
  sessionManager: SessionManager
  config: Config
  broadcast: (projectId: string, payload: TasksUpdatePayload) => void
  /** Global config dir — slash commands/workflows are resolved from here (plus the project dir). */
  configDir: string
  /** Starts a workflow run in a seeded session (wired to the runner in server/index.ts). */
  launchWorkflow?: (
    sessionId: string,
    launch: {
      workflowId: string
      params?: Record<string, string>
      scope?: WorkflowLaunchScope
      attachments?: Attachment[]
    },
  ) => void
}

const REMINDER_COLOR = '#3b82f6'

// ============================================================================
// Locking (per-project serialization)
// ============================================================================

const locks = new Map<string, Promise<unknown>>()

function withLock<T>(projectId: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = locks.get(projectId) ?? Promise.resolve()
  const next = prev.then(() => fn())
  locks.set(
    projectId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  )
  return next
}

// ============================================================================
// Service factory
// ============================================================================

export function createTasksService(deps: TasksServiceDeps): TasksService {
  const { sessionManager, config, broadcast, configDir, launchWorkflow } = deps

  function snapshot(projectId: string) {
    const tasks = dbListTasks(projectId)
    const settings = dbGetTaskSettings(projectId)
    const counts = computeCounts(tasks)
    const gates = dbGetGateConfig(projectId)
    return { tasks, settings, counts, gates }
  }

  function publish(projectId: string, changedTaskId?: string, autoLaunched?: TasksUpdatePayload['autoLaunched']) {
    const { tasks, settings, counts, gates } = snapshot(projectId)
    broadcast(projectId, {
      projectId,
      tasks,
      settings,
      counts,
      gates,
      ...(changedTaskId ? { changedTaskId } : {}),
      ...(autoLaunched ? { autoLaunched } : {}),
    })
  }

  function list(projectId: string) {
    return dbListTasks(projectId)
  }

  function get(projectId: string, taskId: string) {
    const task = dbGetTask(taskId)
    return task && task.projectId === projectId ? task : null
  }

  function assertOwned(projectId: string, taskId: string): ProjectTask {
    const task = dbGetTask(taskId)
    if (!task || task.projectId !== projectId) {
      throw new Error(`Task not found: ${taskId}`)
    }
    return task
  }

  function assertNotStale(task: ProjectTask, expectedVersion?: number): void {
    if (expectedVersion !== undefined && task.version !== expectedVersion) {
      const err = new Error('Task changed, refresh and retry') as TaskConflictError
      err.code = 'CONFLICT'
      err.task = task
      throw err
    }
  }

  function create(projectId: string, input: CreateTaskServiceInput, actor: TaskActorInfo) {
    const hasContent = input.prompt.trim().length > 0
    const hasAttachments = (input.attachments?.length ?? 0) > 0
    if (!hasContent && !hasAttachments) {
      throw new Error('Task requires at least a prompt or an attachment')
    }
    const task = dbCreateTask(projectId, {
      prompt: input.prompt,
      attachments: input.attachments ?? [],
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.model ? { model: input.model } : {}),
    })
    dbAddAuditEntry(task.id, actor.actor, 'create', `Task created in To Do`, actor.actorName)
    const fresh = dbGetTask(task.id)!
    publish(projectId, fresh.id)
    return fresh
  }

  function update(
    projectId: string,
    taskId: string,
    patch: UpdateTaskServiceInput,
    actor: TaskActorInfo,
    expectedVersion?: number,
  ) {
    return withLock(projectId, () => {
      const task = assertOwned(projectId, taskId)
      assertNotStale(task, expectedVersion)

      const next = dbUpdateTask(taskId, patch) ?? dbGetTask(taskId)!
      const changed = summarizeChanges(task, next)
      dbAddAuditEntry(taskId, actor.actor, 'edit', changed || 'Task updated', actor.actorName)
      const fresh = dbGetTask(taskId)!
      publish(projectId, fresh.id)
      return { task: fresh, conflict: false }
    })
  }

  function duplicate(projectId: string, taskId: string, actor: TaskActorInfo) {
    const source = assertOwned(projectId, taskId)
    const copy = dbCloneTask(taskId)
    if (!copy) throw new Error(`Task not found: ${taskId}`)
    dbAddAuditEntry(
      copy.id,
      actor.actor,
      'duplicate',
      `Duplicated from "${promptLabel(source.prompt)}"`,
      actor.actorName,
    )
    const fresh = dbGetTask(copy.id)!
    publish(projectId, fresh.id)
    return fresh
  }

  function remove(projectId: string, taskId: string, actor: TaskActorInfo) {
    return withLock(projectId, async () => {
      const task = assertOwned(projectId, taskId)
      const freedSlot = task.status === 'in_progress' && task.runState === 'running'
      dbAddAuditEntry(taskId, actor.actor, 'delete', `Task deleted`, actor.actorName)
      dbDeleteTask(taskId)
      publish(projectId)
      // Deleting a running task frees its slot — let the next queued task launch.
      const autoLaunched = freedSlot ? await maybeAutoLaunch(projectId) : undefined
      if (autoLaunched) publish(projectId, undefined, autoLaunched)
    })
  }

  function move(projectId: string, taskId: string, to: TaskDestination, opts: MoveOptions) {
    return withLock(projectId, async () => {
      const task = assertOwned(projectId, taskId)
      assertNotStale(task, opts.expectedVersion)

      const from = task.status
      if (from === to) {
        // No-op transition (e.g. already done) — still return the task.
        return { task }
      }

      let sessionId: string | undefined
      const wasRunning = task.status === 'in_progress' && task.runState === 'running'

      if (to === 'in_progress') {
        const readyGates = requiredGates(projectId, 'ready')
        const missing = missingGateFields(task, readyGates)
        if (missing.length > 0) {
          throw gateBlockedError(task, 'In Progress', missing)
        }

        dbSetTaskStatus(taskId, 'in_progress')
        const settings = dbGetTaskSettings(projectId)

        if (opts.actor === 'agent') {
          if (!opts.sessionId) {
            throw new Error('Agent moves must bind to the current session (sessionId is required)')
          }
          // Current-session rule: the agent is working in its own session NOW.
          dbSetTaskRunState(taskId, 'running')
          dbAddTaskLink(taskId, opts.sessionId, true)
          dbAddAuditEntry(taskId, 'agent', 'move', `Moved to In Progress (running)`, opts.actorName)
          emitReminder(opts.sessionId, reminderForInProgress(task, opts.sessionId, from))
          sessionId = opts.sessionId
        } else {
          // Human drag / Start task: allocate a slot or queue.
          const runningCount = activeCount(projectId)
          const launched = runningCount < settings.slotLimit && !settings.queuePaused
          dbSetTaskRunState(taskId, launched ? 'running' : 'queued')
          if (launched) {
            const seeded = await seedSession(projectId, task, from)
            dbAddTaskLink(taskId, seeded.session.id, true)
            dbAddAuditEntry(taskId, 'human', 'move', `Moved to In Progress (running)`, opts.actorName)
            sessionId = seeded.session.id
          } else {
            // Queued: append at the bottom of In Progress so FIFO order (oldest
            // first) matches the visible stacking and the per-task queue rank.
            dbAppendToBottom(taskId, 'in_progress')
            dbAddAuditEntry(taskId, 'human', 'move', `Moved to In Progress (queued)`, opts.actorName)
          }
        }
      } else if (to === 'done') {
        const doneGates = requiredGates(projectId, 'done')
        const missing = missingGateFields(task, doneGates)
        if (missing.length > 0) {
          throw gateBlockedError(task, 'Done', missing)
        }
        dbSetTaskStatus(taskId, 'done')
        dbClearActiveTaskLink(taskId)
        dbAddAuditEntry(taskId, opts.actor, 'move', `Moved to Done`, opts.actorName)
        if (task.activeSessionId) {
          emitReminder(task.activeSessionId, reminderForDone(task))
        }
      } else {
        // → todo (revert / unbind) from in_progress or done
        dbSetTaskStatus(taskId, 'todo')
        dbRemoveTaskLinks(taskId)
        const detailParts = [`Moved back to To Do`]
        if (opts.reason) detailParts.push(`Reason: ${opts.reason}`)
        dbAddAuditEntry(taskId, opts.actor, 'move', detailParts.join('. '), opts.actorName)
        if (task.activeSessionId) {
          emitReminder(task.activeSessionId, reminderForTodo(task))
        }
      }

      const fresh = dbGetTask(taskId)!
      let autoLaunched: TasksUpdatePayload['autoLaunched'] | undefined
      if (wasRunning || (to === 'todo' && from === 'in_progress')) {
        autoLaunched = await maybeAutoLaunch(projectId)
      }
      publish(projectId, fresh.id, autoLaunched)
      return {
        task: fresh,
        ...(sessionId ? { sessionId } : {}),
        ...(autoLaunched ? { autoLaunched } : {}),
      }
    })
  }

  function setGateValue(
    projectId: string,
    taskId: string,
    gateId: string,
    value: string,
    actor: TaskActorInfo,
    sessionId?: string,
    expectedVersion?: number,
  ) {
    return withLock(projectId, () => {
      const task = assertOwned(projectId, taskId)
      assertNotStale(task, expectedVersion)
      const gates = dbGetGateConfig(projectId)
      const gate = gates.find((g) => g.id === gateId)
      if (!gate) {
        throw new Error(`Unknown gate: ${gateId}`)
      }
      dbSetGateValue(taskId, gateId, value, actor.actor, actor.actorName, sessionId)
      dbAddAuditEntry(taskId, actor.actor, 'gate_value', `Set gate "${gate.name}" = "${value}"`, actor.actorName)
      const fresh = dbGetTask(taskId)!
      publish(projectId, fresh.id)
      return { task: fresh, conflict: false }
    })
  }

  function setGateConfig(projectId: string, gates: TaskGateConfig[], actor: TaskActorInfo) {
    const normalized = gates.map((g) => ({
      ...g,
      name: g.name.trim(),
      description: g.description.trim(),
    }))
    dbReplaceGateConfig(projectId, normalized)
    void actor
    publish(projectId)
    return dbGetGateConfig(projectId)
  }

  async function setSettings(projectId: string, settings: Partial<ProjectTaskSettings>) {
    const saved = dbSetTaskSettings(projectId, settings)
    publish(projectId)
    // Changing the limit upward (or unpausing) may free room for queued tasks.
    const autoLaunched = await maybeAutoLaunch(projectId)
    if (autoLaunched) publish(projectId, undefined, autoLaunched)
    return saved
  }

  function reorder(projectId: string, taskId: string, status: TaskDestination, toIndex: number) {
    const task = assertOwned(projectId, taskId)
    if (task.status !== status) {
      throw new Error(`Cannot reorder task: status mismatch (${task.status} != ${status})`)
    }
    dbReorderTask(taskId, status, toIndex)
    const fresh = dbGetTask(taskId)!
    publish(projectId, fresh.id)
    return fresh
  }

  function counts(projectId: string) {
    return computeCounts(dbListTasks(projectId))
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  function computeCounts(tasks: ProjectTask[]): ProjectTaskCounts {
    const todo = tasks.filter((t) => t.status === 'todo').length
    const inProgress = tasks.filter((t) => t.status === 'in_progress').length
    const running = tasks.filter((t) => t.status === 'in_progress' && t.runState === 'running').length
    const queued = tasks.filter((t) => t.status === 'in_progress' && t.runState === 'queued').length
    const done = tasks.filter((t) => t.status === 'done').length
    return { open: todo + inProgress, todo, inProgress, running, queued, done }
  }

  function requiredGates(projectId: string, variant: 'done' | 'ready'): TaskGateConfig[] {
    return dbGetGateConfig(projectId).filter((g) => g.variant === variant && g.required)
  }

  function missingGateFields(task: ProjectTask, gates: TaskGateConfig[]) {
    const filled = new Set(task.gateValues.filter((v) => v.value.trim().length > 0).map((v) => v.gateId))
    return gates
      .filter((g) => !filled.has(g.id))
      .map((g) => ({ gateId: g.id, name: g.name, description: g.description }))
  }

  function gateBlockedError(
    task: ProjectTask,
    destination: 'In Progress' | 'Done',
    missing: { gateId: string; name: string; description: string }[],
  ) {
    const err = new Error(
      `Cannot move to ${destination}: missing required gate fields: ${missing.map((m) => m.name).join(', ')}`,
    ) as TaskGateError
    err.code = 'GATE_BLOCKED'
    err.missing = missing
    err.task = task
    return err
  }

  function activeCount(projectId: string): number {
    return dbListTasks(projectId).filter((t) => t.status === 'in_progress' && t.runState === 'running').length
  }

  /**
   * Seed a brand-new session for a claimed task: reminder first (opening
   * context), then the task's work — the plain prompt queued, a slash command
   * expanded into its command prompt, or a slash workflow launched directly.
   */
  async function seedSession(projectId: string, task: ProjectTask, from: TaskStatus | 'queued') {
    const defaults = parseDefaultModelSelection(config.defaultModelSelection)
    const providerId = task.providerId ?? defaults.providerId ?? null
    const model = task.model ?? defaults.model ?? null
    const session = sessionManager.createSession(projectId, undefined, providerId, model)
    if (task.agentId) {
      try {
        sessionManager.setMode(session.id, task.agentId)
      } catch {
        // Unknown agent id — fall back to the session default.
      }
    }
    emitReminder(session.id, reminderForInProgress(task, session.id, from))
    const attachments = task.attachments.length > 0 ? task.attachments : undefined

    const projectDir = getProject(projectId)?.workdir
    let slash: SlashLaunch
    try {
      slash = await resolveSlashLaunch(configDir, projectDir, task.prompt)
    } catch {
      // Corrupt/missing slash config must not block a task from launching —
      // degrade to seeding the raw prompt.
      slash = null
    }
    if (slash?.kind === 'workflow') {
      if (launchWorkflow) {
        launchWorkflow(session.id, {
          workflowId: slash.workflowId,
          params: slash.params,
          scope: 'auto',
          ...(attachments ? { attachments } : {}),
        })
      } else {
        // No launcher wired (shouldn't happen in production) — degrade to a
        // plain message so the session still starts with the task's content.
        sessionManager.queueMessage(session.id, 'asap', task.prompt, attachments)
      }
    } else if (slash?.kind === 'command') {
      if (slash.agentMode) {
        try {
          sessionManager.setMode(session.id, slash.agentMode)
        } catch {
          // Unknown agent — keep the task's configured agent.
        }
      }
      sessionManager.queueMessage(session.id, 'asap', slash.prompt, attachments, 'command')
    } else {
      sessionManager.queueMessage(session.id, 'asap', task.prompt, attachments)
    }
    return { session }
  }

  async function maybeAutoLaunch(projectId: string): Promise<TasksUpdatePayload['autoLaunched'] | undefined> {
    const settings = dbGetTaskSettings(projectId)
    if (settings.queuePaused) return undefined
    if (activeCount(projectId) >= settings.slotLimit) return undefined
    const queued = dbListTasks(projectId)
      .filter((t) => t.status === 'in_progress' && t.runState === 'queued')
      .sort((a, b) => a.position - b.position)
    const next = queued[0]
    if (!next) return undefined

    dbSetTaskRunState(next.id, 'running')
    const seeded = await seedSession(projectId, next, 'queued')
    dbAddTaskLink(next.id, seeded.session.id, true)
    dbAddAuditEntry(next.id, 'system', 'auto_launch', `Auto-launched into session ${seeded.session.id}`, 'system')
    return {
      taskId: next.id,
      taskTitle: promptLabel(next.prompt),
      sessionId: seeded.session.id,
      projectId,
    }
  }

  // ------------------------------------------------------------------
  // System reminders (mirror the workspace-switch reminder pattern)
  // ------------------------------------------------------------------

  function emitReminder(sessionId: string, content: string) {
    try {
      sessionManager.addMessage(sessionId, {
        role: 'user',
        content: `<system-reminder>\n${content}\n</system-reminder>`,
        isSystemGenerated: true,
        messageKind: 'auto-prompt',
        metadata: { type: 'task', name: 'Task', color: REMINDER_COLOR, kind: 'definition' },
      })
    } catch {
      // Session may have been deleted concurrently — the task state stands on its own.
    }
  }

  function reminderForInProgress(task: ProjectTask, sessionId: string, from: TaskStatus | 'queued'): string {
    const gates = requiredGates(task.projectId, 'done')
    const gateLine =
      gates.length > 0 ? `Outstanding gates: ${gates.map((g) => g.name).join(', ')}.` : 'No gates configured.'
    return [
      `This session is now working on task "${promptLabel(task.prompt)}" from the project task board.`,
      `Previous state: ${prettyStatus(from)} → In Progress. Session: ${sessionId.slice(0, 8)}.`,
      gateLine,
    ].join('\n')
  }

  function reminderForDone(task: ProjectTask): string {
    const evidence = task.gateValues
      .filter((v) => v.value.trim().length > 0)
      .map((v) => `  - ${v.gateId}: ${v.value} (set by ${v.actor})`)
    const evidenceLine = evidence.length > 0 ? evidence.join('\n') : '  - (no gate values recorded)'
    return [
      `Task "${promptLabel(task.prompt)}" was marked Done.`,
      `Gate evidence that satisfied it:\n${evidenceLine}`,
      `Wind down cleanly — this task is no longer active.`,
    ].join('\n')
  }

  function reminderForTodo(task: ProjectTask): string {
    return `Task "${promptLabel(task.prompt)}" is no longer active in this session (reverted to To Do). Do not continue working on it.`
  }

  function prettyStatus(s: string): string {
    switch (s) {
      case 'todo':
        return 'To Do'
      case 'in_progress':
        return 'In Progress'
      case 'done':
        return 'Done'
      case 'queued':
        return 'Queued'
      default:
        return s
    }
  }

  function summarizeChanges(before: ProjectTask, after: ProjectTask): string {
    const parts: string[] = []
    if (before.prompt !== after.prompt) parts.push('prompt updated')
    if (before.agentId !== after.agentId || before.model !== after.model) parts.push('agent/model updated')
    if (before.attachments.length !== after.attachments.length) parts.push('attachments updated')
    return parts.length > 0 ? `Edited: ${parts.join(', ')}` : ''
  }

  return {
    snapshot,
    list,
    get,
    create,
    update,
    duplicate,
    remove,
    move,
    setGateValue,
    setGateConfig,
    setSettings,
    reorder,
    counts,
  }
}

/** Short human-readable label for a prompt (first line, truncated) — used for session names and notices. */
function promptLabel(prompt: string): string {
  const firstLine =
    prompt
      .split('\n')
      .find((line) => line.trim().length > 0)
      ?.trim() ?? ''
  const cleaned = firstLine.replace(/^[#>*\-\s]+/, '')
  if (cleaned.length <= 52) return cleaned
  return `${cleaned.slice(0, 49).trimEnd()}…`
}
