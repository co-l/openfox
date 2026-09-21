import { z } from 'zod'
import type {
  Attachment,
  MetadataEntry,
  Project,
  Session,
  WorkflowExecution,
  WorkflowLaunchScope,
} from '../../../shared/types.js'
import { projectSessionStatus } from '../../routes/session-status.js'
import type { WorkflowLaunchPayload } from '../../runner/launch.js'
import type { OpenFoxMcpTool, OpenFoxMcpToolDeps, OpenFoxMcpToolResult } from './types.js'

const CONTINUE_PROMPT = 'Continue working on the acceptance criteria.'
const MAX_DETAIL_CONTENT_LENGTH_DEFAULT = 400
const MIN_DETAIL_CONTENT_LENGTH = 50
const MAX_DETAIL_CONTENT_LENGTH_HARD_CAP = 10000

const WAIT_TIMEOUT_SECONDS_DEFAULT = 60
const WAIT_TIMEOUT_SECONDS_MIN = 5
const WAIT_TIMEOUT_SECONDS_MAX = 600
const WAIT_POLL_INTERVAL_MS = 500
const WAIT_IDLE_GRACE_MS = 2000

const METADATA_SCHEMAS: Record<string, { description: string; fields: Record<string, string>; defaultStatus: string }> =
  {
    criteria: {
      description: 'Acceptance criteria that drive workflow transitions',
      fields: {
        id: 'string (auto-generated)',
        description: 'string — what needs to be done and how to verify it',
        status: 'pending | completed | passed | failed',
      },
      defaultStatus: 'pending',
    },
    todos: {
      description: 'Task tracking items for the builder',
      fields: {
        id: 'string (auto-generated)',
        description: 'string — task description',
        status: 'pending | in_progress | completed',
      },
      defaultStatus: 'pending',
    },
    review_findings: {
      description: 'Code review findings from the code_reviewer sub-agent',
      fields: {
        id: 'string (auto-generated)',
        description: 'string — finding description',
        status: 'open | resolved | dismissed',
        severity: 'minor | major | critical (optional)',
      },
      defaultStatus: 'open',
    },
  }

export interface Settlement {
  settled: boolean
  outcome: 'completed' | 'blocked' | 'waiting' | null
}

export function computeSettlement(
  session: Session,
  pendingQuestionsCount: number,
  pendingConfirmationsCount: number,
  activeExecutionStatus: WorkflowExecution['status'] | null,
  completedEvidence = false,
): Settlement {
  if (session.phase === 'done') return { settled: true, outcome: 'completed' }
  if (session.phase === 'blocked') return { settled: true, outcome: 'blocked' }
  const waitingForUser =
    pendingQuestionsCount > 0 || pendingConfirmationsCount > 0 || activeExecutionStatus === 'waiting'
  if (waitingForUser) return { settled: true, outcome: 'waiting' }
  // Evidence the session has run (a turn finished during the wait, or it
  // already had work before the wait started) and is now idle means it is done
  // — plain chat turns settle without a phase change, unlike workflow runs
  // which end in done/blocked.
  if (completedEvidence && !session.isRunning) return { settled: true, outcome: 'completed' }
  return { settled: false, outcome: null }
}

function workflowPayload(execution: WorkflowExecution | null): Record<string, unknown> | null {
  if (!execution) return null
  const pausedAtUserStep = execution.status === 'waiting' && (execution.pendingChoices?.length ?? 0) > 0
  return {
    id: execution.id,
    name: execution.workflowName,
    status: execution.status,
    ...(execution.currentStepId ? { currentStepId: execution.currentStepId } : {}),
    ...(execution.currentStepName ? { currentStepName: execution.currentStepName } : {}),
    stepOutput: execution.stepOutput,
    ...(execution.pendingChoices ? { pendingChoices: execution.pendingChoices } : {}),
    ...(execution.subGroup ? { subGroup: execution.subGroup } : {}),
    ...(pausedAtUserStep
      ? { resumeHint: 'Call openfox_resume_workflow with choice set to one of the pendingChoices ids above.' }
      : {}),
  }
}

function normalizeMetadataId(id: unknown): string | undefined {
  if (typeof id !== 'string' && typeof id !== 'number') return undefined
  if (id === '') return undefined
  return String(id)
}

function resolveWaitTimeout(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return WAIT_TIMEOUT_SECONDS_DEFAULT
  return Math.max(WAIT_TIMEOUT_SECONDS_MIN, Math.min(WAIT_TIMEOUT_SECONDS_MAX, Math.floor(value)))
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function ok(payload: unknown): OpenFoxMcpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] }
}

function fail(message: string): OpenFoxMcpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true }
}

function truncate(content: string, maxLength: number): string {
  return content.length > maxLength ? `${content.slice(0, maxLength)}...` : content
}

function resolveMaxContentLength(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return MAX_DETAIL_CONTENT_LENGTH_DEFAULT
  return Math.max(MIN_DETAIL_CONTENT_LENGTH, Math.min(MAX_DETAIL_CONTENT_LENGTH_HARD_CAP, Math.floor(value)))
}

function buildSessionStatusPayload(sessionId: string, deps: OpenFoxMcpToolDeps): Record<string, unknown> | null {
  const session = deps.sessionManager.getSession(sessionId)
  if (!session) return null
  const pendingQuestions = deps.pendingQuestions(sessionId)
  const pendingConfirmations = deps.pendingConfirmations(sessionId)
  const activeExecution = deps.sessionManager.getActiveWorkflowExecution(sessionId)
  const status = projectSessionStatus({
    session,
    pendingQuestionsCount: pendingQuestions.length,
    pendingConfirmationsCount: pendingConfirmations.length,
    activeWorkflowStepName: activeExecution?.currentStepName ?? null,
  })
  return {
    ...status,
    isRunning: session.isRunning,
    pauseState: session.pauseState ?? 'none',
    pending: { questions: pendingQuestions, confirmations: pendingConfirmations },
    workflow: workflowPayload(activeExecution),
  }
}

export function createOpenFoxMcpTools(deps: OpenFoxMcpToolDeps): OpenFoxMcpTool[] {
  const { sessionManager } = deps

  const requireSession = (sessionId: unknown): { ok: true; session: Session } | { ok: false; error: string } => {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      return { ok: false, error: 'sessionId is required' }
    }
    const session = sessionManager.getSession(sessionId)
    if (!session) {
      return { ok: false, error: `Session not found: ${sessionId}` }
    }
    return { ok: true, session }
  }

  const requireSessionAndId = (
    args: Record<string, unknown>,
  ): { ok: true; session: Session; sessionId: string } | { ok: false; error: string } => {
    const check = requireSession(args['sessionId'])
    if (!check.ok) return check
    return { ok: true, session: check.session, sessionId: check.session.id }
  }

  const resolvePendingCallId = (
    sessionId: string,
    callId: unknown,
    pending: Array<{ callId: string }>,
    noun: 'question' | 'confirmation',
  ): { kind: 'list' } | { kind: 'found'; callId: string } | { kind: 'error'; error: string } => {
    if (typeof callId !== 'string' || callId.length === 0) {
      return { kind: 'list' }
    }
    if (!pending.some((item) => item.callId === callId)) {
      return { kind: 'error', error: `No pending ${noun} with callId "${callId}" for session ${sessionId}` }
    }
    return { kind: 'found', callId }
  }

  const tools: OpenFoxMcpTool[] = [
    {
      name: 'openfox_projects',
      description: 'List all OpenFox projects.',
      inputSchema: {},
      handler: async () => {
        const projects: Project[] = deps.listProjects()
        return ok(projects)
      },
    },
    {
      name: 'openfox_create_project',
      description:
        'Create a new OpenFox project at the given directory. Creates the directory and initializes git if missing, then registers the project.',
      inputSchema: {
        name: z.string().describe('Project name (letters, numbers, hyphens, underscores, dots, spaces)'),
        workdir: z.string().describe('Absolute path of the project directory'),
      },
      handler: async (args) => {
        const name = args['name']
        const workdir = args['workdir']
        if (typeof name !== 'string' || name.trim().length === 0) {
          return fail('name is required')
        }
        if (typeof workdir !== 'string' || workdir.trim().length === 0) {
          return fail('workdir is required')
        }
        try {
          const project = await deps.createProject(name.trim(), workdir.trim())
          return ok({ project })
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error))
        }
      },
    },
    {
      name: 'openfox_delete_project',
      description: 'Delete an OpenFox project and all its sessions by id.',
      inputSchema: {
        projectId: z.string().describe('Project id to delete'),
      },
      handler: async (args) => {
        const projectId = args['projectId']
        if (typeof projectId !== 'string' || projectId.length === 0) {
          return fail('projectId is required')
        }
        const deleted = deps.deleteProject(projectId)
        return ok({ deleted })
      },
    },
    {
      name: 'openfox_create_session',
      description:
        'Create a new OpenFox session in a project, optionally selecting an agent (e.g. planner or builder) as the session mode.',
      inputSchema: {
        projectId: z.string().describe('Project to create the session in'),
        title: z.string().optional().describe('Optional session title'),
        agentId: z
          .string()
          .optional()
          .describe('Optional agent to use as the session mode (validated against available top-level agents)'),
      },
      handler: async (args) => {
        const projectId = args['projectId']
        if (typeof projectId !== 'string' || projectId.length === 0) {
          return fail('projectId is required')
        }
        const title = typeof args['title'] === 'string' ? args['title'] : undefined
        const rawAgentId = args['agentId']
        const agentId = typeof rawAgentId === 'string' && rawAgentId.trim().length > 0 ? rawAgentId : undefined
        try {
          const session = sessionManager.createSession(projectId, title, null, null)
          if (agentId) {
            const project = sessionManager.getProject(projectId)
            const topLevelIds = project ? await deps.topLevelAgentIds(project.workdir) : []
            if (!topLevelIds.includes(agentId)) {
              return fail(
                `Invalid agentId "${agentId}". Must be one of: ${topLevelIds.join(', ') || '(none available)'}`,
              )
            }
            sessionManager.setMode(session.id, agentId)
          }
          return ok({
            sessionId: session.id,
            projectId,
            title: session.metadata?.title ?? title ?? null,
            mode: agentId ?? session.mode,
          })
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error))
        }
      },
    },
    {
      name: 'openfox_set_mode',
      description:
        'Switch an existing session to a different mode (agent, e.g. planner or builder) at any time. The mode is validated against the session project\u2019s top-level agents.',
      inputSchema: {
        sessionId: z.string().describe('Session to switch'),
        mode: z.string().describe('Target mode: one of the session project\u2019s top-level agents'),
      },
      handler: async (args) => {
        const check = requireSession(args['sessionId'])
        if (!check.ok) return fail(check.error)
        const session = check.session

        const mode = args['mode']
        if (typeof mode !== 'string' || mode.trim().length === 0) {
          return fail('mode is required')
        }

        const project = sessionManager.getProject(session.projectId)
        const topLevelIds = project ? await deps.topLevelAgentIds(project.workdir) : []
        if (!topLevelIds.includes(mode)) {
          return fail(`Invalid mode "${mode}". Must be one of: ${topLevelIds.join(', ') || '(none available)'}`)
        }

        const updated = sessionManager.setMode(session.id, mode)
        return ok({ sessionId: session.id, mode: updated?.mode ?? mode })
      },
    },
    {
      name: 'openfox_sessions',
      description: 'List sessions, optionally scoped to a project, with running state and pending interaction counts.',
      inputSchema: {
        projectId: z.string().optional().describe('Scope the listing to a project'),
        limit: z.number().int().positive().optional().describe('Maximum sessions to return (default 20)'),
        offset: z.number().int().nonnegative().optional().describe('Number of sessions to skip (default 0)'),
      },
      handler: async (args) => {
        const limit = typeof args['limit'] === 'number' ? args['limit'] : 20
        const offset = typeof args['offset'] === 'number' ? args['offset'] : 0
        const projectId = args['projectId']
        const result =
          typeof projectId === 'string' && projectId.length > 0
            ? sessionManager.listSessionsByProject(projectId, limit, offset)
            : sessionManager.listSessionsLimited(limit, offset)

        const sessions = result.sessions.map((s) => ({
          id: s.id,
          projectId: s.projectId,
          title: s.title ?? null,
          isRunning: s.isRunning,
          pendingQuestionCount: deps.pendingQuestions(s.id).length,
          pendingConfirmationCount: deps.pendingConfirmations(s.id).length,
          pausedWorkflowStep: sessionManager.getActiveWorkflowExecution(s.id)?.status === 'waiting',
          updatedAt: s.updatedAt,
        }))
        return ok({ sessions, hasMore: result.hasMore })
      },
    },
    {
      name: 'openfox_session_status',
      description:
        'Read a session state snapshot: projected status, running flag, active workflow execution (including a paused user step with its choices), pending questions and confirmations, last activity, and a UI link.',
      inputSchema: {
        sessionId: z.string().describe('Session to inspect'),
      },
      handler: async (args) => {
        const check = requireSession(args['sessionId'])
        if (!check.ok) return fail(check.error)
        const payload = buildSessionStatusPayload(check.session.id, deps)
        if (!payload) return fail(`Session not found: ${check.session.id}`)
        return ok(payload)
      },
    },
    {
      name: 'openfox_session_detail',
      description:
        'Read the most recent messages of a session (content truncated) so progress can be followed without a live WebSocket.',
      inputSchema: {
        sessionId: z.string().describe('Session to read'),
        limit: z.number().int().positive().optional().describe('Maximum messages to return (default 20, capped at 50)'),
        maxContentLength: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Maximum content length per message (default 400, clamped to 50–10000)'),
      },
      handler: async (args) => {
        const check = requireSession(args['sessionId'])
        if (!check.ok) return fail(check.error)
        const limit = typeof args['limit'] === 'number' ? args['limit'] : 20
        const maxContentLength = resolveMaxContentLength(args['maxContentLength'])
        const { messages, hiddenCount } = deps.recentMessages(check.session.id, limit)
        return ok({
          messages: messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: truncate(message.content ?? '', maxContentLength),
            ...(message.toolCalls && message.toolCalls.length > 0
              ? { toolCalls: message.toolCalls.map((toolCall) => toolCall.name) }
              : {}),
          })),
          hiddenCount,
        })
      },
    },
    {
      name: 'openfox_session_metadata',
      description:
        'Manage structured session data by key (criteria, todos, review_findings, ...). Actions: get (list entries for a key), list (keys), add, update, remove, schema. Writes land in the same store as the agent\u2019s session_metadata tool, so they drive workflow transitions.',
      inputSchema: {
        sessionId: z.string().describe('Session to manage'),
        action: z.enum(['get', 'list', 'add', 'update', 'remove', 'schema']).describe('Operation to perform'),
        key: z.string().optional().describe('Metadata key (required for get/add/update/remove/schema)'),
        id: z.string().optional().describe('Item id (required for update and remove)'),
        description: z.string().optional().describe('Item description (required for add)'),
        status: z.string().optional().describe('Item status (for add/update)'),
      },
      handler: async (args) => {
        const check = requireSession(args['sessionId'])
        if (!check.ok) return fail(check.error)
        const session = check.session
        const action = args['action']
        const key = typeof args['key'] === 'string' && args['key'].length > 0 ? args['key'] : undefined
        const entries = session.metadataEntries ?? {}

        if (action === 'list') {
          return ok({ keys: Object.entries(entries).map(([k, v]) => ({ key: k, count: v.length })) })
        }

        if (action === 'schema') {
          if (!key) return fail('key is required for schema')
          const schema = METADATA_SCHEMAS[key]
          if (!schema) return ok({ key, generic: true })
          return ok({ key, description: schema.description, fields: schema.fields })
        }

        if (action === 'get') {
          if (!key) return fail('key is required for get')
          return ok({ key, entries: entries[key] ?? [] })
        }

        if (action === 'add') {
          if (!key) return fail('key is required for add')
          const description = args['description']
          if (typeof description !== 'string' || description.trim().length === 0) {
            return fail('description is required for add')
          }
          const current = entries[key] ?? []
          const newEntry: MetadataEntry = {
            id: normalizeMetadataId(args['id']) ?? (current.length + 1).toString(),
            description,
            status:
              typeof args['status'] === 'string' ? args['status'] : (METADATA_SCHEMAS[key]?.defaultStatus ?? 'pending'),
          }
          const updated = [...current, newEntry]
          deps.setMetadataEntries(session.id, key, updated)
          return ok({ key, added: newEntry, entries: updated })
        }

        if (action === 'update') {
          if (!key) return fail('key is required for update')
          const id = normalizeMetadataId(args['id'])
          if (!id) return fail('id is required for update')
          const current = entries[key]
          if (!current) return fail(`Key "${key}" not found`)
          const idx = current.findIndex((e) => e.id === id)
          if (idx === -1) return fail(`Item "${id}" not found in "${key}"`)
          const description = args['description']
          const status = args['status']
          if (typeof description !== 'string' && typeof status !== 'string') {
            return fail('provide at least one of description or status for update')
          }
          const updated = current.map((e, i) =>
            i === idx
              ? {
                  ...e,
                  ...(typeof description === 'string' ? { description } : {}),
                  ...(typeof status === 'string' ? { status } : {}),
                }
              : e,
          )
          deps.setMetadataEntries(session.id, key, updated)
          return ok({ key, updated: id, entries: updated })
        }

        if (action === 'remove') {
          if (!key) return fail('key is required for remove')
          const id = normalizeMetadataId(args['id'])
          if (!id) return fail('id is required for remove')
          const current = entries[key]
          if (!current) return fail(`Key "${key}" not found`)
          const updated = current.filter((e) => e.id !== id)
          if (updated.length === current.length) return fail(`Item "${id}" not found in "${key}"`)
          deps.setMetadataEntries(session.id, key, updated)
          return ok({ key, removed: id, entries: updated })
        }

        return fail(`Unknown action "${String(action)}". Must be one of: get, list, add, update, remove, schema`)
      },
    },
    {
      name: 'openfox_send_message',
      description:
        'Queue a message for a session. Safe on running sessions (queued, processed at the next turn boundary) and starts a new turn on idle sessions. Returns the queue state.',
      inputSchema: {
        sessionId: z.string().describe('Session to message'),
        content: z.string().optional().describe('Message content'),
        attachments: z.array(z.record(z.string(), z.unknown())).optional().describe('Optional attachments'),
        messageKind: z.string().optional().describe('Optional message kind tag'),
      },
      handler: async (args) => {
        const check = requireSession(args['sessionId'])
        if (!check.ok) return fail(check.error)
        const content = typeof args['content'] === 'string' ? args['content'] : undefined
        const rawAttachments = args['attachments']
        const attachments = Array.isArray(rawAttachments) ? (rawAttachments as unknown as Attachment[]) : undefined
        const messageKind = typeof args['messageKind'] === 'string' ? args['messageKind'] : undefined
        if (!content?.trim() && !(attachments && attachments.length > 0)) {
          return fail('content or attachments is required')
        }
        sessionManager.queueMessage(check.session.id, 'asap', content, attachments, messageKind)
        return ok({ queued: true, queueState: sessionManager.getQueueState(check.session.id) })
      },
    },
    {
      name: 'openfox_continue',
      description:
        'Continue an idle or blocked session: a blocked session is reset to the build phase and an auto-prompt is queued; an idle session is acknowledged (use openfox_send_message to drive it with content).',
      inputSchema: {
        sessionId: z.string().describe('Session to continue'),
      },
      handler: async (args) => {
        const check = requireSessionAndId(args)
        if (!check.ok) return fail(check.error)
        const { session, sessionId } = check

        if (session.isRunning) {
          return fail(`Session ${sessionId} is already running`)
        }
        if (session.phase === 'blocked') {
          sessionManager.setPhase(sessionId, 'build')
          sessionManager.queueMessage(sessionId, 'asap', CONTINUE_PROMPT, undefined, 'auto-prompt')
          return ok({ accepted: true })
        }
        return ok({
          accepted: true,
          note: `Session ${sessionId} is idle — use openfox_send_message to give it work.`,
        })
      },
    },
    {
      name: 'openfox_wait',
      description:
        'Block until a session settles: it finishes (completed), blocks (blocked), or pauses for the user (waiting — a pending question, path confirmation, or a paused workflow user step). Returns the outcome and a full status snapshot, or times out.',
      inputSchema: {
        sessionId: z.string().describe('Session to wait on'),
        timeout: z.number().int().positive().optional().describe('Maximum wait in seconds (default 60, clamped 5–600)'),
      },
      handler: async (args) => {
        const check = requireSession(args['sessionId'])
        if (!check.ok) return fail(check.error)
        const sessionId = check.session.id
        const timeoutSeconds = resolveWaitTimeout(args['timeout'])
        const startedAt = Date.now()
        const deadline = startedAt + timeoutSeconds * 1000
        const graceUntil = startedAt + WAIT_IDLE_GRACE_MS
        let sawRunning = false

        while (true) {
          const session = sessionManager.getSession(sessionId)
          if (!session) return fail(`Session not found: ${sessionId}`)
          if (session.isRunning) sawRunning = true
          const pendingQuestions = deps.pendingQuestions(sessionId)
          const pendingConfirmations = deps.pendingConfirmations(sessionId)
          const activeExecution = sessionManager.getActiveWorkflowExecution(sessionId)
          const now = Date.now()
          const hasWork = (session.messages?.length ?? 0) > 0
          // A session idle with prior work has finished. The grace window lets
          // a just-queued turn kick in before we conclude this, so we don't
          // race send_message on a reused session.
          const completedEvidence = sawRunning || (hasWork && now >= graceUntil)
          const settlement = computeSettlement(
            session,
            pendingQuestions.length,
            pendingConfirmations.length,
            activeExecution?.status ?? null,
            completedEvidence,
          )

          if (settlement.settled) {
            return ok({
              settled: true,
              outcome: settlement.outcome,
              waitedMs: now - startedAt,
              status: buildSessionStatusPayload(sessionId, deps),
            })
          }
          if (now >= deadline) {
            return ok({
              settled: false,
              timedOut: true,
              waitedMs: now - startedAt,
              status: buildSessionStatusPayload(sessionId, deps),
            })
          }
          await sleep(WAIT_POLL_INTERVAL_MS)
        }
      },
    },
    {
      name: 'openfox_stop',
      description:
        'Stop a session completely: drains the queue, aborts the active execution, and cancels pending interactions.',
      inputSchema: {
        sessionId: z.string().describe('Session to stop'),
      },
      handler: async (args) => {
        const check = requireSession(args['sessionId'])
        if (!check.ok) return fail(check.error)
        deps.stopSession(check.session.id)
        return ok({ stopped: true })
      },
    },
    {
      name: 'openfox_workflows',
      description:
        'List the workflows available to a project (builtin, user, and project scope) with their parameters.',
      inputSchema: {
        projectDir: z.string().optional().describe('Project directory for project-scoped workflows'),
      },
      handler: async (args) => {
        const projectDir = typeof args['projectDir'] === 'string' ? args['projectDir'] : undefined
        return ok(await deps.listWorkflows(projectDir))
      },
    },
    {
      name: 'openfox_launch_workflow',
      description:
        'Launch (or resume) a workflow run in a session. On idle sessions the run starts immediately; on running sessions it is queued as a workflow-launch marker. Supports resuming paused user steps via resumeFrom/userChoice.',
      inputSchema: {
        sessionId: z.string().describe('Session to run the workflow in'),
        workflowId: z.string().optional().describe('Workflow to run (default: the active workflow)'),
        params: z.record(z.string(), z.string()).optional().describe('Workflow parameters'),
        subGroup: z.string().optional().describe('Run only a sub-group slice of the workflow'),
        scope: z.enum(['builtin', 'user', 'project']).optional().describe('Workflow scope to resolve from'),
        resumeFrom: z.string().optional().describe('Step id to resume a paused workflow from'),
        stepOutput: z.record(z.string(), z.string()).optional().describe('Step output supplied when resuming'),
        userChoice: z.string().optional().describe('Branch chosen by the user at a paused user step'),
        content: z.string().optional().describe('Optional extra instruction for the run'),
      },
      handler: async (args) => {
        const check = requireSessionAndId(args)
        if (!check.ok) return fail(check.error)
        const { session, sessionId } = check

        const payload: WorkflowLaunchPayload = {
          ...(typeof args['workflowId'] === 'string' ? { workflowId: args['workflowId'] as string } : {}),
          ...(args['params'] && typeof args['params'] === 'object'
            ? { params: args['params'] as Record<string, string> }
            : {}),
          ...(typeof args['subGroup'] === 'string' ? { subGroup: args['subGroup'] as string } : {}),
          ...(typeof args['scope'] === 'string' ? { scope: args['scope'] as WorkflowLaunchScope } : {}),
          ...(typeof args['resumeFrom'] === 'string' ? { resumeFrom: args['resumeFrom'] as string } : {}),
          ...(args['stepOutput'] && typeof args['stepOutput'] === 'object'
            ? { stepOutput: args['stepOutput'] as Record<string, string> }
            : {}),
          ...(typeof args['userChoice'] === 'string' ? { userChoice: args['userChoice'] as string } : {}),
          ...(typeof args['content'] === 'string' ? { content: args['content'] as string } : {}),
        }

        if (payload.workflowId && !payload.resumeFrom) {
          const workflows = await deps.listWorkflows(session.workdir)
          const known = workflows.some((w) => w.id === payload.workflowId)
          if (!known) {
            return fail(`Workflow "${payload.workflowId}" not found for project ${session.workdir}`)
          }
        }

        if (session.isRunning) {
          let fullContent = payload.content ?? ''
          if (payload.workflowId) {
            const workflowInfo = `// Workflow: ${payload.workflowId}`
            fullContent = fullContent ? `${workflowInfo}\n\n${fullContent}` : workflowInfo
          }
          if (!fullContent) {
            return fail('Session is running — give a workflowId or content to queue for the next turn boundary.')
          }
          sessionManager.queueMessage(sessionId, 'asap', fullContent, undefined, 'workflow-launch')
          return ok({ queued: true, queueState: sessionManager.getQueueState(sessionId) })
        }

        if (session.phase === 'blocked') {
          sessionManager.setPhase(sessionId, 'build')
        }
        deps.launchWorkflow(sessionId, payload)
        return ok({ launched: true })
      },
    },
    {
      name: 'openfox_resume_workflow',
      description:
        'Resolve a paused workflow user step by picking one of its choices (e.g. "Work in current workspace"). The session must be paused at a user step \u2014 see openfox_session_status \u2192 workflow.pendingChoices (and the resumeHint there). Accepts the choice id or its label.',
      inputSchema: {
        sessionId: z.string().describe('Session paused at a workflow user step'),
        choice: z.string().describe('One of the pendingChoices surfaced by openfox_session_status (id or label)'),
      },
      handler: async (args) => {
        const check = requireSession(args['sessionId'])
        if (!check.ok) return fail(check.error)
        const sessionId = check.session.id
        const choice = args['choice']
        if (typeof choice !== 'string' || choice.trim().length === 0) {
          return fail('choice is required — pick one of the pendingChoices surfaced by openfox_session_status')
        }

        const execution = sessionManager.getActiveWorkflowExecution(sessionId)
        if (!execution || execution.status !== 'waiting' || !execution.currentStepId) {
          return fail(`Session ${sessionId} is not paused at a workflow user step`)
        }
        const pendingChoices = execution.pendingChoices ?? []
        if (pendingChoices.length === 0) {
          return fail(`No choices available for paused step "${execution.currentStepName ?? execution.currentStepId}"`)
        }
        const match = pendingChoices.find((c) => c.id === choice || c.label === choice)
        if (!match) {
          return fail(`Invalid choice "${choice}". Available: ${pendingChoices.map((c) => c.id).join(', ')}`)
        }

        deps.launchWorkflow(sessionId, {
          workflowId: execution.workflowId,
          resumeFrom: execution.currentStepId,
          userChoice: match.id,
          stepOutput: execution.stepOutput,
        })
        return ok({
          resumed: true,
          choice: match.id,
          step: execution.currentStepName ?? execution.currentStepId,
        })
      },
    },
    {
      name: 'openfox_stop_workflow',
      description:
        'Abort the active workflow run of a session (task/MCP-launched runs): aborts a live run or cancels a paused user-step execution, and errors when nothing is active. Does not stop plain chat turns.',
      inputSchema: {
        sessionId: z.string().describe('Session whose workflow run should be aborted'),
      },
      handler: async (args) => {
        const check = requireSession(args['sessionId'])
        if (!check.ok) return fail(check.error)
        const stopped = deps.stopWorkflow(check.session.id)
        if (!stopped) return fail('No active workflow run to stop')
        return ok({ stopped: true, aborted: stopped.aborted })
      },
    },
    {
      name: 'openfox_answer',
      description:
        'Answer or skip a pending ask_user question of a session by callId. Without a callId, lists the session pending questions.',
      inputSchema: {
        sessionId: z.string().describe('Session the question belongs to'),
        callId: z.string().optional().describe('Pending question to answer (omit to list)'),
        answer: z.string().optional().describe('The answer to provide'),
        skip: z.boolean().optional().describe('Skip the question instead of answering it'),
      },
      handler: async (args) => {
        const check = requireSession(args['sessionId'])
        if (!check.ok) return fail(check.error)
        const session = check.session

        const pending = deps.pendingQuestions(session.id)
        const resolved = resolvePendingCallId(session.id, args['callId'], pending, 'question')
        if (resolved.kind === 'list') return ok({ questions: pending })
        if (resolved.kind === 'error') return fail(resolved.error)
        const callId = resolved.callId

        const skip = args['skip'] === true
        const answer = typeof args['answer'] === 'string' ? args['answer'] : ''
        if (!skip && answer.length === 0) {
          return fail('answer is required unless skip is true')
        }

        const found = deps.answerQuestion(callId, skip ? '' : answer, skip || undefined)
        if (!found) {
          return fail(`Question ${callId} is no longer pending`)
        }
        return ok({ answered: true, callId, skipped: skip || undefined })
      },
    },
    {
      name: 'openfox_confirm',
      description:
        'Resolve a pending path confirmation of a session (approve/deny, optionally always-allow the paths). Without a callId, lists the session pending confirmations.',
      inputSchema: {
        sessionId: z.string().describe('Session the confirmation belongs to'),
        callId: z.string().optional().describe('Pending confirmation to resolve (omit to list)'),
        approved: z.boolean().optional().describe('Approve or deny the requested access'),
        alwaysAllow: z.boolean().optional().describe('Permanently allow the paths for this session'),
      },
      handler: async (args) => {
        const check = requireSession(args['sessionId'])
        if (!check.ok) return fail(check.error)
        const session = check.session

        const pending = deps.pendingConfirmations(session.id)
        const resolved = resolvePendingCallId(session.id, args['callId'], pending, 'confirmation')
        if (resolved.kind === 'list') return ok({ confirmations: pending })
        if (resolved.kind === 'error') return fail(resolved.error)
        const callId = resolved.callId

        const approved = args['approved']
        if (typeof approved !== 'boolean') {
          return fail('approved (boolean) is required')
        }
        const alwaysAllow = args['alwaysAllow'] as boolean | undefined

        const found = deps.confirmPath(callId, approved, alwaysAllow)
        if (!found) {
          return fail(`Confirmation ${callId} is no longer pending`)
        }
        return ok({ confirmed: true, callId, approved })
      },
    },
  ]

  return tools
}
