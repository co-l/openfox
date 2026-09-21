import { createTool, validateActionWithPermission, type ToolHelpers } from './tool-helpers.js'
import type { TasksService } from '../tasks/service.js'
import { isTaskGateError, isTaskConflictError } from '../tasks/service.js'
import { getGateConfig } from '../db/tasks.js'
import { serverT } from '../i18n.js'
import { OUTPUT_LIMITS } from './types.js'
import { decodeDataUrl } from '../utils/data-url.js'
import { isPdfBuffer, extractPdfText, processPdfContent, formatPdfErrorMessage } from './pdf-utils.js'
import type { Attachment, ToolResult } from '../../shared/types.js'
import { TEXT_MIME_EXACT, TEXT_MIME_PREFIXES } from '../../shared/constants.js'

/**
 * project_tasks — agent participation on the project task board.
 *
 * Lean agent surface: list, create, edit, move, set_gate_value, get_attachment, delete.
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

type TaskAction = 'list' | 'create' | 'edit' | 'move' | 'set_gate_value' | 'delete' | 'get_attachment'

const VALID_ACTIONS: TaskAction[] = ['list', 'create', 'edit', 'move', 'set_gate_value', 'delete', 'get_attachment']

const LIST_STATUSES = ['todo', 'in_progress', 'done', 'all'] as const

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
  to?: 'todo' | 'in_progress' | 'done'
  reason?: string
  gateId?: string
  attachmentId?: string
  value?: string
  status?: 'todo' | 'in_progress' | 'done' | 'all'
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
        'Kanban task board for this project. Core loop: list → move → set_gate_value.\n\n' +
        'Rules:\n' +
        '- Moving to in_progress binds the task to YOUR current session.\n' +
        '- Do not move tasks or fill gate values without explicit user approval or a system instruction — ' +
        'complete the work, then let the user review before the task advances.\n' +
        '- Moving to done is blocked by unmet gates: the error names the missing fields — fill them only with ' +
        'user approval, then retry the move.\n' +
        '- Stale writes fail with CONFLICT — re-list and retry.\n\n' +
        'Actions:\n' +
        '- list: tasks (status, gate values, queue position, bound session, audit trail); defaults to open tasks, ' +
        'filter via status (todo | in_progress | done | all); paginated — limit 10 max 25, page with offset\n' +
        '- create: add a task to To Do (prompt required)\n' +
        '- edit: update prompt/attachments/agent/model (taskId + fields)\n' +
        '- move: change column (to: todo | in_progress | done; optional reason)\n' +
        '- set_gate_value: fill a gate field (taskId, gateId, value)\n' +
        '- get_attachment: read a task attachment (taskId, attachmentId from attachmentList) — text inline, ' +
        'images as image data, PDFs as extracted text\n' +
        '- delete: remove a task (taskId)',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: VALID_ACTIONS, description: 'The action to perform' },
          taskId: {
            type: 'string',
            description: 'Target task id (edit, move, set_gate_value, get_attachment, delete)',
          },
          attachmentId: {
            type: 'string',
            description: 'Attachment id for action=get_attachment (see attachmentList in list output)',
          },
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
          to: { type: 'string', enum: ['todo', 'in_progress', 'done'], description: 'Destination column for move' },
          reason: { type: 'string', description: 'Optional short reason (recorded in the audit trail) for reverts' },
          gateId: { type: 'string', description: 'Gate field id for set_gate_value' },
          value: { type: 'string', description: 'Proof/evidence value for set_gate_value' },
          status: {
            type: 'string',
            enum: ['todo', 'in_progress', 'done', 'all'],
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
                  en: 'Invalid "status" filter for action=list: "{{status}}". Expected one of: todo, in_progress, done, all.',
                  fr: 'Filtre « status » invalide pour action=list : « {{status}} ». Valeurs attendues : todo, in_progress, done, all.',
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

        case 'get_attachment': {
          if (!args.taskId)
            return helpers.error(
              serverT({
                en: 'Parameter "taskId" is required for action=get_attachment',
                fr: 'Le paramètre « taskId » est requis pour action=get_attachment',
              }),
            )
          if (!args.attachmentId)
            return helpers.error(
              serverT({
                en: 'Parameter "attachmentId" is required for action=get_attachment',
                fr: 'Le paramètre « attachmentId » est requis pour action=get_attachment',
              }),
            )
          const task = svc.get(projectId, args.taskId)
          if (!task)
            return helpers.error(
              serverT({ en: 'Task not found: {{id}}', fr: 'Tâche introuvable : {{id}}' }, { id: args.taskId }),
            )
          if (task.attachments.length === 0)
            return helpers.error(
              serverT(
                { en: 'Task {{id}} has no attachments', fr: 'La tâche {{id}} n’a aucune pièce jointe' },
                { id: task.id },
              ),
            )
          const attachment = task.attachments.find((a) => a.id === args.attachmentId)
          if (!attachment) {
            const available = task.attachments.map((a) => `${a.id} (${a.filename})`).join(', ')
            return helpers.error(
              serverT(
                {
                  en: 'Attachment {{id}} not found on task {{taskId}}. Available: {{available}}',
                  fr: 'Pièce jointe {{id}} introuvable sur la tâche {{taskId}}. Disponibles : {{available}}',
                },
                { id: args.attachmentId, taskId: task.id, available },
              ),
            )
          }
          return await attachmentContent(attachment, helpers)
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
    ...(task.attachments.length > 0
      ? {
          attachmentList: task.attachments.map((a) => ({
            id: a.id,
            filename: a.filename,
            mimeType: a.mimeType,
            size: a.size,
          })),
        }
      : {}),
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

function sanitizeAttachments(raw: unknown[]): Attachment[] {
  return raw.filter(
    (a): a is Attachment =>
      typeof a === 'object' &&
      a !== null &&
      typeof (a as { id?: unknown }).id === 'string' &&
      typeof (a as { filename?: unknown }).filename === 'string',
  )
}

/**
 * Render a task attachment for the agent, reusing read_file's output shapes so the
 * existing tool-result → attachment → image_url pipeline applies unchanged.
 */
async function attachmentContent(attachment: Attachment, helpers: ToolHelpers): Promise<ToolResult> {
  const mime = attachment.mimeType
  const filename = attachment.filename

  if (mime.startsWith('image/')) {
    const decoded = decodeDataUrl(attachment.data)
    if (!decoded)
      return helpers.error(
        serverT(
          {
            en: 'Image attachment {{filename}} has corrupt or undecodable data',
            fr: 'La pièce jointe image {{filename}} est corrompue ou illisible',
          },
          { filename },
        ),
      )
    const size = attachment.size > 0 ? attachment.size : decoded.length
    if (size > OUTPUT_LIMITS.read_file.maxImageBytes || decoded.length > OUTPUT_LIMITS.read_file.maxImageBytes) {
      return helpers.error(
        serverT(
          {
            en: 'Image attachment {{filename}} ({{size}} bytes) exceeds the image size limit ({{limit}} bytes, same as read_file). Stored attachments cannot be modified in place — ask the user to compress or downsize the image and re-upload it.',
            fr: 'La pièce jointe image {{filename}} ({{size}} octets) dépasse la limite pour les images ({{limit}} octets, comme read_file). Les pièces jointes stockées ne peuvent pas être modifiées en place — demandez à l’utilisateur de compacter ou réduire l’image et de la réenvoyer.',
          },
          { filename, size, limit: OUTPUT_LIMITS.read_file.maxImageBytes },
        ),
      )
    }
    const base64Data = decoded.toString('base64')
    return helpers.success(
      serverT(
        {
          en: '[Attachment: {{filename}} ({{mime}}, {{size}} bytes)]',
          fr: '[Pièce jointe : {{filename}} ({{mime}}, {{size}} octets)]',
        },
        { filename, mime, size },
      ),
      false,
      {
        metadata: {
          mimeType: mime,
          size,
          base64Data,
          dataUrl: `data:${mime};base64,${base64Data}`,
          path: filename,
          ...(attachment.description ? { description: attachment.description } : {}),
        },
      },
    )
  }

  // Same text-MIME set as the chat attachment pipeline (TEXT_MIME_EXACT + prefixes).
  // image/* was matched first, so image/svg+xml from TEXT_MIME_EXACT never lands here.
  if (TEXT_MIME_EXACT.includes(mime) || TEXT_MIME_PREFIXES.some((p) => mime.startsWith(p))) {
    const decoded = decodeDataUrl(attachment.data)
    const text = decoded ? decoded.toString('utf-8') : attachment.data
    if (text.length > OUTPUT_LIMITS.read_file.maxBytes) {
      return helpers.success(
        text.slice(0, OUTPUT_LIMITS.read_file.maxBytes) + '\n\n[Output truncated due to size limit]',
        true,
      )
    }
    return helpers.success(text, false)
  }

  if (mime === 'application/pdf') {
    if (attachment.pdfContent) {
      const text = attachment.pdfContent
      const truncated = text.length > OUTPUT_LIMITS.read_file.maxBytes
      return helpers.success(
        truncated ? text.slice(0, OUTPUT_LIMITS.read_file.maxBytes) + '\n\n[Output truncated due to size limit]' : text,
        truncated,
      )
    }
    const buffer = decodeDataUrl(attachment.data)
    if (!buffer || !isPdfBuffer(buffer))
      return helpers.error(
        serverT(
          {
            en: 'PDF attachment {{filename}} has corrupt or undecodable data',
            fr: 'La pièce jointe PDF {{filename}} est corrompue ou illisible',
          },
          { filename },
        ),
      )
    try {
      const { text, pageCount, title, author } = await extractPdfText(buffer)
      const { output, truncated, isScanned } = processPdfContent(text, OUTPUT_LIMITS.read_file.maxBytes)
      const metadata = { format: 'pdf', pageCount, title, author, path: filename }
      if (isScanned) {
        return helpers.success(
          serverT(
            {
              en: '[PDF: {{filename}} — This PDF has no text layer (scanned or image-only), so its text cannot be extracted. Ask the user to re-upload a version with a text layer, or to describe its content.]',
              fr: '[PDF : {{filename}} — Ce PDF n’a pas de couche texte (scanné ou image uniquement), son texte ne peut donc pas être extrait. Demandez à l’utilisateur de renvoyer une version avec une couche texte, ou de décrire son contenu.]',
            },
            { filename },
          ),
          false,
          { metadata },
        )
      }
      return helpers.success(output, truncated, { metadata })
    } catch (err) {
      return helpers.error(formatPdfErrorMessage(err))
    }
  }

  return helpers.error(
    serverT(
      {
        en: 'Unsupported attachment type: {{mime}} ({{filename}}). Supported: image/*, text/* and common text types (JSON, XML, YAML, …), application/pdf.',
        fr: 'Type de pièce jointe non pris en charge : {{mime}} ({{filename}}). Pris en charge : image/*, text/* et les types texte courants (JSON, XML, YAML, …), application/pdf.',
      },
      { mime, filename },
    ),
  )
}
