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

import type {
  Config,
  ProjectTask,
  ProjectTaskCounts,
  ProjectTaskSettings,
  TaskStatus,
  Session,
} from '../../shared/types.js'
import type { SessionManager } from '../session/manager.js'
import type { TasksUpdatePayload } from '../../shared/protocol.js'
import type { Attachment, WorkflowLaunchScope } from '../../shared/types.js'
import { parseDefaultModelSelection } from '../provider-manager.js'
import { getProject } from '../db/projects.js'
import { resolveSlashLaunch, type SlashLaunch } from './slash.js'
import { resolveFavoriteWorkflow } from '../workflows/favorite.js'
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
  setTaskWorkflowChoice as dbSetTaskWorkflowChoice,
  addTaskLink as dbAddTaskLink,
  listTaskLinks as dbListTaskLinks,
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
import { serverT } from '../i18n.js'

export type TaskDestination = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done'

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
  startPlan(projectId: string, taskId: string): Promise<{ task: ProjectTask; sessionId: string }>
  /** Record the workflow picked for a planned task (drives auto-launch + suppresses favorite countdown). */
  setWorkflowChoice(projectId: string, taskId: string, workflowId: string | null): ProjectTask
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
      content?: string
    },
  ) => void
}

const REMINDER_COLOR = '#3b82f6'
/** Bundled workflows launched by the board flow (src/server/workflows/defaults/). */
const PLAN_WORKFLOW_ID = 'plan'
const BUILD_WORKFLOW_ID = 'default'

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
    const tasks = listEnriched(projectId)
    const settings = dbGetTaskSettings(projectId)
    const counts = computeCounts(tasks)
    const gates = dbGetGateConfig(projectId)
    return { tasks, settings, counts, gates }
  }

  /** Board tasks enriched with the `planned` flag (a settled plan run carrying criteria). */
  function listEnriched(projectId: string): ProjectTask[] {
    return dbListTasks(projectId).map((t) => ({ ...t, planned: !!plannedSessionId(t) }))
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

  /**
   * A target session is reusable only when it belongs to this project AND is
   * still fresh (no messages) — reusing a session mid-conversation would
   * inject task content into unrelated context.
   */
  function reusableTarget(projectId: string, sessionId: string | undefined): string | undefined {
    if (!sessionId) return undefined
    const session = sessionManager.getSession(sessionId)
    if (!session || session.projectId !== projectId || session.messages.length > 0) return undefined
    return sessionId
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
      throw new Error(serverT({ en: 'Task not found: {{id}}', fr: 'Tâche introuvable : {{id}}' }, { id: taskId }))
    }
    return task
  }

  function assertNotStale(task: ProjectTask, expectedVersion?: number): void {
    if (expectedVersion !== undefined && task.version !== expectedVersion) {
      const err = new Error(
        serverT({ en: 'Task changed, refresh and retry', fr: 'Tâche modifiée, actualisez et réessayez' }),
      ) as TaskConflictError
      err.code = 'CONFLICT'
      err.task = task
      throw err
    }
  }

  function create(projectId: string, input: CreateTaskServiceInput, actor: TaskActorInfo) {
    const hasContent = input.prompt.trim().length > 0
    const hasAttachments = (input.attachments?.length ?? 0) > 0
    if (!hasContent && !hasAttachments) {
      throw new Error(
        serverT({
          en: 'Task requires at least a prompt or an attachment',
          fr: 'La tâche requiert au moins un prompt ou une pièce jointe',
        }),
      )
    }
    const task = dbCreateTask(projectId, {
      prompt: input.prompt,
      attachments: input.attachments ?? [],
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.model ? { model: input.model } : {}),
    })
    dbAddAuditEntry(task.id, actor.actor, 'create', `Task created in Backlog`, actor.actorName)
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
    if (!copy)
      throw new Error(serverT({ en: 'Task not found: {{id}}', fr: 'Tâche introuvable : {{id}}' }, { id: taskId }))
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
            throw new Error(
              serverT({
                en: 'Agent moves must bind to the current session (sessionId is required)',
                fr: 'Les déplacements d’agent doivent être liés à la session courante (sessionId requis)',
              }),
            )
          }
          // Current-session rule: the agent is working in its own session NOW.
          dbSetTaskRunState(taskId, 'running')
          dbAddTaskLink(taskId, opts.sessionId, true)
          dbAddAuditEntry(taskId, 'agent', 'move', `Moved to In Progress (running)`, opts.actorName)
          emitReminder(opts.sessionId, reminderForInProgress(task, opts.sessionId, from))
          sessionId = opts.sessionId
        } else {
          // A session already running for this task (e.g. the user launched a
          // workflow manually from the post-plan bar) simply claims its slot —
          // reseeding would start a duplicate attempt.
          const activeRunning = task.activeSessionId ? sessionManager.getSession(task.activeSessionId) : null
          const alreadyRunning = !!activeRunning && activeRunning.projectId === projectId && activeRunning.isRunning

          // Human drag / Start task: allocate a slot or queue.
          const runningCount = activeCount(projectId)
          const launched = alreadyRunning || (runningCount < settings.slotLimit && !settings.queuePaused)
          dbSetTaskRunState(taskId, launched ? 'running' : 'queued')
          if (launched) {
            if (alreadyRunning) {
              dbAddTaskLink(taskId, task.activeSessionId!, true)
              dbAddAuditEntry(taskId, 'human', 'move', `Moved to In Progress (running in its session)`, opts.actorName)
              sessionId = task.activeSessionId!
            } else {
              // Reuse the session the human is already in when it's still fresh
              // (Up-next Start) — otherwise seed a new one.
              const seeded = await seedSession(projectId, task, from, reusableTarget(projectId, opts.sessionId))
              dbAddTaskLink(taskId, seeded.session.id, true)
              dbAddAuditEntry(taskId, 'human', 'move', `Moved to In Progress (running)`, opts.actorName)
              sessionId = seeded.session.id
            }
          } else {
            // Queued: append at the bottom of In Progress so FIFO order (oldest
            // first) matches the visible stacking and the per-task queue rank.
            dbAppendToBottom(taskId, 'in_progress')
            // Remember where the human wants it to run (Up-next Start) so a
            // later auto-launch lands in the same session, not an orphan.
            const earmarked = reusableTarget(projectId, opts.sessionId)
            if (earmarked) dbAddTaskLink(taskId, earmarked, false)
            dbAddAuditEntry(taskId, 'human', 'move', `Moved to In Progress (queued)`, opts.actorName)
          }
        }
      } else if (to === 'review') {
        const doneGates = requiredGates(projectId, 'done')
        const missing = missingGateFields(task, doneGates)
        if (missing.length > 0) {
          throw gateBlockedError(task, 'Review', missing)
        }
        dbSetTaskStatus(taskId, 'review')
        dbClearActiveTaskLink(taskId)
        dbAddAuditEntry(taskId, opts.actor, 'move', `Moved to Review`, opts.actorName)
        if (task.activeSessionId) {
          emitReminder(task.activeSessionId, reminderForReview(task))
        }
      } else if (to === 'done') {
        if (opts.actor === 'agent') {
          throw new Error(
            serverT({
              en: 'Only the user can move a task to Done. When your work is complete, move it to Review instead.',
              fr: 'Seul l’utilisateur peut déplacer une tâche vers Terminé. Une fois votre travail terminé, déplacez-la vers Revue.',
            }),
          )
        }
        dbSetTaskStatus(taskId, 'done')
        dbClearActiveTaskLink(taskId)
        dbAddAuditEntry(taskId, opts.actor, 'move', `Moved to Done`, opts.actorName)
        if (task.activeSessionId) {
          emitReminder(task.activeSessionId, reminderForDone(task))
        }
      } else if (to === 'todo' && from === 'backlog') {
        // Backlog → To Do: only flip the column. No session is created here —
        // the human explicitly kicks planning off with "Start plan" from the
        // card, which creates and binds the planner session on demand.
        dbSetTaskStatus(taskId, 'todo')
        dbAddAuditEntry(taskId, opts.actor, 'move', `Moved to To Do`, opts.actorName)
      } else {
        // → backlog / todo reverts: deactivate the working link but KEEP the
        // session attached to the task — reverting In Progress → To Do (or
        // Backlog) must never orphan a session; it stays in the task history
        // and round-trips don't pile up duplicates. Let the next queued task launch.
        dbSetTaskStatus(taskId, to)
        dbClearActiveTaskLink(taskId)
        const detailParts = [`Moved back to ${prettyStatus(to)}`]
        if (opts.reason) detailParts.push(`Reason: ${opts.reason}`)
        dbAddAuditEntry(taskId, opts.actor, 'move', detailParts.join('. '), opts.actorName)
        if (task.activeSessionId) {
          emitReminder(task.activeSessionId, reminderForTodo(task))
        }
      }

      const fresh = dbGetTask(taskId)!
      let autoLaunched: TasksUpdatePayload['autoLaunched'] | undefined
      if (wasRunning || (from === 'in_progress' && to !== 'in_progress')) {
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
        throw new Error(serverT({ en: 'Unknown gate: {{id}}', fr: 'Porte inconnue : {{id}}' }, { id: gateId }))
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
      throw new Error(
        serverT(
          {
            en: 'Cannot reorder task: status mismatch ({{current}} != {{target}})',
            fr: 'Impossible de réordonner la tâche : statut incohérent ({{current}} != {{target}})',
          },
          { current: task.status, target: status },
        ),
      )
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
    const backlog = tasks.filter((t) => t.status === 'backlog').length
    const todo = tasks.filter((t) => t.status === 'todo').length
    const inProgress = tasks.filter((t) => t.status === 'in_progress').length
    const running = tasks.filter((t) => t.status === 'in_progress' && t.runState === 'running').length
    const queued = tasks.filter((t) => t.status === 'in_progress' && t.runState === 'queued').length
    const review = tasks.filter((t) => t.status === 'review').length
    const done = tasks.filter((t) => t.status === 'done').length
    return { open: backlog + todo + inProgress + review, backlog, todo, inProgress, running, queued, review, done }
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
    destination: 'In Progress' | 'Review' | 'Done',
    missing: { gateId: string; name: string; description: string }[],
  ) {
    const err = new Error(
      serverT(
        {
          en: 'Cannot move to {{destination}}: missing required gate fields: {{missing}}',
          fr: 'Impossible de déplacer vers {{destination}} : champs de porte requis manquants : {{missing}}',
        },
        { destination, missing: missing.map((m) => m.name).join(', ') },
      ),
    ) as TaskGateError
    err.code = 'GATE_BLOCKED'
    err.missing = missing
    err.task = task
    return err
  }

  function activeCount(projectId: string): number {
    return dbListTasks(projectId).filter((t) => t.status === 'in_progress' && t.runState === 'running').length
  }

  /** Whether a session already carries planned acceptance criteria for this task. */
  function hasPlannedCriteria(sessionId: string | undefined): boolean {
    if (!sessionId) return false
    const session = sessionManager.getSession(sessionId)
    return (session?.metadataEntries?.['criteria']?.length ?? 0) > 0
  }

  /** True when the session's latest workflow run was a completed `plan`. */
  function isPlannerSession(sessionId: string): boolean {
    const getLatest = sessionManager.getLatestWorkflowExecution
    if (typeof getLatest !== 'function') return false
    let latest: { workflowId?: string; status?: string } | null
    try {
      latest = getLatest.call(sessionManager, sessionId) ?? null
    } catch {
      return false
    }
    return latest?.workflowId === PLAN_WORKFLOW_ID && latest.status === 'completed'
  }

  /**
   * The task's already-planned session, preferring the most recent link. Only
   * sessions whose last run was the plan workflow qualify — a finished build
   * also carries criteria, but re-opening must start a fresh attempt instead
   * of resuming it (spec §7.5).
   */
  function plannedSessionId(task: ProjectTask): string | undefined {
    return [...task.sessionIds].reverse().find((id) => isPlannerSession(id) && hasPlannedCriteria(id))
  }

  /**
   * Bind an idle planner session to a task and launch the plan workflow in it.
   * The plan runs outside the In Progress slot/queue system: it never queues,
   * no matter the queue settings.
   */
  async function startPlan(projectId: string, taskId: string) {
    return withLock(projectId, async () => {
      const task = assertOwned(projectId, taskId)
      if (task.status !== 'todo') {
        throw new Error(
          serverT({
            en: 'Plans only start from the To Do column',
            fr: 'Les plans ne se démarrent que depuis la colonne À faire',
          }),
        )
      }
      const existing = task.sessionIds
        .map((id) => sessionManager.getSession(id))
        .filter((s) => s !== null && s !== undefined)
      if (existing.some((s) => s.isRunning)) {
        throw new Error(
          serverT({
            en: 'A plan is already running for this task',
            fr: 'Un plan est déjà en cours pour cette tâche',
          }),
        )
      }
      // Reuse an idle planner-eligible session instead of piling up empty ones.
      const sessionId = reusablePlanSession(task) ?? (await preparePlanSession(projectId, task))

      dbAddTaskLink(taskId, sessionId, true)
      // Planning deliberately skips the slot/queue system: a To Do plan runs
      // outside both — it never occupies an In Progress slot nor gets queued.
      dbAddAuditEntry(taskId, 'human', 'plan_start', `Plan started in session ${sessionId}`, 'user')
      const fresh = dbGetTask(taskId)!
      publish(projectId, fresh.id)
      launchWorkflow?.(sessionId, { workflowId: PLAN_WORKFLOW_ID, scope: 'auto', content: task.prompt })
      return { task: fresh, sessionId }
    })
  }

  /**
   * Persist the user's workflow pick for a planned task. The choice drives the
   * In Progress launch (the picked workflow replaces the default build) and
   * suppresses the favorite-workflow auto-launch countdown in its planner
   * session, since a choice has been made explicitly.
   */
  function setWorkflowChoice(projectId: string, taskId: string, workflowId: string | null): ProjectTask {
    assertOwned(projectId, taskId)
    dbSetTaskWorkflowChoice(taskId, workflowId)
    if (workflowId) {
      dbAddAuditEntry(taskId, 'human', 'edit', `Workflow picked: ${workflowId}`, 'user')
    } else {
      dbAddAuditEntry(taskId, 'human', 'edit', `Workflow pick cleared`, 'user')
    }
    const fresh = dbGetTask(taskId)!
    publish(projectId, fresh.id)
    return fresh
  }

  /** Create a session primed for planning this task; returns its id. */
  async function preparePlanSession(projectId: string, task: ProjectTask): Promise<string> {
    const defaults = parseDefaultModelSelection(config.defaultModelSelection)
    const providerId = task.providerId ?? defaults.providerId ?? null
    const model = task.model ?? defaults.model ?? null
    const session = sessionManager.createSession(projectId, undefined, providerId, model)
    emitReminder(session.id, reminderForPlan(task, session.id))
    return session.id
  }

  /**
   * Reuse a linked, idle session that was only ever used for planning (never
   * run, or last run was the plan workflow), so parking a card back and forth
   * never piles up orphan planner sessions. Build-attempt sessions stay out of
   * it — they are history, not a fresh planning ground.
   */
  function reusablePlanSession(task: ProjectTask): string | undefined {
    return [...task.sessionIds].reverse().find((id) => {
      const session = sessionManager.getSession(id)
      if (!session || session.isRunning) return false
      const latest = sessionManager.getLatestWorkflowExecution(id)
      return !latest || latest.workflowId === PLAN_WORKFLOW_ID
    })
  }

  /**
   * Resume a task's planner session straight into the build workflow: the
   * plan already produced criteria and context, so no new session is seeded.
   * The launch workflow is the task's explicit pick first, then the project/
   * global favorite, then the default build.
   */
  async function resumePlannedSession(projectId: string, task: ProjectTask, sessionId: string) {
    const session = sessionManager.getSession(sessionId)
    if (!session || session.projectId !== projectId || session.isRunning) return null
    emitReminder(
      sessionId,
      [
        `This session resumes as the builder for task "${promptLabel(task.prompt)}" — the plan is done.`,
        'The acceptance criteria and planning context are already in this session. Implement them now.',
        'When all criteria are complete, move the task to Review (never to Done) using the project_tasks tool.',
      ].join('\n'),
    )
    let workflowId = task.workflowChoice ?? null
    if (!workflowId) {
      const favorite = await resolveFavoriteWorkflow(configDir, projectId, getProject(projectId)?.workdir)
      workflowId = favorite?.id ?? BUILD_WORKFLOW_ID
    }
    launchWorkflow?.(sessionId, { workflowId, scope: 'auto' })
    return { session }
  }

  /**
   * Seed a session for a claimed task: reminder first (opening context), then
   * the task's work — the plain prompt launched through the plan workflow, a
   * slash command expanded into its command prompt, or a slash workflow
   * launched directly. When the task already has a planned session (accepted
   * criteria recorded), the plan is skipped: that session is resumed straight
   * into the build workflow. When a target session is supplied it is reused
   * (bind-in-place, no orphan session); otherwise a brand-new session is
   * created.
   */
  async function seedSession(
    projectId: string,
    task: ProjectTask,
    from: TaskStatus | 'queued',
    targetSessionId?: string,
  ) {
    const planned = plannedSessionId(task)
    if (planned) {
      const resumed = await resumePlannedSession(projectId, task, planned)
      if (resumed) return resumed
    }

    let session: Session
    if (targetSessionId) {
      const existing = sessionManager.getSession(targetSessionId)
      if (!existing) {
        // Target vanished concurrently — fall back to seeding a fresh one.
        return seedSession(projectId, task, from)
      }
      session = existing
    } else {
      const defaults = parseDefaultModelSelection(config.defaultModelSelection)
      const providerId = task.providerId ?? defaults.providerId ?? null
      const model = task.model ?? defaults.model ?? null
      session = sessionManager.createSession(projectId, undefined, providerId, model)
    }
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
    } else if (launchWorkflow && !task.agentId) {
      // No plan yet: run the bundled plan workflow first — it stops after the
      // plan, and the favorite-workflow countdown can chain into the build.
      launchWorkflow(session.id, {
        workflowId: PLAN_WORKFLOW_ID,
        scope: 'auto',
        content: task.prompt,
        ...(attachments ? { attachments } : {}),
      })
    } else {
      // Agent-pinned task (or no launcher wired): seed the raw prompt so the
      // session still starts with the task's content.
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
    // Honor the session a human earmarked at Start (Up-next) while it's still
    // fresh; otherwise seed a new one.
    const earmarks = dbListTaskLinks(next.id)
    const target = reusableTarget(projectId, earmarks[0]?.session_id)
    const seeded = await seedSession(projectId, next, 'queued', target)
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
      'Do not move the task, fill gate values, or commit changes without explicit user approval or a system instruction.',
      'When the work is complete, move the task to Review — only the user can move it to Done.',
    ].join('\n')
  }

  function reminderForPlan(task: ProjectTask, sessionId: string): string {
    return [
      `This session is the planning session for task "${promptLabel(task.prompt)}" from the project task board.`,
      `Session: ${sessionId.slice(0, 8)}. Plan mode is active: explore, ask the user questions, and define acceptance criteria — do not implement.`,
      'When the plan is agreed, propose moving the task to In Progress via the project_tasks tool (with user approval).',
    ].join('\n')
  }

  function reminderForReview(task: ProjectTask): string {
    const evidence = task.gateValues
      .filter((v) => v.value.trim().length > 0)
      .map((v) => `  - ${v.gateId}: ${v.value} (set by ${v.actor})`)
    const evidenceLine = evidence.length > 0 ? evidence.join('\n') : '  - (no gate values recorded)'
    return [
      `Task "${promptLabel(task.prompt)}" was moved to Review — the work is complete, awaiting human review.`,
      `Gate evidence that satisfied it:\n${evidenceLine}`,
      `Wind down cleanly — only the user can move the task from Review to Done. This task is no longer active.`,
    ].join('\n')
  }

  function reminderForDone(task: ProjectTask): string {
    return [
      `Task "${promptLabel(task.prompt)}" was marked Done by the user.`,
      `Wind down cleanly — this task is no longer active.`,
    ].join('\n')
  }

  function reminderForTodo(task: ProjectTask): string {
    return `Task "${promptLabel(task.prompt)}" is no longer active in this session (reverted to an earlier column). Do not continue working on it.`
  }

  function prettyStatus(s: string): string {
    switch (s) {
      case 'backlog':
        return 'Backlog'
      case 'todo':
        return 'To Do'
      case 'in_progress':
        return 'In Progress'
      case 'review':
        return 'Review'
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
    startPlan,
    setWorkflowChoice,
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
