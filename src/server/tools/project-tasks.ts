import { createTool, validateActionWithPermission } from './tool-helpers.js'
import type { TasksService } from '../tasks/service.js'
import { isTaskGateError, isTaskConflictError } from '../tasks/service.js'
import { getGateConfig } from '../db/tasks.js'
import { serverT } from '../i18n.js'

/**
 * project_tasks — agent participation on the project task board.
 *
 * Lean agent surface: list, create, edit, move, set_gate_value, delete.
 * The service retains full CRUD (human UI uses duplicate/reorder/gate
 * config directly); this tool only exposes what agents actually need.
 *
 * Rules enforced by the service, not here:
 * - An agent's move to In Progress binds to the CURRENT session — the tool
 *   can never create a session for itself.
 * - Gates are server-enforced: a move past an unsatisfied gate returns a
 *   structured error naming the missing fields and what to do first.
 * - Concurrent transitions serialize; stale writes return a CONFLICT error.
 *
 * The service instance is injected at startup (setTasksService) to avoid
 * singleton imports; tests inject a fake.
 */

let tasksService: TasksService | null = null

export function setTasksService(service: TasksService): void {
  tasksService = service
}

function getTasksService(): TasksService {
  if (!tasksService) {
    throw new Error('Project tasks service not initialized')
  }
  return tasksService
}

type TaskAction = 'list' | 'create' | 'edit' | 'move' | 'set_gate_value' | 'delete'

const VALID_ACTIONS: TaskAction[] = ['list', 'create', 'edit', 'move', 'set_gate_value', 'delete']

const TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'review', 'done'] as const
type TaskStatusArg = (typeof TASK_STATUSES)[number]
const LIST_STATUSES = [...TASK_STATUSES, 'all'] as const

const LIST_DEFAULT_LIMIT = 10
const LIST_MAX_LIMIT = 25

interface ProjectTasksArgs {
  action: TaskAction
  taskId?: string
  prompt?: string
  attachments?: unknown[]
  agentId?: string
  providerId?: string
  model?: string
  to?: TaskStatusArg
  reason?: string
  gateId?: string
  value?: string
  status?: TaskStatusArg | 'all'
  limit?: number
  offset?: number
  expectedVersion?: number
}

export const projectTasksTool = createTool<ProjectTasksArgs>(
  'project_tasks',
  {
    type: 'function',
    function: {
      name: 'project_tasks',
      description:
        'Kanban task board for this project (columns, left to right: backlog → todo → in_progress → review → done). ' +
        'Core loop: list → move → set_gate_value.\n\n' +
        'Rules:\n' +
        '- Moving to in_progress binds the task to YOUR current session.\n' +
        '- Do not move tasks or fill gate values without explicit user approval or a system instruction. ' +
        'When your work is complete, move the task to review (NOT done): only the user completes a task. ' +
        'Planning sessions end by proposing the move to in_progress.\n' +
        '- Moving to review is blocked by unmet gates: the error names the missing fields — fill them only with ' +
        'user approval, then retry the move.\n' +
        '- Stale writes fail with CONFLICT — re-list and retry.\n\n' +
        'Actions:\n' +
        '- list: tasks (status, gate values, queue position, bound session, audit trail); defaults to open tasks, ' +
        'filter via status (backlog | todo | in_progress | review | done | all); paginated — limit 10 max 25, page with offset\n' +
        '- create: add a task to Backlog (prompt required)\n' +
        '- edit: update prompt/attachments/agent/model (taskId + fields)\n' +
        '- move: change column (to: backlog | todo | in_progress | review | done; optional reason)\n' +
        '- set_gate_value: fill a gate field (taskId, gateId, value)\n' +
        '- delete: remove a task (taskId)',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: VALID_ACTIONS, description: 'The action to perform' },
          taskId: { type: 'string', description: 'Target task id (edit, move, set_gate_value, delete)' },
          prompt: { type: 'string', description: 'The prompt/instruction executed when the task launches' },
          attachments: {
            type: 'array',
            description: 'Optional attachments (same shape as chat attachments)',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Attachment ID' },
                filename: { type: 'string', description: 'File name' },
                mimeType: { type: 'string', description: 'MIME type' },
                size: { type: 'number', description: 'File size in bytes' },
              },
            },
          },
          agentId: { type: 'string', description: 'Selected agent id' },
          providerId: { type: 'string', description: 'Provider id used when a session is spawned' },
          model: { type: 'string', description: 'Model label used when a session is spawned' },
          to: { type: 'string', enum: [...TASK_STATUSES], description: 'Destination column for move' },
          reason: { type: 'string', description: 'Optional short reason (recorded in the audit trail) for reverts' },
          gateId: { type: 'string', description: 'Gate field id for set_gate_value' },
          value: { type: 'string', description: 'Proof/evidence value for set_gate_value' },
          status: {
            type: 'string',
            enum: [...LIST_STATUSES],
            description: 'Column filter for action=list (default: open tasks)',
          },
          limit: {
            type: 'number',
            description: 'Max tasks to return for action=list (default: 10, max: 25)',
          },
          offset: {
            type: 'number',
            description:
              'Number of tasks to skip for action=list pagination (default: 0). Pages are snapshots — re-list after mutations.',
          },
          expectedVersion: {
            type: 'number',
            description: 'Task version from your last read; stale writes fail with CONFLICT',
          },
        },
        required: ['action'],
      },
    },
  },
  async (args, context, helpers) => {
    const action = args.action
    const permError = validateActionWithPermission(action, VALID_ACTIONS, 'project_tasks', context.permittedActions)
    if (permError) return permError

    const session = context.sessionManager.getSession(context.sessionId)
    if (!session) return helpers.error(serverT({ en: 'Session not found', fr: 'Session introuvable' }))
    const projectId = session.projectId
    const svc = getTasksService()
    const actor = { actor: 'agent' as const, actorName: 'agent' }

    try {
      switch (action) {
        case 'list': {
          const status = args.status
          if (status !== undefined && !LIST_STATUSES.includes(status)) {
            return helpers.error(
              serverT(
                {
                  en: 'Invalid "status" filter for action=list: "{{status}}". Expected one of: backlog, todo, in_progress, review, done, all.',
                  fr: 'Filtre « status » invalide pour action=list : « {{status}} ». Valeurs attendues : backlog, todo, in_progress, review, done, all.',
                },
                { status: String(status) },
              ),
            )
          }
          const page = parseListPage(args.limit, args.offset)
          if (!page.ok) return helpers.error(page.error)
          const tasks = svc.list(projectId)
          const filtered =
            status === 'all'
              ? tasks
              : tasks.filter((t) => (status === undefined ? t.status !== 'done' : t.status === status))
          const pageTasks = filtered.slice(page.offset, page.offset + page.limit)
          const gates = getGateConfig(projectId)
          return helpers.success(
            JSON.stringify(
              {
                gates,
                tasks: pageTasks.map((t) => taskForAgent(t)),
                total: filtered.length,
                limit: page.limit,
                offset: page.offset,
                hasMore: page.offset + page.limit < filtered.length,
              },
              null,
              2,
            ),
          )
        }

        case 'create': {
          const task = svc.create(
            projectId,
            {
              prompt: args.prompt ?? '',
              ...(args.attachments ? { attachments: sanitizeAttachments(args.attachments) } : {}),
              ...(args.agentId ? { agentId: args.agentId } : {}),
              ...(args.providerId ? { providerId: args.providerId } : {}),
              ...(args.model ? { model: args.model } : {}),
            },
            actor,
          )
          return helpers.success(JSON.stringify(taskForAgent(task), null, 2))
        }

        case 'edit': {
          if (!args.taskId)
            return helpers.error(
              serverT({
                en: 'Parameter "taskId" is required for action=edit',
                fr: 'Le paramètre « taskId » est requis pour action=edit',
              }),
            )
          const result = await svc.update(
            projectId,
            args.taskId,
            {
              ...(args.prompt !== undefined ? { prompt: args.prompt } : {}),
              ...(args.attachments ? { attachments: sanitizeAttachments(args.attachments) } : {}),
              ...(args.agentId !== undefined ? { agentId: args.agentId } : {}),
              ...(args.providerId !== undefined ? { providerId: args.providerId } : {}),
              ...(args.model !== undefined ? { model: args.model } : {}),
            },
            actor,
            args.expectedVersion,
          )
          return helpers.success(JSON.stringify(taskForAgent(result.task), null, 2))
        }

        case 'move': {
          if (!args.taskId)
            return helpers.error(
              serverT({
                en: 'Parameter "taskId" is required for action=move',
                fr: 'Le paramètre « taskId » est requis pour action=move',
              }),
            )
          if (!args.to)
            return helpers.error(
              serverT({
                en: 'Parameter "to" is required for action=move ("todo" | "in_progress" | "done")',
                fr: 'Le paramètre « to » est requis pour action=move (« todo » | « in_progress » | « done »)',
              }),
            )
          const result = await svc.move(projectId, args.taskId, args.to, {
            actor: 'agent',
            actorName: 'agent',
            sessionId: context.sessionId,
            ...(args.reason ? { reason: args.reason } : {}),
            ...(args.expectedVersion ? { expectedVersion: args.expectedVersion } : {}),
          })
          return helpers.success(JSON.stringify(taskForAgent(result.task), null, 2))
        }

        case 'set_gate_value': {
          if (!args.taskId)
            return helpers.error(
              serverT({
                en: 'Parameter "taskId" is required for action=set_gate_value',
                fr: 'Le paramètre « taskId » est requis pour action=set_gate_value',
              }),
            )
          if (!args.gateId)
            return helpers.error(
              serverT({
                en: 'Parameter "gateId" is required for action=set_gate_value',
                fr: 'Le paramètre « gateId » est requis pour action=set_gate_value',
              }),
            )
          if (args.value === undefined)
            return helpers.error(
              serverT({
                en: 'Parameter "value" is required for action=set_gate_value',
                fr: 'Le paramètre « value » est requis pour action=set_gate_value',
              }),
            )
          const result = await svc.setGateValue(
            projectId,
            args.taskId,
            args.gateId,
            args.value,
            actor,
            context.sessionId,
            args.expectedVersion,
          )
          return helpers.success(JSON.stringify(taskForAgent(result.task), null, 2))
        }

        case 'delete': {
          if (!args.taskId)
            return helpers.error(
              serverT({
                en: 'Parameter "taskId" is required for action=delete',
                fr: 'Le paramètre « taskId » est requis pour action=delete',
              }),
            )
          const task = svc.get(projectId, args.taskId)
          if (!task)
            return helpers.error(
              serverT({ en: 'Task not found: {{id}}', fr: 'Tâche introuvable : {{id}}' }, { id: args.taskId ?? '' }),
            )
          await svc.remove(projectId, args.taskId, actor)
          return helpers.success(
            JSON.stringify(
              { message: `Deleted: ${task.prompt.split('\n')[0]}`, taskId: task.id, prompt: task.prompt },
              null,
              2,
            ),
          )
        }

        default:
          return helpers.error(
            serverT(
              { en: 'Unknown action: {{action}}', fr: 'Action inconnue : {{action}}' },
              { action: String(action) },
            ),
          )
      }
    } catch (error) {
      if (isTaskGateError(error)) {
        const missing = error.missing.map((m) => `'${m.name}' (${m.gateId}): ${m.description}`).join('; ')
        return helpers.error(
          serverT(
            {
              en: 'Move blocked by column gates. Missing required gate fields: {{missing}}. Fill them with action=set_gate_value (taskId, gateId, value=<acceptable proof>) and then call move again. You set these values as part of your work — this is the intended loop, not a dead end.',
              fr: 'Déplacement bloqué par les portes de colonne. Champs de porte requis manquants : {{missing}}. Renseignez-les avec action=set_gate_value (taskId, gateId, value=<preuve acceptable>) puis appelez à nouveau move. Vous définissez ces valeurs dans le cadre de votre travail — c’est la boucle prévue, pas une impasse.',
            },
            { missing },
          ),
        )
      }
      if (isTaskConflictError(error)) {
        return helpers.error(
          serverT({
            en: 'Task changed, refresh and retry. Another actor modified this task since your last read. Re-list and retry with the latest updatedAt.',
            fr: 'Tâche modifiée, actualisez et réessayez. Un autre acteur a modifié cette tâche depuis votre dernière lecture. Re-listez et réessayez avec le updatedAt le plus récent.',
          }),
        )
      }
      throw error
    }
  },
)

// Kept in sync with the service's allowed destination enum.
export const PROJECT_TASKS_ACTIONS = VALID_ACTIONS

// ============================================================================
// Helpers
// ============================================================================

type ListPage = { ok: true; limit: number; offset: number } | { ok: false; error: string }

function parseListPage(limit: number | undefined, offset: number | undefined): ListPage {
  const pageSize = limit ?? LIST_DEFAULT_LIMIT
  const skip = offset ?? 0
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > LIST_MAX_LIMIT) {
    return { ok: false, error: `Invalid "limit" for action=list: must be an integer between 1 and ${LIST_MAX_LIMIT}.` }
  }
  if (!Number.isInteger(skip) || skip < 0) {
    return { ok: false, error: 'Invalid "offset" for action=list: must be a non-negative integer.' }
  }
  return { ok: true, limit: pageSize, offset: skip }
}

function taskForAgent(task: import('../../shared/types.js').ProjectTask) {
  return {
    id: task.id,
    prompt: task.prompt,
    status: task.status,
    ...(task.runState ? { runState: task.runState } : {}),
    ...(task.queuePosition ? { queuePosition: task.queuePosition } : {}),
    ...(task.activeSessionId ? { boundSession: task.activeSessionId } : {}),
    ...(task.model ? { model: task.model } : {}),
    version: task.version,
    attachments: task.attachments.length,
    gateValues: task.gateValues.map((v) => ({ [v.gateId]: v.value, actor: v.actor, timestamp: v.timestamp })),
    auditTrail: task.auditTrail.map((a) => ({
      action: a.action,
      actor: a.actor,
      detail: a.detail,
      timestamp: a.timestamp,
    })),
    updatedAt: task.updatedAt,
  }
}

function sanitizeAttachments(raw: unknown[]): import('../../shared/types.js').Attachment[] {
  return raw.filter(
    (a): a is import('../../shared/types.js').Attachment =>
      typeof a === 'object' &&
      a !== null &&
      typeof (a as { id?: unknown }).id === 'string' &&
      typeof (a as { filename?: unknown }).filename === 'string',
  )
}
