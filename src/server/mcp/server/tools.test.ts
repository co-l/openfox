// @vitest-environment node
import { describe, expect, it, vi, afterEach } from 'vitest'
import type { Message, Project, Session } from '../../../shared/types.js'
import type { PendingPathConfirmationPayload, PendingQuestionPayload } from '../../../shared/protocol.js'
import { createOpenFoxMcpTools, computeSettlement } from './tools.js'
import type { OpenFoxMcpToolDeps, OpenFoxMcpToolResult } from './types.js'

const projects: Project[] = [
  {
    id: 'p-1',
    name: 'proj',
    workdir: '/tmp/proj',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    isStarred: true,
  },
  {
    id: 'p-2',
    name: 'other',
    workdir: '/tmp/other',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
]
const detailMessages: Message[] = [
  { id: 'm-1', role: 'user', content: 'Do the thing', timestamp: '2026-01-01T00:00:01Z' },
  {
    id: 'm-2',
    role: 'assistant',
    content: 'x'.repeat(1000),
    timestamp: '2026-01-01T00:00:02Z',
    toolCalls: [{ id: 'tc-1', name: 'read_file', arguments: {}, status: 'completed', result: 'ok' } as any],
  },
]
const pendingQ: PendingQuestionPayload[] = [{ callId: 'q-9', question: 'Which option?', type: 'choice', options: [] }]
const pendingC: PendingPathConfirmationPayload[] = [
  {
    callId: 'c-9',
    tool: 'run_command',
    paths: ['/etc/passwd'],
    workdir: '/tmp/proj',
    reason: 'outside_workdir',
  },
]
const pendingQ1: PendingQuestionPayload[] = [
  { callId: 'q-1', question: 'Continue?', type: 'confirm', options: undefined },
]
const pendingQother: PendingQuestionPayload[] = [{ callId: 'q-other', question: 'x', type: 'text', options: undefined }]
const pendingC1: PendingPathConfirmationPayload[] = [
  { callId: 'c-1', tool: 'run_command', paths: ['/outside'], workdir: '/w', reason: 'outside_workdir' },
]

function makeSession() {
  return {
    id: 's-1',
    projectId: 'p-1',
    workdir: '/tmp/proj',
    mode: 'builder',
    phase: 'build',
    isRunning: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    messages: [],
    metadataEntries: {
      criteria: [
        { id: '1', description: 'Write tests', status: 'completed' },
        { id: '2', description: 'Implement', status: 'pending' },
      ],
      'review-findings': [{ id: '9', description: 'Nit', status: 'open' }],
    },
  }
}

function makeDeps(overrides: Partial<OpenFoxMcpToolDeps> = {}): OpenFoxMcpToolDeps {
  const session = makeSession()
  const deps: OpenFoxMcpToolDeps = {
    sessionManager: {
      getSession: () => session,
      getProject: () => ({ id: 'p-1', name: 'proj', workdir: '/tmp/proj' }),
      createSession: vi.fn(() => session),
      listSessionsByProject: vi.fn(() => ({ sessions: [session], hasMore: false })),
      listSessionsLimited: vi.fn(() => ({ sessions: [session], hasMore: false })),
      queueMessage: vi.fn(() => ({ queueId: 'q-1', mode: 'asap', content: 'hello' })),
      getQueueState: vi.fn(() => []),
      getActiveWorkflowExecution: vi.fn(() => null),
      setPhase: vi.fn(),
      setMode: vi.fn((id: string, mode: string) => ({ ...session, id, mode })),
    } as any,
    listProjects: vi.fn(() => projects),
    topLevelAgentIds: vi.fn(async () => ['builder', 'planner']),
    listWorkflows: vi.fn(async () => [
      {
        id: 'default',
        name: 'Build & Verify',
        scope: 'builtin',
        parameters: [{ id: 'task', label: 'Task', required: false }],
      },
      { id: 'custom', name: 'Custom Flow', scope: 'project' },
    ]),
    launchWorkflow: vi.fn(),
    stopSession: vi.fn(),
    stopWorkflow: vi.fn(() => ({ aborted: 'running' as const })),
    answerQuestion: vi.fn(() => true),
    pendingQuestions: vi.fn(() => []),
    confirmPath: vi.fn(() => true),
    pendingConfirmations: vi.fn(() => []),
    setMetadataEntries: vi.fn(),
    recentMessages: vi.fn(() => ({
      messages: detailMessages,
      hiddenCount: 7,
    })),
    createProject: vi.fn(async (name: string, workdir: string) => ({
      id: 'p-3',
      name,
      workdir,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    })),
    deleteProject: vi.fn((id: string) => id === 'p-1'),
    ...overrides,
  }
  return deps
}

async function call(tools: ReturnType<typeof createOpenFoxMcpTools>, name: string, args: Record<string, unknown>) {
  const tool = tools.find((t) => t.name === name)
  if (!tool) throw new Error(`Tool ${name} not found`)
  return tool.handler(args)
}

function text(result: OpenFoxMcpToolResult): string {
  return result.content[0]?.text ?? ''
}

function json(result: OpenFoxMcpToolResult): any {
  return JSON.parse(text(result))
}

describe('openfx MCP tools', () => {
  it('exposes the full session-centric tool set', () => {
    const tools = createOpenFoxMcpTools(makeDeps())
    const names = tools.map((t) => t.name).sort()
    expect(names).toEqual(
      [
        'openfox_answer',
        'openfox_confirm',
        'openfox_continue',
        'openfox_create_project',
        'openfox_create_session',
        'openfox_delete_project',
        'openfox_launch_workflow',
        'openfox_projects',
        'openfox_resume_workflow',
        'openfox_send_message',
        'openfox_session_detail',
        'openfox_session_metadata',
        'openfox_session_status',
        'openfox_sessions',
        'openfox_set_mode',
        'openfox_stop',
        'openfox_stop_workflow',
        'openfox_wait',
        'openfox_workflows',
      ].sort(),
    )
  })

  describe('openfox_projects', () => {
    it('lists projects', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_projects', {})
      expect(result.isError).toBeUndefined()
      const projects = json(result)
      expect(projects).toHaveLength(2)
      expect(projects[0]).toMatchObject({ id: 'p-1', name: 'proj', workdir: '/tmp/proj' })
    })
  })

  describe('openfox_create_session', () => {
    it('creates a session in the project', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_create_session', {
        projectId: 'p-1',
        title: 'New work',
      })
      expect(deps.sessionManager.createSession).toHaveBeenCalledWith('p-1', 'New work', null, null)
      const body = json(result)
      expect(body.sessionId).toBe('s-1')
      expect(body.isError).toBeUndefined()
    })

    it('requires projectId', async () => {
      const tools = createOpenFoxMcpTools(makeDeps())
      const result = await call(tools, 'openfox_create_session', {})
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('projectId')
    })

    it('sets the session mode when a valid agentId is provided', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_create_session', {
        projectId: 'p-1',
        agentId: 'builder',
      })
      expect(result.isError).toBeUndefined()
      expect(deps.topLevelAgentIds).toHaveBeenCalledWith('/tmp/proj')
      expect(deps.sessionManager.setMode).toHaveBeenCalledWith('s-1', 'builder')
    })

    it('rejects an unknown agentId', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_create_session', {
        projectId: 'p-1',
        agentId: 'ghost',
      })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('Invalid agentId')
      expect(text(result)).toContain('builder, planner')
      expect(deps.sessionManager.setMode).not.toHaveBeenCalled()
    })

    it('skips the mode switch for a blank agentId', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_create_session', {
        projectId: 'p-1',
        agentId: '   ',
      })
      expect(result.isError).toBeUndefined()
      expect(deps.topLevelAgentIds).not.toHaveBeenCalled()
      expect(deps.sessionManager.setMode).not.toHaveBeenCalled()
    })

    it('errors when the project does not exist', async () => {
      const deps = makeDeps({
        sessionManager: {
          ...makeDeps().sessionManager,
          getProject: () => undefined,
          createSession: vi.fn(() => {
            throw new Error('Project not found: nope')
          }),
        } as any,
      })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_create_session', { projectId: 'nope' })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('Project not found')
    })
  })

  describe('openfox_sessions', () => {
    it('lists project-scoped sessions with pending counts', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_sessions', { projectId: 'p-1', limit: 5 })
      expect(deps.sessionManager.listSessionsByProject).toHaveBeenCalledWith('p-1', 5, 0)
      const body = json(result)
      expect(body.sessions).toHaveLength(1)
      expect(body.sessions[0]).toMatchObject({ id: 's-1', projectId: 'p-1', isRunning: false })
      expect(body.sessions[0].pendingConfirmationCount).toBe(0)
      expect(body.sessions[0].pausedWorkflowStep).toBe(false)
    })

    it('lists globally when no project is given', async () => {
      const deps = makeDeps()
      await call(createOpenFoxMcpTools(deps), 'openfox_sessions', {})
      expect(deps.sessionManager.listSessionsLimited).toHaveBeenCalledWith(20, 0)
    })

    it('forwards an offset for project-scoped pagination', async () => {
      const deps = makeDeps()
      await call(createOpenFoxMcpTools(deps), 'openfox_sessions', { projectId: 'p-1', limit: 5, offset: 2 })
      expect(deps.sessionManager.listSessionsByProject).toHaveBeenCalledWith('p-1', 5, 2)
    })

    it('forwards an offset for global pagination', async () => {
      const deps = makeDeps()
      await call(createOpenFoxMcpTools(deps), 'openfox_sessions', { limit: 10, offset: 3 })
      expect(deps.sessionManager.listSessionsLimited).toHaveBeenCalledWith(10, 3)
    })

    it('errors for unknown sessions in status lookups', async () => {
      const deps = makeDeps({
        sessionManager: { ...makeDeps().sessionManager, getSession: () => undefined } as any,
      })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_session_status', { sessionId: 's-1' })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('not found')
    })
  })

  describe('openfox_session_status', () => {
    it('projects status with pending questions and confirmations', async () => {
      const deps = makeDeps({
        pendingQuestions: vi.fn(() => pendingQ),
        pendingConfirmations: vi.fn(() => pendingC),
      })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_session_status', { sessionId: 's-1' })
      const body = json(result)
      expect(body.state).toBe('waiting')
      expect(body.waitingForUser).toBe(true)
      expect(body.pending.questions).toHaveLength(1)
      expect(body.pending.questions[0]).toMatchObject({ callId: 'q-9', question: 'Which option?' })
      expect(body.pending.confirmations).toHaveLength(1)
      expect(body.pending.confirmations[0]).toMatchObject({ callId: 'c-9', tool: 'run_command' })
    })

    it('reports running state with active workflow step', async () => {
      const deps = makeDeps({
        sessionManager: {
          ...makeDeps().sessionManager,
          getSession: () => ({ ...makeDeps().sessionManager.getSession('s-1'), isRunning: true, phase: 'build' }),
          getActiveWorkflowExecution: vi.fn(() => ({ id: 'exec-1', currentStepName: 'Implement' })),
        } as any,
      })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_session_status', { sessionId: 's-1' })
      const body = json(result)
      expect(body.state).toBe('running')
      expect(body.workflowStep).toBe('Implement')
      expect(body.waitingForUser).toBe(false)
    })

    it('exposes the paused workflow user step with choices', async () => {
      const deps = makeDeps({
        sessionManager: {
          ...makeDeps().sessionManager,
          getSession: () => ({ ...makeDeps().sessionManager.getSession('s-1'), isRunning: false, phase: 'waiting' }),
          getActiveWorkflowExecution: vi.fn(() => ({
            id: 'exec-1',
            workflowId: 'default',
            workflowName: 'Build & Verify',
            status: 'waiting',
            currentStepId: 'work_location',
            currentStepName: 'Where to work',
            stepOutput: { task: 'fix it' },
            pendingChoices: [
              {
                id: 'Work in current workspace',
                label: 'Work in current workspace',
                goto: 'build',
                nextStepName: 'Implement',
              },
              {
                id: 'Start a new workspace',
                label: 'Start a new workspace',
                goto: 'setup_workspace',
                nextStepName: 'Setting up workspace',
              },
            ],
          })),
        } as any,
      })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_session_status', { sessionId: 's-1' })
      const body = json(result)
      expect(body.state).toBe('waiting')
      expect(body.workflowStep).toBe('Where to work')
      expect(body.workflow).toMatchObject({
        id: 'exec-1',
        name: 'Build & Verify',
        status: 'waiting',
        currentStepId: 'work_location',
        currentStepName: 'Where to work',
      })
      expect(body.workflow.pendingChoices).toHaveLength(2)
      expect(body.workflow.pendingChoices[0].id).toBe('Work in current workspace')
      expect(body.workflow.stepOutput).toEqual({ task: 'fix it' })
      expect(body.workflow.resumeHint).toContain('openfox_resume_workflow')
    })

    it('omits resumeHint when the execution is not paused at a user step', async () => {
      const deps = makeDeps({
        sessionManager: {
          ...makeDeps().sessionManager,
          getActiveWorkflowExecution: vi.fn(() => ({
            id: 'exec-1',
            workflowName: 'Build & Verify',
            status: 'running',
            currentStepId: 'build',
            currentStepName: 'Implement',
            stepOutput: {},
          })),
        } as any,
      })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_session_status', { sessionId: 's-1' })
      expect(json(result).workflow.resumeHint).toBeUndefined()
    })

    it('reports workflow null when no execution is active', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_session_status', { sessionId: 's-1' })
      expect(json(result).workflow).toBeNull()
    })
  })

  describe('openfox_session_detail', () => {
    it('returns the most recent messages compactly', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_session_detail', { sessionId: 's-1', limit: 10 })
      expect(deps.recentMessages).toHaveBeenCalledWith('s-1', 10)
      const body = json(result)
      expect(body.messages).toHaveLength(2)
      expect(body.messages[0]).toMatchObject({ role: 'user', content: 'Do the thing' })
      expect(body.messages[1].content).toHaveLength(403)
      expect(body.messages[1].content).toContain('...')
      expect(body.messages[1].toolCalls).toEqual(['read_file'])
      expect(body.hiddenCount).toBe(7)
    })

    it('honors a custom maxContentLength override', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_session_detail', {
        sessionId: 's-1',
        maxContentLength: 100,
      })
      const body = json(result)
      expect(body.messages[1].content).toHaveLength(103)
      expect(body.messages[1].content).toContain('...')
    })

    it('clamps maxContentLength to the allowed bounds', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_session_detail', {
        sessionId: 's-1',
        maxContentLength: 5,
      })
      const body = json(result)
      expect(body.messages[1].content).toHaveLength(53)
    })
  })

  describe('openfox_session_metadata', () => {
    it('lists metadata keys with counts', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_session_metadata', {
        sessionId: 's-1',
        action: 'list',
      })
      expect(json(result).keys).toEqual(
        expect.arrayContaining([
          { key: 'criteria', count: 2 },
          { key: 'review-findings', count: 1 },
        ]),
      )
    })

    it('returns the schema for a known key', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_session_metadata', {
        sessionId: 's-1',
        action: 'schema',
        key: 'criteria',
      })
      const body = json(result)
      expect(body.key).toBe('criteria')
      expect(body.fields.status).toContain('passed')
      expect(body.generic).toBeUndefined()
    })

    it('falls back to a generic schema for unknown keys', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_session_metadata', {
        sessionId: 's-1',
        action: 'schema',
        key: 'notes',
      })
      expect(json(result).generic).toBe(true)
    })

    it('gets entries for a key, empty for unknown keys', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_session_metadata', {
        sessionId: 's-1',
        action: 'get',
        key: 'criteria',
      })
      const body = json(result)
      expect(body.key).toBe('criteria')
      expect(body.entries).toHaveLength(2)
      expect(body.entries[0]).toMatchObject({ id: '1', description: 'Write tests', status: 'completed' })

      const unknown = await call(createOpenFoxMcpTools(deps), 'openfox_session_metadata', {
        sessionId: 's-1',
        action: 'get',
        key: 'notes',
      })
      expect(json(unknown).entries).toEqual([])
    })

    it('adds an entry to a key', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_session_metadata', {
        sessionId: 's-1',
        action: 'add',
        key: 'criteria',
        description: 'Verify the fix compiles',
      })
      expect(deps.setMetadataEntries).toHaveBeenCalledWith(
        's-1',
        'criteria',
        expect.arrayContaining([
          { id: '1', description: 'Write tests', status: 'completed' },
          { id: '2', description: 'Implement', status: 'pending' },
          { id: '3', description: 'Verify the fix compiles', status: 'pending' },
        ]),
      )
      const body = json(result)
      expect(body.added).toMatchObject({ id: '3', description: 'Verify the fix compiles', status: 'pending' })
      expect(body.entries).toHaveLength(3)
    })

    it('defaults review_findings status to open on add', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_session_metadata', {
        sessionId: 's-1',
        action: 'add',
        key: 'review_findings',
        description: 'A nit',
      })
      expect(json(result).added.status).toBe('open')
    })

    it('requires a description to add', async () => {
      const deps = makeDeps()
      const tools = createOpenFoxMcpTools(deps)
      const result = await call(tools, 'openfox_session_metadata', { sessionId: 's-1', action: 'add', key: 'criteria' })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('description')
      expect(deps.setMetadataEntries).not.toHaveBeenCalled()
    })

    it('updates an entry by id', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_session_metadata', {
        sessionId: 's-1',
        action: 'update',
        key: 'criteria',
        id: '1',
        status: 'completed',
      })
      expect(deps.setMetadataEntries).toHaveBeenCalledWith(
        's-1',
        'criteria',
        expect.arrayContaining([{ id: '1', description: 'Write tests', status: 'completed' }]),
      )
      const body = json(result)
      expect(body.updated).toBe('1')
      expect(body.entries[0].status).toBe('completed')
    })

    it('requires at least one field when updating', async () => {
      const tools = createOpenFoxMcpTools(makeDeps())
      const result = await call(tools, 'openfox_session_metadata', {
        sessionId: 's-1',
        action: 'update',
        key: 'criteria',
        id: '1',
      })
      expect(result.isError).toBe(true)
    })

    it('removes an entry by id', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_session_metadata', {
        sessionId: 's-1',
        action: 'remove',
        key: 'criteria',
        id: '1',
      })
      expect(deps.setMetadataEntries).toHaveBeenCalledWith('s-1', 'criteria', [
        { id: '2', description: 'Implement', status: 'pending' },
      ])
      const body = json(result)
      expect(body.removed).toBe('1')
      expect(body.entries).toHaveLength(1)
    })

    it('rejects update/remove for missing keys or items', async () => {
      const tools = createOpenFoxMcpTools(makeDeps())
      const missingKey = await call(tools, 'openfox_session_metadata', {
        sessionId: 's-1',
        action: 'update',
        key: 'notes',
        id: '1',
        status: 'x',
      })
      expect(missingKey.isError).toBe(true)
      const missingItem = await call(tools, 'openfox_session_metadata', {
        sessionId: 's-1',
        action: 'remove',
        key: 'criteria',
        id: 'nope',
      })
      expect(missingItem.isError).toBe(true)
    })

    it('validates key presence and unknown actions', async () => {
      const tools = createOpenFoxMcpTools(makeDeps())
      const noKey = await call(tools, 'openfox_session_metadata', { sessionId: 's-1', action: 'get' })
      expect(noKey.isError).toBe(true)
      expect(text(noKey)).toContain('key')
      const badAction = await call(tools, 'openfox_session_metadata', { sessionId: 's-1', action: 'clear', key: 'x' })
      expect(badAction.isError).toBe(true)
    })

    it('errors for unknown sessions', async () => {
      const deps = makeDeps({
        sessionManager: { ...makeDeps().sessionManager, getSession: () => undefined } as any,
      })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_session_metadata', {
        sessionId: 'gone',
        action: 'get',
        key: 'criteria',
      })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('not found')
    })
  })

  describe('openfox_set_mode', () => {
    it('switches an existing session to a valid mode', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_set_mode', {
        sessionId: 's-1',
        mode: 'planner',
      })
      expect(deps.topLevelAgentIds).toHaveBeenCalledWith('/tmp/proj')
      expect(deps.sessionManager.setMode).toHaveBeenCalledWith('s-1', 'planner')
      const body = json(result)
      expect(body.sessionId).toBe('s-1')
      expect(body.mode).toBe('planner')
    })

    it('rejects a mode that is not a top-level agent', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_set_mode', {
        sessionId: 's-1',
        mode: 'ghost',
      })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('Invalid mode')
      expect(deps.sessionManager.setMode).not.toHaveBeenCalled()
    })

    it('requires sessionId and mode', async () => {
      const tools = createOpenFoxMcpTools(makeDeps())
      const noSession = await call(tools, 'openfox_set_mode', { mode: 'builder' })
      expect(noSession.isError).toBe(true)
      expect(text(noSession)).toContain('sessionId')
      const noMode = await call(tools, 'openfox_set_mode', { sessionId: 's-1' })
      expect(noMode.isError).toBe(true)
      expect(text(noMode)).toContain('mode')
    })

    it('errors for unknown sessions', async () => {
      const deps = makeDeps({
        sessionManager: { ...makeDeps().sessionManager, getSession: () => undefined } as any,
      })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_set_mode', {
        sessionId: 'gone',
        mode: 'builder',
      })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('not found')
    })
  })

  describe('openfox_create_project', () => {
    it('creates a project with name and workdir', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_create_project', {
        name: 'my-project',
        workdir: '/tmp/my-project',
      })
      expect(deps.createProject).toHaveBeenCalledWith('my-project', '/tmp/my-project')
      const body = json(result)
      expect(body.project).toMatchObject({ id: 'p-3', name: 'my-project', workdir: '/tmp/my-project' })
    })

    it('requires name and workdir', async () => {
      const deps = makeDeps()
      const tools = createOpenFoxMcpTools(deps)
      const noName = await call(tools, 'openfox_create_project', { workdir: '/tmp/x' })
      expect(noName.isError).toBe(true)
      expect(text(noName)).toContain('name')
      const noWorkdir = await call(tools, 'openfox_create_project', { name: 'x' })
      expect(noWorkdir.isError).toBe(true)
      expect(text(noWorkdir)).toContain('workdir')
      expect(deps.createProject).not.toHaveBeenCalled()
    })

    it('surfaces creation errors', async () => {
      const deps = makeDeps({
        createProject: vi.fn(async () => {
          throw new Error('Permission denied: cannot create directory at /root/x')
        }),
      })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_create_project', {
        name: 'x',
        workdir: '/root/x',
      })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('Permission denied')
    })
  })

  describe('openfox_delete_project', () => {
    it('deletes an existing project', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_delete_project', { projectId: 'p-1' })
      expect(deps.deleteProject).toHaveBeenCalledWith('p-1')
      expect(json(result).deleted).toBe(true)
    })

    it('reports false when the project does not exist', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_delete_project', { projectId: 'nope' })
      expect(json(result).deleted).toBe(false)
    })

    it('requires projectId', async () => {
      const tools = createOpenFoxMcpTools(makeDeps())
      const result = await call(tools, 'openfox_delete_project', {})
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('projectId')
    })
  })

  describe('openfox_send_message', () => {
    it('queues the message asap and reports queue state', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_send_message', {
        sessionId: 's-1',
        content: 'Go',
      })
      expect(deps.sessionManager.queueMessage).toHaveBeenCalledWith('s-1', 'asap', 'Go', undefined, undefined)
      const body = json(result)
      expect(body.queued).toBe(true)
      expect(body.queueState).toEqual([])
    })

    it('passes attachments and messageKind through', async () => {
      const deps = makeDeps()
      await call(createOpenFoxMcpTools(deps), 'openfox_send_message', {
        sessionId: 's-1',
        content: 'x',
        attachments: [{ name: 'a.png' }],
        messageKind: 'correction',
      })
      expect(deps.sessionManager.queueMessage).toHaveBeenCalledWith(
        's-1',
        'asap',
        'x',
        [{ name: 'a.png' }],
        'correction',
      )
    })

    it('requires content or attachments', async () => {
      const tools = createOpenFoxMcpTools(makeDeps())
      const result = await call(tools, 'openfox_send_message', { sessionId: 's-1' })
      expect(result.isError).toBe(true)
    })

    it('errors for unknown sessions', async () => {
      const deps = makeDeps({
        sessionManager: { ...makeDeps().sessionManager, getSession: () => undefined } as any,
      })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_send_message', {
        sessionId: 'gone',
        content: 'x',
      })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('not found')
    })
  })

  describe('openfox_continue', () => {
    it('rejects when the session is running', async () => {
      const deps = makeDeps({
        sessionManager: {
          ...makeDeps().sessionManager,
          getSession: () => ({ id: 's-1', isRunning: true, phase: 'build' }),
        } as any,
      })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_continue', { sessionId: 's-1' })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('already running')
    })

    it('resets a blocked session and queues an auto-prompt', async () => {
      const deps = makeDeps({
        sessionManager: {
          ...makeDeps().sessionManager,
          getSession: () => ({ id: 's-1', isRunning: false, phase: 'blocked' }),
        } as any,
      })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_continue', { sessionId: 's-1' })
      expect(deps.sessionManager.setPhase).toHaveBeenCalledWith('s-1', 'build')
      expect(deps.sessionManager.queueMessage).toHaveBeenCalledWith(
        's-1',
        'asap',
        expect.any(String),
        undefined,
        'auto-prompt',
      )
      expect(json(result).accepted).toBe(true)
    })

    it('acknowledges idle sessions with a hint', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_continue', { sessionId: 's-1' })
      const body = json(result)
      expect(body.accepted).toBe(true)
      expect(body.note).toContain('openfox_send_message')
    })
  })

  describe('computeSettlement', () => {
    const base = makeSession() as unknown as Session

    it('is not settled while running without a user pause', () => {
      const session = { ...base, isRunning: true, phase: 'build' } as Session
      expect(computeSettlement(session, 0, 0, null)).toMatchObject({ settled: false })
    })

    it('settles as completed on phase done', () => {
      const session = { ...base, phase: 'done' } as Session
      expect(computeSettlement(session, 0, 0, null)).toEqual({ settled: true, outcome: 'completed' })
    })

    it('settles as blocked on phase blocked', () => {
      const session = { ...base, phase: 'blocked' } as Session
      expect(computeSettlement(session, 0, 0, null)).toEqual({ settled: true, outcome: 'blocked' })
    })

    it('settles as waiting on a pending question even while running', () => {
      const session = { ...base, isRunning: true, phase: 'build' } as Session
      expect(computeSettlement(session, 1, 0, null)).toEqual({ settled: true, outcome: 'waiting' })
    })

    it('settles as waiting on a paused workflow user step even while running', () => {
      const session = { ...base, isRunning: true, phase: 'build' } as Session
      expect(computeSettlement(session, 0, 0, 'waiting')).toEqual({ settled: true, outcome: 'waiting' })
    })

    it('settles as completed when a turn that ran goes idle', () => {
      const session = { ...base, isRunning: false, phase: 'build' } as Session
      expect(computeSettlement(session, 0, 0, null, true)).toEqual({ settled: true, outcome: 'completed' })
    })

    it('is not settled for a session that never ran', () => {
      const session = { ...base, isRunning: false, phase: 'build' } as Session
      expect(computeSettlement(session, 0, 0, null, false)).toEqual({ settled: false, outcome: null })
    })
  })

  describe('openfox_wait', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns completed once the session finishes', async () => {
      vi.useFakeTimers()
      const sessionState = makeSession()
      const deps = makeDeps({
        sessionManager: { ...makeDeps().sessionManager, getSession: () => sessionState } as any,
      })
      const promise = call(createOpenFoxMcpTools(deps), 'openfox_wait', { sessionId: 's-1', timeout: 10 })
      sessionState.phase = 'done'
      await vi.advanceTimersByTimeAsync(1000)
      const result = await promise
      expect(json(result)).toMatchObject({ settled: true, outcome: 'completed' })
      expect(json(result).waitedMs).toBeGreaterThanOrEqual(0)
      expect(json(result).status).toBeDefined()
    })

    it('returns waiting when a question becomes pending', async () => {
      vi.useFakeTimers()
      const state = { pending: false }
      const deps = makeDeps({
        pendingQuestions: vi.fn(() => (state.pending ? pendingQ1 : [])),
      })
      const promise = call(createOpenFoxMcpTools(deps), 'openfox_wait', { sessionId: 's-1', timeout: 10 })
      state.pending = true
      await vi.advanceTimersByTimeAsync(1000)
      const result = await promise
      expect(json(result)).toMatchObject({ settled: true, outcome: 'waiting' })
    })

    it('returns waiting when the workflow pauses at a user step', async () => {
      vi.useFakeTimers()
      const sessionState = makeSession()
      const deps = makeDeps({
        sessionManager: {
          ...makeDeps().sessionManager,
          getSession: () => sessionState,
          getActiveWorkflowExecution: vi.fn(() =>
            sessionState.phase === 'waiting'
              ? ({
                  id: 'exec-1',
                  workflowName: 'Build & Verify',
                  status: 'waiting',
                  currentStepId: 'work_location',
                  currentStepName: 'Where to work',
                  stepOutput: {},
                  pendingChoices: [],
                } as any)
              : null,
          ),
        } as any,
      })
      const promise = call(createOpenFoxMcpTools(deps), 'openfox_wait', { sessionId: 's-1', timeout: 10 })
      sessionState.phase = 'waiting'
      await vi.advanceTimersByTimeAsync(1000)
      const result = await promise
      expect(json(result)).toMatchObject({ settled: true, outcome: 'waiting' })
      expect(json(result).status.workflow.currentStepName).toBe('Where to work')
    })

    it('returns blocked when the session is blocked', async () => {
      vi.useFakeTimers()
      const sessionState = makeSession()
      const deps = makeDeps({
        sessionManager: { ...makeDeps().sessionManager, getSession: () => sessionState } as any,
      })
      const promise = call(createOpenFoxMcpTools(deps), 'openfox_wait', { sessionId: 's-1', timeout: 10 })
      sessionState.phase = 'blocked'
      await vi.advanceTimersByTimeAsync(1000)
      const result = await promise
      expect(json(result)).toMatchObject({ settled: true, outcome: 'blocked' })
    })

    it('times out cleanly when the session never settles', async () => {
      vi.useFakeTimers()
      const deps = makeDeps()
      const promise = call(createOpenFoxMcpTools(deps), 'openfox_wait', { sessionId: 's-1', timeout: 5 })
      await vi.advanceTimersByTimeAsync(6000)
      const result = await promise
      expect(json(result)).toMatchObject({ settled: false, timedOut: true })
    })

    it('returns completed when the session already finished before wait', async () => {
      vi.useFakeTimers()
      const sessionState = {
        ...makeSession(),
        messages: [{ id: 'm-1', role: 'assistant', content: 'done', timestamp: '2026-01-01T00:00:00Z' }],
      }
      const deps = makeDeps({
        sessionManager: { ...makeDeps().sessionManager, getSession: () => sessionState } as any,
      })
      const promise = call(createOpenFoxMcpTools(deps), 'openfox_wait', { sessionId: 's-1', timeout: 10 })
      await vi.advanceTimersByTimeAsync(2500)
      const result = await promise
      expect(json(result)).toMatchObject({ settled: true, outcome: 'completed' })
    })

    it('rejects unknown sessions', async () => {
      const deps = makeDeps({
        sessionManager: { ...makeDeps().sessionManager, getSession: () => undefined } as any,
      })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_wait', { sessionId: 'gone' })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('not found')
    })
  })

  describe('openfox_stop', () => {
    it('stops the whole session', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_stop', { sessionId: 's-1' })
      expect(deps.stopSession).toHaveBeenCalledWith('s-1')
      expect(json(result).stopped).toBe(true)
    })

    it('errors for unknown sessions', async () => {
      const deps = makeDeps({
        sessionManager: { ...makeDeps().sessionManager, getSession: () => undefined } as any,
      })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_stop', { sessionId: 'gone' })
      expect(result.isError).toBe(true)
    })
  })

  describe('openfox_workflows', () => {
    it('lists workflows with parameters', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_workflows', { projectDir: '/tmp/proj' })
      expect(deps.listWorkflows).toHaveBeenCalledWith('/tmp/proj')
      const workflows = json(result)
      expect(workflows).toHaveLength(2)
      expect(workflows[0]).toMatchObject({ id: 'default', name: 'Build & Verify', scope: 'builtin' })
      expect(workflows[0].parameters).toHaveLength(1)
    })
  })

  describe('openfox_launch_workflow', () => {
    it('launches directly on an idle session', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_launch_workflow', {
        sessionId: 's-1',
        workflowId: 'default',
        params: { task: 'fix the bug' },
      })
      expect(deps.launchWorkflow).toHaveBeenCalledWith('s-1', {
        workflowId: 'default',
        params: { task: 'fix the bug' },
      })
      expect(json(result).launched).toBe(true)
    })

    it('rejects an unknown workflowId synchronously without launching', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_launch_workflow', {
        sessionId: 's-1',
        workflowId: 'does-not-exist',
      })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('does-not-exist')
      expect(deps.listWorkflows).toHaveBeenCalledWith('/tmp/proj')
      expect(deps.launchWorkflow).not.toHaveBeenCalled()
    })

    it('resolves workflows across scopes like the orchestrator fallback', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_launch_workflow', {
        sessionId: 's-1',
        workflowId: 'custom',
        scope: 'builtin',
      })
      expect(result.isError).not.toBe(true)
      expect(json(result).launched).toBe(true)
      expect(deps.launchWorkflow).toHaveBeenCalledWith('s-1', { workflowId: 'custom', scope: 'builtin' })
    })

    it('resets a blocked phase before launching', async () => {
      const deps = makeDeps({
        sessionManager: {
          ...makeDeps().sessionManager,
          getSession: () => ({ id: 's-1', isRunning: false, phase: 'blocked' }),
        } as any,
      })
      await call(createOpenFoxMcpTools(deps), 'openfox_launch_workflow', { sessionId: 's-1', workflowId: 'default' })
      expect(deps.sessionManager.setPhase).toHaveBeenCalledWith('s-1', 'build')
      expect(deps.launchWorkflow).toHaveBeenCalled()
    })

    it('queues a workflow marker when the session is running', async () => {
      const deps = makeDeps({
        sessionManager: {
          ...makeDeps().sessionManager,
          getSession: () => ({ id: 's-1', isRunning: true, phase: 'build' }),
        } as any,
      })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_launch_workflow', {
        sessionId: 's-1',
        workflowId: 'default',
        content: 'focus on auth',
      })
      expect(deps.sessionManager.queueMessage).toHaveBeenCalledWith(
        's-1',
        'asap',
        '// Workflow: default\n\nfocus on auth',
        undefined,
        'workflow-launch',
      )
      const body = json(result)
      expect(body.queued).toBe(true)
    })

    it('queues plain content when the session is running without a workflowId', async () => {
      const deps = makeDeps({
        sessionManager: {
          ...makeDeps().sessionManager,
          getSession: () => ({ id: 's-1', isRunning: true, phase: 'build' }),
        } as any,
      })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_launch_workflow', {
        sessionId: 's-1',
        content: 'just a message',
      })
      expect(deps.sessionManager.queueMessage).toHaveBeenCalledWith(
        's-1',
        'asap',
        'just a message',
        undefined,
        'workflow-launch',
      )
      expect(json(result).queued).toBe(true)
    })

    it('refuses a running launch with nothing to queue', async () => {
      const deps = makeDeps({
        sessionManager: {
          ...makeDeps().sessionManager,
          getSession: () => ({ id: 's-1', isRunning: true, phase: 'build' }),
        } as any,
      })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_launch_workflow', {
        sessionId: 's-1',
      })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('Session is running')
    })

    it('passes resume fields through on the idle path', async () => {
      const deps = makeDeps()
      await call(createOpenFoxMcpTools(deps), 'openfox_launch_workflow', {
        sessionId: 's-1',
        workflowId: 'default',
        resumeFrom: 'implement',
        stepOutput: { done: 'yes' },
        userChoice: 'a',
        subGroup: 'g1',
        scope: 'project',
      })
      expect(deps.launchWorkflow).toHaveBeenCalledWith('s-1', {
        workflowId: 'default',
        resumeFrom: 'implement',
        stepOutput: { done: 'yes' },
        userChoice: 'a',
        subGroup: 'g1',
        scope: 'project',
      })
    })
  })

  describe('openfox_resume_workflow', () => {
    const pausedExecution = () => ({
      id: 'exec-1',
      workflowId: 'default',
      workflowName: 'Build & Verify',
      status: 'waiting',
      currentStepId: 'work_location',
      currentStepName: 'Where to work',
      stepOutput: { task: 'fix it' },
      pendingChoices: [
        {
          id: 'Work in current workspace',
          label: 'Work in current workspace',
          goto: 'build',
          nextStepName: 'Implement',
        },
        {
          id: 'Start a new workspace',
          label: 'Start a new workspace',
          goto: 'setup_workspace',
          nextStepName: 'Setting up workspace',
        },
      ],
    })

    const pausedDeps = () =>
      makeDeps({
        sessionManager: {
          ...makeDeps().sessionManager,
          getActiveWorkflowExecution: vi.fn(() => pausedExecution()),
        } as any,
      })

    it('resumes a paused user step with the chosen option', async () => {
      const deps = pausedDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_resume_workflow', {
        sessionId: 's-1',
        choice: 'Work in current workspace',
      })
      expect(deps.launchWorkflow).toHaveBeenCalledWith('s-1', {
        workflowId: 'default',
        resumeFrom: 'work_location',
        userChoice: 'Work in current workspace',
        stepOutput: { task: 'fix it' },
      })
      const body = json(result)
      expect(body).toMatchObject({ resumed: true, choice: 'Work in current workspace', step: 'Where to work' })
    })

    it('accepts the choice by label as well as id', async () => {
      const deps = pausedDeps()
      await call(createOpenFoxMcpTools(deps), 'openfox_resume_workflow', {
        sessionId: 's-1',
        choice: 'Start a new workspace',
      })
      expect(deps.launchWorkflow).toHaveBeenCalledWith(
        's-1',
        expect.objectContaining({ userChoice: 'Start a new workspace' }),
      )
    })

    it('rejects when the session is not paused at a user step', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_resume_workflow', {
        sessionId: 's-1',
        choice: 'Work in current workspace',
      })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('not paused')
      expect(deps.launchWorkflow).not.toHaveBeenCalled()
    })

    it('rejects an invalid choice and lists the available ones', async () => {
      const deps = pausedDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_resume_workflow', {
        sessionId: 's-1',
        choice: 'Delete everything',
      })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('Work in current workspace')
      expect(deps.launchWorkflow).not.toHaveBeenCalled()
    })

    it('requires choice and errors for unknown sessions', async () => {
      const deps = pausedDeps()
      const tools = createOpenFoxMcpTools(deps)
      const noChoice = await call(tools, 'openfox_resume_workflow', { sessionId: 's-1' })
      expect(noChoice.isError).toBe(true)
      expect(text(noChoice)).toContain('choice')
      const goneDeps = makeDeps({
        sessionManager: { ...makeDeps().sessionManager, getSession: () => undefined } as any,
      })
      const gone = await call(createOpenFoxMcpTools(goneDeps), 'openfox_resume_workflow', {
        sessionId: 'gone',
        choice: 'x',
      })
      expect(gone.isError).toBe(true)
      expect(text(gone)).toContain('not found')
    })
  })

  describe('openfox_stop_workflow', () => {
    it('reports a running run was aborted', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_stop_workflow', { sessionId: 's-1' })
      expect(deps.stopWorkflow).toHaveBeenCalledWith('s-1')
      expect(json(result)).toEqual({ stopped: true, aborted: 'running' })
    })

    it('reports a paused workflow was cancelled', async () => {
      const deps = makeDeps({ stopWorkflow: vi.fn(() => ({ aborted: 'paused' as const })) })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_stop_workflow', { sessionId: 's-1' })
      expect(json(result)).toEqual({ stopped: true, aborted: 'paused' })
    })

    it('fails with a reason when there is nothing to stop', async () => {
      const deps = makeDeps({ stopWorkflow: vi.fn(() => null) })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_stop_workflow', { sessionId: 's-1' })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('No active workflow')
    })

    it('errors for unknown sessions', async () => {
      const deps = makeDeps({
        sessionManager: { ...makeDeps().sessionManager, getSession: () => undefined } as any,
      })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_stop_workflow', { sessionId: 'gone' })
      expect(result.isError).toBe(true)
    })
  })

  describe('openfox_answer', () => {
    it('lists pending questions when callId is omitted', async () => {
      const deps = makeDeps({
        pendingQuestions: vi.fn(() => pendingQ1),
      })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_answer', { sessionId: 's-1' })
      const body = json(result)
      expect(body.questions).toHaveLength(1)
      expect(body.questions[0]).toMatchObject({ callId: 'q-1', question: 'Continue?' })
    })

    it('answers a pending question', async () => {
      const deps = makeDeps({
        pendingQuestions: vi.fn(() => pendingQ1),
      })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_answer', {
        sessionId: 's-1',
        callId: 'q-1',
        answer: 'yes',
      })
      expect(deps.answerQuestion).toHaveBeenCalledWith('q-1', 'yes', undefined)
      expect(json(result).answered).toBe(true)
    })

    it('skips a pending question', async () => {
      const deps = makeDeps({
        pendingQuestions: vi.fn(() => pendingQ1),
      })
      await call(createOpenFoxMcpTools(deps), 'openfox_answer', { sessionId: 's-1', callId: 'q-1', skip: true })
      expect(deps.answerQuestion).toHaveBeenCalledWith('q-1', '', true)
    })

    it('rejects a callId that belongs to another session', async () => {
      const deps = makeDeps({
        pendingQuestions: vi.fn(() => pendingQother),
      })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_answer', {
        sessionId: 's-1',
        callId: 'q-mine',
        answer: 'y',
      })
      expect(result.isError).toBe(true)
      expect(deps.answerQuestion).not.toHaveBeenCalled()
    })

    it('requires an answer unless skipping', async () => {
      const deps = makeDeps({
        pendingQuestions: vi.fn(() => pendingQ1),
      })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_answer', { sessionId: 's-1', callId: 'q-1' })
      expect(result.isError).toBe(true)
    })
  })

  describe('openfox_confirm', () => {
    it('lists pending confirmations when callId is omitted', async () => {
      const deps = makeDeps({
        pendingConfirmations: vi.fn(() => pendingC1),
      })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_confirm', { sessionId: 's-1' })
      expect(json(result).confirmations).toHaveLength(1)
    })

    it('resolves a pending confirmation', async () => {
      const deps = makeDeps({
        pendingConfirmations: vi.fn((): PendingPathConfirmationPayload[] => [
          { callId: 'c-1', tool: 'run_command', paths: ['/outside'], workdir: '/w', reason: 'outside_workdir' },
        ]),
      })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_confirm', {
        sessionId: 's-1',
        callId: 'c-1',
        approved: true,
        alwaysAllow: true,
      })
      expect(deps.confirmPath).toHaveBeenCalledWith('c-1', true, true)
      expect(json(result).confirmed).toBe(true)
    })

    it('rejects confirmations that are not pending in this session', async () => {
      const deps = makeDeps()
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_confirm', {
        sessionId: 's-1',
        callId: 'c-ghost',
        approved: true,
      })
      expect(result.isError).toBe(true)
      expect(deps.confirmPath).not.toHaveBeenCalled()
    })

    it('requires approved', async () => {
      const deps = makeDeps({
        pendingConfirmations: vi.fn((): PendingPathConfirmationPayload[] => [
          { callId: 'c-1', tool: 't', paths: [], workdir: '/w', reason: 'outside_workdir' },
        ]),
      })
      const result = await call(createOpenFoxMcpTools(deps), 'openfox_confirm', { sessionId: 's-1', callId: 'c-1' })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('approved')
    })
  })
})
