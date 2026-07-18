import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getEventStoreMock,
  getContextMessagesMock,
  getCurrentContextWindowIdMock,
  getAllInstructionsMock,
  getToolRegistryForModeMock,
  createToolProgressHandlerMock,
  streamLLMPureMock,
  consumeStreamGeneratorMock,
  getConversationMessagesMock,
} = vi.hoisted(() => ({
  getEventStoreMock: vi.fn(),
  getContextMessagesMock: vi.fn(),
  getCurrentContextWindowIdMock: vi.fn(),
  getAllInstructionsMock: vi.fn(),
  getToolRegistryForModeMock: vi.fn(),
  createToolProgressHandlerMock: vi.fn(() => undefined),
  streamLLMPureMock: vi.fn(),
  consumeStreamGeneratorMock: vi.fn(),
  getConversationMessagesMock: vi.fn((): import('./request-context.js').RequestContextMessage[] => []),
}))

vi.mock('../events/index.js', () => ({
  getEventStore: getEventStoreMock,
  getContextMessages: getContextMessagesMock,
  getCurrentContextWindowId: getCurrentContextWindowIdMock,
  getCurrentWindowMessageOptions: vi.fn((sessionId: string) => {
    const id = getCurrentContextWindowIdMock(sessionId)
    return id ? { contextWindowId: id } : undefined
  }),
}))

vi.mock('./conversation-history.js', () => ({
  getConversationMessages: getConversationMessagesMock,
  processEventsForConversation: vi.fn(async (_sessionId: string, _llmClient: any, _onEvent: any) => []),
}))

vi.mock('../db/settings.js', () => ({
  getSetting: vi.fn().mockReturnValue('false'),
  SETTINGS_KEYS: { LLM_DYNAMIC_SYSTEM_PROMPT: 'llm.dynamicSystemPrompt' },
}))

vi.mock('../context/instructions.js', () => ({
  getAllInstructions: getAllInstructionsMock,
  toInjectedFiles: (files: unknown[]) => files as unknown,
}))

vi.mock('../skills/registry.js', () => ({
  getEnabledSkillMetadata: vi.fn(async () => []),
}))

vi.mock('../runtime-config.js', () => ({
  getRuntimeConfig: vi.fn(() => ({
    mode: 'development',
    context: { maxTokens: 200000, compactionThreshold: 0.85, compactionTarget: 0.6 },
    agent: { toolTimeout: 120000 },
    llm: {
      baseUrl: 'http://localhost:11434',
      model: 'test-model',
      timeout: 30000,
      idleTimeout: 30000,
      backend: 'ollama',
    },
  })),
  setRuntimeConfig: vi.fn(),
}))

vi.mock('../../cli/paths.js', () => ({
  getGlobalConfigDir: vi.fn(() => '/tmp/openfox-test'),
}))

vi.mock('../tools/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tools/index.js')>()
  return {
    ...actual,
    getToolRegistryForMode: getToolRegistryForModeMock,
    getToolRegistryForAgent: vi.fn().mockImplementation((agentDef: any) => {
      return getToolRegistryForModeMock(agentDef?.metadata?.mode ?? 'planner')
    }),
  }
})

vi.mock('./tool-streaming.js', () => ({
  createToolProgressHandler: createToolProgressHandlerMock,
}))

vi.mock('./stream-pure.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./stream-pure.js')>()
  return {
    ...actual,
    streamLLMPure: streamLLMPureMock,
    consumeStreamGenerator: consumeStreamGeneratorMock,
  }
})

vi.mock('../agents/registry.js', () => {
  const agents = [
    {
      metadata: {
        id: 'planner',
        name: 'Planner',
        description: 'Plans work',
        subagent: false,
        allowedTools: [
          'read_file',
          'glob',
          'grep',
          'web_fetch',
          'run_command',
          'git',
          'get_criteria',
          'add_criterion',
          'update_criterion',
          'remove_criterion',
          'call_sub_agent',
          'load_skill',
        ],
      },
      prompt:
        '# Plan Mode\n\nCRITICAL: Plan mode ACTIVE - you are in read-only phase.\n\nYou may only inspect, analyze, ask clarifying questions, and propose, refine and/or add acceptance criteria.\nYou MUST NOT make any edits, implementations, commits, config changes, or other system modifications.',
    },
    {
      metadata: {
        id: 'builder',
        name: 'Builder',
        description: 'Builds work',
        subagent: false,
        allowedTools: [
          'read_file',
          'glob',
          'grep',
          'web_fetch',
          'write_file',
          'edit_file',
          'run_command',
          'ask_user',
          'complete_criterion',
          'get_criteria',
          'todo_write',
          'call_sub_agent',
          'load_skill',
        ],
      },
      prompt:
        '# Build Mode\n\nCRITICAL: Build mode ACTIVE - implementation is now allowed.\n\nYou are no longer in read-only mode.\nYou may read files, edit files, run commands, and use tools as needed to satisfy the approved criteria.',
    },
    {
      metadata: {
        id: 'verifier',
        name: 'Verifier',
        description: 'Verify criteria',
        subagent: true,
        allowedTools: ['read_file', 'run_command', 'pass_criterion', 'fail_criterion'],
      },
      prompt: 'You are a verifier',
    },
  ]
  return {
    loadBuiltinAgents: vi.fn(async () => agents),
    loadAllAgentsDefault: vi.fn(async () => agents),
    findAgentById: vi.fn((id: string, list: any[]) => list.find((a: any) => a.metadata.id === id)),
    getSubAgents: vi.fn((list: any[]) => list.filter((a: any) => a.metadata.subagent)),
  }
})

import { PathAccessDeniedError } from '../tools/path-security.js'
import { TurnMetrics, runAgentTurn, runChatTurn } from './orchestrator.js'

function createEventStore() {
  const eventsBySession = new Map<
    string,
    Array<{ seq: number; sessionId: string; timestamp: number; type: string; data: unknown }>
  >()

  return {
    append: vi.fn((sessionId: string, event: { type: string; data: unknown }) => {
      const existing = eventsBySession.get(sessionId) ?? []
      const stored = {
        seq: existing.length + 1,
        sessionId,
        timestamp: Date.now(),
        type: event.type,
        data: event.data,
      }
      eventsBySession.set(sessionId, [...existing, stored])
      return stored
    }),
    getEvents: vi.fn((sessionId: string) => eventsBySession.get(sessionId) ?? []),
    getAllEvents: vi.fn((sessionId: string) => eventsBySession.get(sessionId) ?? []),
    getLatestSeq: vi.fn((sessionId: string) => {
      const events = eventsBySession.get(sessionId) ?? []
      return events.at(-1)?.seq ?? null
    }),
    cleanupOldEvents: vi.fn((_sessionId: string) => 0),
    getLatestSnapshot: vi.fn((_sessionId: string) => undefined),
  }
}

function createSessionManager(state: Record<string, any>) {
  const contextState = {
    currentTokens: 0,
    maxTokens: 200000,
    compactionCount: 0,
    dangerZone: false,
    canCompact: false,
    dynamicContextChanged: false,
  }
  return {
    requireSession: vi.fn(() => structuredClone(state['current'])),
    getCurrentWindowMessages: vi.fn(() => state['current'].messages ?? []),
    getContextState: vi.fn(() => ({ ...contextState })),
    getCurrentModelContext: vi.fn(() => 200000),
    setCurrentContextSize: vi.fn((_sessionId: string, tokens: number) => {
      contextState.currentTokens = tokens
    }),
    addTokensUsed: vi.fn(),
    getCurrentModelSettings: vi.fn(() => undefined),
    getLspManager: vi.fn(() => ({ name: 'lsp' })),
    setRunning: vi.fn(),
    getCachedPrompt: vi.fn(() => undefined),
    setCachedPrompt: vi.fn(),
    getDynamicContextChanged: vi.fn(() => false),
    setDynamicContextChanged: vi.fn(),
    updateCriterionStatus: vi.fn((_: string, criterionId: string, status: Record<string, unknown>) => {
      state['current'].criteria = state['current'].criteria.map((criterion: any) =>
        criterion.id === criterionId ? { ...criterion, status } : criterion,
      )
    }),
    addCriterionAttempt: vi.fn((_: string, criterionId: string, attempt: Record<string, unknown>) => {
      state['current'].criteria = state['current'].criteria.map((criterion: any) =>
        criterion.id === criterionId ? { ...criterion, attempts: [...criterion.attempts, attempt] } : criterion,
      )
    }),
    addMessage: vi.fn((_: string, __: any) => ({
      id: crypto.randomUUID(),
      role: 'user',
      content: '',
      timestamp: new Date().toISOString(),
    })),
    addAssistantMessage: vi.fn((_: string, __: any) => ({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      isStreaming: true,
    })),
    updateMessage: vi.fn(),
    updateMessageStats: vi.fn(),
    drainAsapMessages: vi.fn(() => []),
    updateExecutionState: vi.fn((_: string, updates: Record<string, unknown>) => {
      state['current'].executionState = { ...(state['current'].executionState ?? {}), ...updates }
    }),
  }
}

describe('chat orchestrator', () => {
  beforeEach(() => {
    getEventStoreMock.mockReset()
    getContextMessagesMock.mockReset()
    getCurrentContextWindowIdMock.mockReset()
    getConversationMessagesMock.mockReset()
    getContextMessagesMock.mockReturnValue([])
    getConversationMessagesMock.mockReturnValue([])
    getCurrentContextWindowIdMock.mockReturnValue(undefined)
    getAllInstructionsMock.mockReset()
    getToolRegistryForModeMock.mockReset()
    createToolProgressHandlerMock.mockClear()
    streamLLMPureMock.mockReset()
    consumeStreamGeneratorMock.mockReset()
    streamLLMPureMock.mockReset()
    streamLLMPureMock.mockResolvedValue({
      messageId: 'verifier-msg',
      content: 'done',
      toolCalls: [],
      segments: [],
      usage: { promptTokens: 5, completionTokens: 1 },
      timing: { ttft: 1, completionTime: 1, tps: 1, prefillTps: 5 },
    })
  })

  it('runs a planner chat turn to completion and appends a snapshot', async () => {
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    getAllInstructionsMock.mockResolvedValue({ content: 'Plan carefully', files: [] })
    getToolRegistryForModeMock.mockReturnValue({
      definitions: [{ type: 'function', function: { name: 'glob', description: 'Search', parameters: {} } }],
      execute: vi.fn(),
    })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock.mockResolvedValue({
      content: 'Planned response',
      toolCalls: [],
      segments: [{ type: 'text', content: 'Planned response' }],
      usage: { promptTokens: 30, completionTokens: 10 },
      timing: { ttft: 1, completionTime: 2, tps: 5, prefillTps: 30 },
      aborted: false,
    })

    const state: any = {
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: true,
        criteria: [],
        executionState: { currentTokenCount: 0, compactionCount: 0 },
        messages: [{ id: 'user-1', role: 'user', content: 'Do the plan' }],
      },
    }
    const sessionManager = createSessionManager(state)

    await runChatTurn({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
    })

    const eventTypes = eventStore.append.mock.calls.map(([, event]) => event.type)
    expect(eventTypes).toContain('message.start')
    expect(eventTypes).toContain('message.done')
    expect(eventTypes).toContain('chat.done')
    expect(eventTypes).toContain('turn.snapshot')
    expect(eventTypes.at(-1)).toBe('running.changed')
    expect(sessionManager.setCurrentContextSize).toHaveBeenCalledWith('session-1', 30, undefined)
    expect(eventStore.append.mock.calls.find(([, event]) => event.type === 'turn.snapshot')?.[1]).toMatchObject({
      type: 'turn.snapshot',
      data: expect.objectContaining({ mode: 'planner', phase: 'plan', snapshotSeq: expect.any(Number) }),
    })
  })

  it('auto-compacts planner context before the next LLM call when over threshold', async () => {
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    getAllInstructionsMock.mockResolvedValue({ content: 'Plan carefully', files: [] })
    getToolRegistryForModeMock.mockReturnValue({ definitions: [], execute: vi.fn() })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock
      .mockResolvedValueOnce({
        content: 'Compacted summary of the session including all file modifications and current progress on tasks',
        toolCalls: [],
        segments: [
          {
            type: 'text',
            content: 'Compacted summary of the session including all file modifications and current progress on tasks',
          },
        ],
        usage: { promptTokens: 190000, completionTokens: 100 },
        timing: { ttft: 1, completionTime: 1, tps: 100, prefillTps: 190000 },
        aborted: false,
      })
      .mockResolvedValueOnce({
        content: 'Planned response',
        toolCalls: [],
        segments: [{ type: 'text', content: 'Planned response' }],
        usage: { promptTokens: 20000, completionTokens: 10 },
        timing: { ttft: 1, completionTime: 1, tps: 10, prefillTps: 20000 },
        aborted: false,
      })

    const sessionManager = createSessionManager({
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: true,
        criteria: [],
        executionState: { currentTokenCount: 0, compactionCount: 0 },
        messages: [{ id: 'user-1', role: 'user', content: 'Do the plan' }],
      },
    })
    sessionManager.getContextState = vi.fn(() => ({
      currentTokens: 190000,
      maxTokens: 200000,
      compactionCount: 0,
      dangerZone: true,
      canCompact: true,
      dynamicContextChanged: false,
    }))

    await runChatTurn({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
    })

    expect(consumeStreamGeneratorMock).toHaveBeenCalled()
    const callArgs = consumeStreamGeneratorMock.mock.calls[0]?.[0] ?? {}
    expect(callArgs.toolChoice ?? 'auto').toBe('auto')
    // Compaction now emits context.compacted event instead of calling compactContext
    const compactEvents = eventStore.getEvents('session-1').filter((e: any) => e.type === 'context.compacted')
    expect(compactEvents.length).toBeGreaterThanOrEqual(1)
  })

  it('persists provider and model identity in emitted stats', async () => {
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    getAllInstructionsMock.mockResolvedValue({ content: 'Plan carefully', files: [] })
    getToolRegistryForModeMock.mockReturnValue({ definitions: [], execute: vi.fn() })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock.mockResolvedValue({
      content: 'Planned response',
      toolCalls: [],
      segments: [{ type: 'text', content: 'Planned response' }],
      usage: { promptTokens: 30, completionTokens: 10 },
      timing: { ttft: 1, completionTime: 2, tps: 5, prefillTps: 30 },
      aborted: false,
    })

    const state: any = {
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: true,
        criteria: [],
        executionState: { currentTokenCount: 0, compactionCount: 0 },
        messages: [{ id: 'user-1', role: 'user', content: 'Do the plan' }],
      },
    }
    const sessionManager = createSessionManager(state)

    await runChatTurn({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
      statsIdentity: {
        providerId: 'provider-1',
        providerName: 'Local vLLM',
        backend: 'vllm',
        model: 'qwen3-32b',
      },
    })

    // Find the message.done event for the actual assistant response (not the mode reminder)
    const messageDoneEvent = eventStore.append.mock.calls.find(([, event]) => {
      if (event.type !== 'message.done') return false
      const data = event.data as { stats?: unknown }
      return data.stats !== undefined
    })

    expect(messageDoneEvent?.[1]).toMatchObject({
      data: {
        stats: expect.objectContaining({
          providerId: 'provider-1',
          providerName: 'Local vLLM',
          backend: 'vllm',
          model: 'qwen3-32b',
        }),
      },
    })
  })

  it('handles ask-user interrupts during planner execution', async () => {
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    getAllInstructionsMock.mockResolvedValue({ content: '', files: [] })

    // Mock ask_user tool to simulate the new behavior: emit event, wait for answer, return it
    const executeMock = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'ask_user') {
        // Emit chat.ask_user event
        eventStore.append('session-1', {
          type: 'chat.ask_user',
          data: { callId: 'call-1', question: args['question'] },
        })
        // Simulate waiting for and receiving an answer
        return {
          success: true,
          output: 'User answered: yes',
          durationMs: 0,
          truncated: false,
        }
      }
      return { success: true, output: 'ok', durationMs: 0, truncated: false }
    })

    getToolRegistryForModeMock.mockReturnValue({
      definitions: [{ type: 'function', function: { name: 'ask_user', description: 'Ask', parameters: {} } }],
      execute: executeMock,
    })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-1', name: 'ask_user', arguments: { question: 'Need help?' } }],
        segments: [],
        usage: { promptTokens: 5, completionTokens: 1 },
        timing: { ttft: 1, completionTime: 1, tps: 1, prefillTps: 5 },
        aborted: false,
      })
      .mockResolvedValueOnce({
        content: 'Thanks for the answer',
        toolCalls: [],
        segments: [{ type: 'text', content: 'Thanks for the answer' }],
        usage: { promptTokens: 5, completionTokens: 3 },
        timing: { ttft: 1, completionTime: 1, tps: 3, prefillTps: 5 },
        aborted: false,
      })

    const sessionManager = createSessionManager({
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: true,
        criteria: [],
        executionState: { currentTokenCount: 0, compactionCount: 0 },
        messages: [{ id: 'user-1', role: 'user', content: 'Need a plan' }],
      },
    })

    await runChatTurn({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
    })

    // Verify chat.ask_user event was emitted
    const askUserEvent = eventStore.append.mock.calls.find(([, event]) => event.type === 'chat.ask_user')
    expect(askUserEvent).toBeDefined()
    expect((askUserEvent![1].data as any).question).toBe('Need help?')

    // Verify tool.result event was emitted with the answer
    const toolResultEvent = eventStore.append.mock.calls.find(([, event]) => event.type === 'tool.result')
    expect(toolResultEvent).toBeDefined()
    expect((toolResultEvent![1].data as any).result.success).toBe(true)

    // Agent should complete normally (not stop with waiting_for_user)
    const doneEvent = eventStore.append.mock.calls.find(([, event]) => event.type === 'chat.done')
    expect(doneEvent).toBeDefined()
  })

  it('converts path access denial into correction events and handles unknown errors', async () => {
    const pathErrorStore = createEventStore()
    getEventStoreMock.mockReturnValue(pathErrorStore)
    getAllInstructionsMock.mockRejectedValueOnce(new PathAccessDeniedError(['/etc/passwd'], 'read_file', 'both'))

    const sessionManager = createSessionManager({
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: true,
        criteria: [],
        executionState: { currentTokenCount: 0, compactionCount: 0 },
        messages: [],
      },
    })

    await runChatTurn({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
    })
    expect(pathErrorStore.append.mock.calls.find(([, event]) => event.type === 'chat.error')?.[1]).toMatchObject({
      data: { error: 'User denied access to files outside the project and sensitive files.', recoverable: false },
    })

    const unknownStore = createEventStore()
    getEventStoreMock.mockReturnValue(unknownStore)
    getAllInstructionsMock.mockRejectedValueOnce(new Error('boom'))

    await runChatTurn({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
    })
    expect(unknownStore.append.mock.calls.find(([, event]) => event.type === 'chat.error')?.[1]).toMatchObject({
      data: { error: 'boom', recoverable: false },
    })
  })

  it('swallows planner aborts without emitting error events', async () => {
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    getAllInstructionsMock.mockResolvedValue({ content: '', files: [] })
    getToolRegistryForModeMock.mockReturnValue({ definitions: [], execute: vi.fn() })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock.mockResolvedValueOnce({
      content: '',
      toolCalls: [],
      segments: [],
      usage: { promptTokens: 4, completionTokens: 1 },
      timing: { ttft: 1, completionTime: 1, tps: 1, prefillTps: 4 },
      aborted: true,
    })

    const sessionManager = createSessionManager({
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: true,
        criteria: [],
        executionState: { currentTokenCount: 0, compactionCount: 0 },
        messages: [{ id: 'user-1', role: 'user', content: 'Need a plan' }],
      },
    })

    await runChatTurn({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
    })

    expect(eventStore.append.mock.calls.some(([, event]) => event.type === 'chat.error')).toBe(false)
    expect(eventStore.append.mock.calls.find(([, event]) => event.type === 'chat.done')?.[1]).toMatchObject({
      data: { reason: 'stopped' },
    })
    expect(eventStore.append.mock.calls.some(([, event]) => event.type === 'turn.snapshot')).toBe(true)
  })

  it('aborts tool execution loop when signal is aborted between tool calls', async () => {
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    getAllInstructionsMock.mockResolvedValue({ content: '', files: [] })

    const controller = new AbortController()
    const executedTools: string[] = []

    // Track which tools were executed and abort after first one
    const execute = vi.fn(async (name: string) => {
      executedTools.push(name)
      if (executedTools.length === 1) {
        // Abort after first tool executes
        controller.abort()
      }
      return { success: true, output: 'ok', durationMs: 10, truncated: false }
    })

    getToolRegistryForModeMock.mockReturnValue({
      definitions: [
        { type: 'function', function: { name: 'glob', description: 'Search', parameters: {} } },
        { type: 'function', function: { name: 'read_file', description: 'Read', parameters: {} } },
        { type: 'function', function: { name: 'grep', description: 'Grep', parameters: {} } },
      ],
      execute,
    })

    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock.mockResolvedValueOnce({
      content: '',
      toolCalls: [
        { id: 'call-1', name: 'glob', arguments: { pattern: '*.ts' } },
        { id: 'call-2', name: 'read_file', arguments: { path: 'src/index.ts' } },
        { id: 'call-3', name: 'grep', arguments: { pattern: 'foo' } },
      ],
      segments: [],
      usage: { promptTokens: 10, completionTokens: 5 },
      timing: { ttft: 1, completionTime: 1, tps: 5, prefillTps: 10 },
      aborted: false,
    })

    const sessionManager = createSessionManager({
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'planner',
        phase: 'plan',
        isRunning: true,
        criteria: [],
        executionState: { currentTokenCount: 0, compactionCount: 0 },
        messages: [{ id: 'user-1', role: 'user', content: 'Search for files' }],
      },
    })

    await runChatTurn({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
      signal: controller.signal,
    })

    // Only 1 tool should have been executed before abort stopped the loop
    expect(executedTools).toEqual(['glob'])
    expect(execute).toHaveBeenCalledTimes(1)

    // Should have emitted stopped done event
    expect(eventStore.append.mock.calls.find(([, event]) => event.type === 'chat.done')?.[1]).toMatchObject({
      data: { reason: 'stopped' },
    })
  })

  it('retries builder turns after xml format errors and completes after tool execution', async () => {
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    getAllInstructionsMock.mockResolvedValue({ content: 'Build carefully', files: [] })

    const state: any = {
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'pending' }, attempts: [] }],
        executionState: {},
        messages: [{ id: 'user-1', role: 'user', content: 'Build it' }],
      },
    }
    const sessionManager = createSessionManager(state)
    const execute = vi.fn(async () => {
      state.current.criteria = [
        {
          id: 'tests-pass',
          description: 'Tests pass',
          status: { type: 'completed', completedAt: '2024-01-01T00:00:00.000Z' },
          attempts: [],
        },
      ]
      return { success: true, output: 'written', durationMs: 25, truncated: false }
    })
    getToolRegistryForModeMock.mockImplementation((mode: string) => ({
      tools: [
        {
          name: mode === 'builder' ? 'write_file' : 'noop',
          definition: {
            type: 'function',
            function: { name: mode === 'builder' ? 'write_file' : 'noop', description: 'Tool', parameters: {} },
          },
        },
      ],
      definitions: [
        {
          type: 'function',
          function: { name: mode === 'builder' ? 'write_file' : 'noop', description: 'Tool', parameters: {} },
        },
      ],
      execute,
    }))
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [],
        segments: [],
        usage: { promptTokens: 0, completionTokens: 0 },
        timing: { ttft: 0, completionTime: 0, tps: 0, prefillTps: 0 },
        aborted: false,
        patternMatch: { pattern: 'XML tool format', field: 'both', matchedContent: '' },
      })
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-1', name: 'write_file', arguments: { path: 'src/index.ts' } }],
        segments: [{ type: 'tool_call', toolCallId: 'call-1' }],
        usage: { promptTokens: 10, completionTokens: 4 },
        timing: { ttft: 1, completionTime: 1, tps: 4, prefillTps: 10 },
        aborted: false,
      })
      .mockResolvedValueOnce({
        content: 'done',
        toolCalls: [],
        segments: [{ type: 'text', content: 'done' }],
        usage: { promptTokens: 5, completionTokens: 2 },
        timing: { ttft: 1, completionTime: 1, tps: 2, prefillTps: 5 },
        aborted: false,
      })

    const appendMock = vi.fn()
    await runAgentTurn(
      {
        sessionManager: sessionManager as never,
        sessionId: 'session-1',
        llmClient: { getModel: () => 'qwen3-32b' } as never,
        onMessage: vi.fn(),
      },
      new TurnMetrics(),
      'builder',
      appendMock,
      {
        onToolExecuted: (_toolCall, _toolResult) => {
          // Hook for verifying tool execution in tests
        },
      },
    )

    const appendedTypes = appendMock.mock.calls.map(([event]) => event.type)
    expect(appendedTypes).toContain('pattern.retry')
    expect(appendedTypes).toContain('tool.call')
    expect(appendedTypes).toContain('tool.result')
    expect(appendedTypes).toContain('chat.done')
  })

  it('handles builder path denial and rethrows unexpected builder tool errors', async () => {
    const deniedStore = createEventStore()
    getEventStoreMock.mockReturnValue(deniedStore)
    getAllInstructionsMock.mockResolvedValue({ content: 'Build carefully', files: [] })
    const deniedState: any = {
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'pending' }, attempts: [] }],
        executionState: {},
        messages: [{ id: 'user-1', role: 'user', content: 'Build it' }],
      },
    }
    const deniedManager = createSessionManager(deniedState)
    getToolRegistryForModeMock.mockImplementation((mode: string) => ({
      tools: [
        {
          name: mode === 'builder' ? 'edit_file' : 'noop',
          definition: {
            type: 'function',
            function: { name: mode === 'builder' ? 'edit_file' : 'noop', description: 'Tool', parameters: {} },
          },
        },
      ],
      definitions: [
        {
          type: 'function',
          function: { name: mode === 'builder' ? 'edit_file' : 'noop', description: 'Tool', parameters: {} },
        },
      ],
      execute: vi.fn(async () => {
        throw new PathAccessDeniedError(['/etc/passwd'], 'edit_file')
      }),
    }))
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-1', name: 'edit_file', arguments: { path: '/etc/passwd' } }],
        segments: [],
        usage: { promptTokens: 10, completionTokens: 4 },
        timing: { ttft: 1, completionTime: 1, tps: 4, prefillTps: 10 },
        aborted: false,
      })
      .mockResolvedValueOnce({
        content: 'done',
        toolCalls: [],
        segments: [{ type: 'text', content: 'done' }],
        usage: { promptTokens: 5, completionTokens: 2 },
        timing: { ttft: 1, completionTime: 1, tps: 2, prefillTps: 5 },
        aborted: false,
      })

    const appendMock = vi.fn()
    await runAgentTurn(
      {
        sessionManager: deniedManager as never,
        sessionId: 'session-1',
        llmClient: { getModel: () => 'qwen3-32b' } as never,
        onMessage: vi.fn(),
      },
      new TurnMetrics(),
      'builder',
      appendMock,
    )
    expect(appendMock.mock.calls.find(([event]) => event.type === 'tool.result')?.[0]).toMatchObject({
      data: {
        result: {
          success: false,
          error: 'User denied access to /etc/passwd. If you need this file, explain why and ask for permission.',
        },
      },
    })

    const errorStore = createEventStore()
    getEventStoreMock.mockReturnValue(errorStore)
    const errorState: any = {
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'pending' }, attempts: [] }],
        executionState: {},
        messages: [{ id: 'user-1', role: 'user', content: 'Build it' }],
      },
    }
    const errorManager = createSessionManager(errorState)
    getToolRegistryForModeMock.mockImplementation((mode: string) => ({
      tools: [
        {
          name: mode === 'builder' ? 'edit_file' : 'noop',
          definition: {
            type: 'function',
            function: { name: mode === 'builder' ? 'edit_file' : 'noop', description: 'Tool', parameters: {} },
          },
        },
      ],
      definitions: [
        {
          type: 'function',
          function: { name: mode === 'builder' ? 'edit_file' : 'noop', description: 'Tool', parameters: {} },
        },
      ],
      execute: vi.fn(async () => {
        throw new Error('unexpected builder failure')
      }),
    }))
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock.mockResolvedValueOnce({
      content: '',
      toolCalls: [{ id: 'call-1', name: 'edit_file', arguments: { path: '/etc/passwd' } }],
      segments: [],
      usage: { promptTokens: 10, completionTokens: 4 },
      timing: { ttft: 1, completionTime: 1, tps: 4, prefillTps: 10 },
      aborted: false,
    })

    await expect(
      runAgentTurn(
        {
          sessionManager: errorManager as never,
          sessionId: 'session-1',
          llmClient: { getModel: () => 'qwen3-32b' } as never,
          onMessage: vi.fn(),
        },
        new TurnMetrics(),
        'builder',
        vi.fn(),
      ),
    ).rejects.toThrow('unexpected builder failure')
  })

  it('returns error tool result when tool call has parseError', async () => {
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    getCurrentContextWindowIdMock.mockReturnValue('window-1')
    getAllInstructionsMock.mockResolvedValue({ content: '', files: [] })
    getContextMessagesMock.mockReturnValue([{ role: 'user' as const, content: 'Do something' }])
    getConversationMessagesMock.mockReturnValue([
      { role: 'user' as const, content: 'Do something', source: 'history' as const },
    ])
    const execute = vi.fn()
    getToolRegistryForModeMock.mockReturnValue({
      tools: [
        {
          name: 'glob',
          definition: { type: 'function', function: { name: 'glob', description: 'Tool', parameters: {} } },
        },
      ],
      definitions: [{ type: 'function', function: { name: 'glob', description: 'Tool', parameters: {} } }],
      execute,
    })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'call-1',
            name: 'glob',
            arguments: {},
            parseError: 'Unexpected token in JSON at position 1',
            rawArguments: '{bad-json',
          },
        ],
        segments: [],
        usage: { promptTokens: 10, completionTokens: 3 },
        timing: { ttft: 1, completionTime: 1, tps: 3, prefillTps: 10 },
        aborted: false,
      })
      .mockResolvedValueOnce({
        content: 'Done',
        toolCalls: [],
        segments: [{ type: 'text', content: 'Done' }],
        usage: { promptTokens: 5, completionTokens: 2 },
        timing: { ttft: 1, completionTime: 1, tps: 2, prefillTps: 5 },
        aborted: false,
      })

    const sessionManager = createSessionManager({
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'pending' }, attempts: [] }],
        executionState: {},
        messages: [{ id: 'user-1', role: 'user', content: 'Do something' }],
      },
    })

    const appendMock = vi.fn()
    await runAgentTurn(
      {
        sessionManager: sessionManager as never,
        sessionId: 'session-1',
        llmClient: { getModel: () => 'qwen3-32b' } as never,
        onMessage: vi.fn(),
      },
      new TurnMetrics(),
      'builder',
      appendMock,
    )

    // Verify tool execution was NOT called
    expect(execute).not.toHaveBeenCalled()

    // Verify tool.result event was emitted with error
    const toolResultEvent = appendMock.mock.calls.find(([event]) => event.type === 'tool.result')
    expect(toolResultEvent).toBeDefined()
    const toolResultData = toolResultEvent![0].data as {
      toolCallId: string
      result: { success: boolean; error: string }
    }
    expect(toolResultData.toolCallId).toBe('call-1')
    expect(toolResultData.result.success).toBe(false)
    expect(toolResultData.result.error).toContain('Failed to parse tool call arguments')
    expect(toolResultData.result.error).toContain('Unexpected token in JSON at position 1')
    expect(toolResultData.result.error).toContain('Please ensure your JSON function call arguments are valid')
  })

  it('does not inject step_done tool by default in builder turns', async () => {
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    getCurrentContextWindowIdMock.mockReturnValue('window-1')
    getAllInstructionsMock.mockResolvedValue({ content: 'Build carefully', files: [] })
    getContextMessagesMock.mockReturnValue([{ role: 'user' as const, content: 'Do something' }])
    getConversationMessagesMock.mockReturnValue([
      { role: 'user' as const, content: 'Do something', source: 'history' as const },
    ])

    let capturedTools: any[] = []
    getToolRegistryForModeMock.mockImplementation(() => ({
      tools: [
        {
          name: 'read_file',
          definition: { type: 'function', function: { name: 'read_file', description: 'Read', parameters: {} } },
        },
        {
          name: 'step_done',
          definition: { type: 'function', function: { name: 'step_done', description: 'Step done', parameters: {} } },
        },
      ],
      definitions: [
        { type: 'function', function: { name: 'read_file', description: 'Read', parameters: {} } },
        { type: 'function', function: { name: 'step_done', description: 'Step done', parameters: {} } },
      ],
      execute: vi.fn(),
    }))
    streamLLMPureMock.mockImplementation((options: any) => {
      capturedTools = options.tools?.map((t: any) => t.function?.name) || []
      return { kind: 'stream' }
    })
    consumeStreamGeneratorMock.mockResolvedValueOnce({
      content: 'Done',
      toolCalls: [],
      segments: [{ type: 'text', content: 'Done' }],
      usage: { promptTokens: 10, completionTokens: 3 },
      timing: { ttft: 1, completionTime: 1, tps: 3, prefillTps: 10 },
      aborted: false,
    })

    const sessionManager = createSessionManager({
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [{ id: 'c1', description: 'Test', status: { type: 'pending' }, attempts: [] }],
        executionState: {},
        messages: [{ id: 'user-1', role: 'user', content: 'Do something' }],
      },
    })

    const appendMock = vi.fn()
    await runAgentTurn(
      {
        sessionManager: sessionManager as never,
        sessionId: 'session-1',
        llmClient: { getModel: () => 'qwen3-32b' } as never,
        onMessage: vi.fn(),
      },
      new TurnMetrics(),
      'builder',
      appendMock,
    )

    // step_done is now ALWAYS included to maintain stable tools hash for LLM caching
    expect(capturedTools).toContain('step_done')
  })

  it('includes step_done tool for builder agent turns', async () => {
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    getCurrentContextWindowIdMock.mockReturnValue('window-1')
    getAllInstructionsMock.mockResolvedValue({ content: 'Build carefully', files: [] })
    getContextMessagesMock.mockReturnValue([{ role: 'user' as const, content: 'Do something' }])
    getConversationMessagesMock.mockReturnValue([
      { role: 'user' as const, content: 'Do something', source: 'history' as const },
    ])

    let capturedTools: any[] = []
    getToolRegistryForModeMock.mockImplementation(() => ({
      tools: [
        {
          name: 'read_file',
          definition: { type: 'function', function: { name: 'read_file', description: 'Read', parameters: {} } },
        },
        {
          name: 'step_done',
          definition: { type: 'function', function: { name: 'step_done', description: 'Step done', parameters: {} } },
        },
      ],
      definitions: [
        { type: 'function', function: { name: 'read_file', description: 'Read', parameters: {} } },
        { type: 'function', function: { name: 'step_done', description: 'Step done', parameters: {} } },
      ],
      execute: vi.fn(),
    }))
    streamLLMPureMock.mockImplementation((options: any) => {
      capturedTools = options.tools?.map((t: any) => t.function?.name) || []
      return { kind: 'stream' }
    })
    consumeStreamGeneratorMock.mockResolvedValueOnce({
      content: 'Done',
      toolCalls: [],
      segments: [{ type: 'text', content: 'Done' }],
      usage: { promptTokens: 10, completionTokens: 3 },
      timing: { ttft: 1, completionTime: 1, tps: 3, prefillTps: 10 },
      aborted: false,
    })

    const sessionManager = createSessionManager({
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [{ id: 'c1', description: 'Test', status: { type: 'pending' }, attempts: [] }],
        executionState: {},
        messages: [{ id: 'user-1', role: 'user', content: 'Do something' }],
      },
    })

    await runAgentTurn(
      {
        sessionManager: sessionManager as never,
        sessionId: 'session-1',
        llmClient: { getModel: () => 'qwen3-32b' } as never,
        onMessage: vi.fn(),
      },
      new TurnMetrics(),
      'builder',
      vi.fn(),
    )

    expect(capturedTools).toContain('step_done')
  })

  it('does not inject a builder kickoff prompt for manual builder turns', async () => {
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    getCurrentContextWindowIdMock.mockReturnValue('window-1')
    getAllInstructionsMock.mockResolvedValue({ content: 'Build carefully', files: [] })
    getContextMessagesMock.mockReturnValue([{ role: 'user' as const, content: 'Rename the helper function' }])
    getConversationMessagesMock.mockReturnValue([
      { role: 'user' as const, content: 'Rename the helper function', source: 'history' as const },
    ])
    getToolRegistryForModeMock.mockReturnValue({ tools: [], definitions: [], execute: vi.fn() })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock.mockResolvedValueOnce({
      content: 'Done',
      toolCalls: [],
      segments: [{ type: 'text', content: 'Done' }],
      usage: { promptTokens: 10, completionTokens: 3 },
      timing: { ttft: 1, completionTime: 1, tps: 3, prefillTps: 10 },
      aborted: false,
    })

    const sessionManager = createSessionManager({
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [{ id: 'c1', description: 'Test', status: { type: 'pending' }, attempts: [] }],
        executionState: {},
        messages: [{ id: 'user-1', role: 'user', content: 'Rename the helper function' }],
      },
    })

    await runAgentTurn(
      {
        sessionManager: sessionManager as never,
        sessionId: 'session-1',
        llmClient: { getModel: () => 'qwen3-32b' } as never,
      },
      new TurnMetrics(),
      'builder',
      vi.fn(),
    )

    const kickoffEvent = eventStore.append.mock.calls.find(([, event]) => {
      if (event.type !== 'message.start') return false
      const data = event.data as { content?: string; messageKind?: string }
      return data.messageKind === 'auto-prompt' && data.content?.includes('Implement the task and make sure you fulfil')
    })

    expect(kickoffEvent).toBeUndefined()
  })

  it('injects a builder kickoff prompt for orchestrated builder turns', async () => {
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    getCurrentContextWindowIdMock.mockReturnValue('window-1')
    getAllInstructionsMock.mockResolvedValue({ content: 'Build carefully', files: [] })
    getContextMessagesMock.mockReturnValue([{ role: 'user' as const, content: 'Rename the helper function' }])
    getConversationMessagesMock.mockReturnValue([
      { role: 'user' as const, content: 'Rename the helper function', source: 'history' as const },
    ])
    getToolRegistryForModeMock.mockReturnValue({ tools: [], definitions: [], execute: vi.fn() })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock.mockResolvedValueOnce({
      content: 'Done',
      toolCalls: [],
      segments: [{ type: 'text', content: 'Done' }],
      usage: { promptTokens: 10, completionTokens: 3 },
      timing: { ttft: 1, completionTime: 1, tps: 3, prefillTps: 10 },
      aborted: false,
    })

    const sessionManager = createSessionManager({
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [{ id: 'c1', description: 'Test', status: { type: 'pending' }, attempts: [] }],
        executionState: {},
        messages: [{ id: 'user-1', role: 'user', content: 'Rename the helper function' }],
      },
    })

    await runAgentTurn(
      {
        sessionManager: sessionManager as never,
        sessionId: 'session-1',
        llmClient: { getModel: () => 'qwen3-32b' } as never,
      },
      new TurnMetrics(),
      'builder',
      vi.fn(),
      {
        injectKickoff: () => {
          eventStore.append('session-1', {
            type: 'message.start',
            data: {
              messageId: 'kickoff-1',
              role: 'user',
              content: 'Implement the task and make sure you fulfil',
              isSystemGenerated: true,
              messageKind: 'auto-prompt',
              metadata: { type: 'workflow', name: 'Workflow', color: '#f59e0b' },
            },
          })
          eventStore.append('session-1', { type: 'message.done', data: { messageId: 'kickoff-1' } })
        },
      },
    )

    const kickoffEvent = eventStore.append.mock.calls.find(([, event]) => {
      if (event.type !== 'message.start') return false
      const data = event.data as { content?: string; messageKind?: string }
      return data.messageKind === 'auto-prompt' && data.content?.includes('Implement the task and make sure you fulfil')
    })

    expect(kickoffEvent).toBeDefined()
  })

  describe('context window filtering', () => {
    it('planner turn uses getContextMessages to filter by current window', async () => {
      const eventStore = createEventStore()
      getEventStoreMock.mockReturnValue(eventStore)

      // Mock getContextMessages to return only current-window messages
      const currentWindowMessages = [{ role: 'user' as const, content: 'Current window message' }]
      getContextMessagesMock.mockReturnValue(currentWindowMessages)
      getConversationMessagesMock.mockReturnValue([
        { role: 'user' as const, content: 'Current window message', source: 'history' as const },
      ])
      getCurrentContextWindowIdMock.mockReturnValue('window-2')

      getAllInstructionsMock.mockResolvedValue({ content: '', files: [] })
      getToolRegistryForModeMock.mockReturnValue({ definitions: [], execute: vi.fn() })
      streamLLMPureMock.mockReturnValue({ kind: 'stream' })
      consumeStreamGeneratorMock.mockResolvedValue({
        content: 'Response',
        toolCalls: [],
        segments: [{ type: 'text', content: 'Response' }],
        usage: { promptTokens: 10, completionTokens: 5 },
        timing: { ttft: 1, completionTime: 1, tps: 5, prefillTps: 10 },
        aborted: false,
      })

      const sessionManager = createSessionManager({
        current: {
          id: 'session-1',
          projectId: 'project-1',
          workdir: '/tmp/project',
          mode: 'planner',
          phase: 'plan',
          isRunning: true,
          criteria: [],
          executionState: {},
          messages: [],
        },
      })

      await runChatTurn({
        sessionManager: sessionManager as never,
        sessionId: 'session-1',
        llmClient: { getModel: () => 'qwen3-32b' } as never,
      })

      // Verify getConversationMessages (the unified method) was called with session ID
      expect(getConversationMessagesMock).toHaveBeenCalledWith(
        { type: 'toplevel', sessionId: 'session-1' },
        expect.any(Object),
      )

      // After fix: streamLLMPure does NOT merge reminder into messages (preserves vLLM cache)
      // The reminder is injected as a separate message by injectAgentReminder()
      expect(streamLLMPureMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [expect.objectContaining({ role: 'user', content: 'Current window message' })],
        }),
      )
      // The message should NOT contain the reminder (it's a separate message now)
      expect(streamLLMPureMock.mock.calls[0]?.[0]?.messages[0]?.content).not.toContain('Plan mode ACTIVE')
    })

    it('builder turn uses getContextMessages to filter by current window', async () => {
      const eventStore = createEventStore()
      getEventStoreMock.mockReturnValue(eventStore)

      const currentWindowMessages = [{ role: 'user' as const, content: 'Build this' }]
      getContextMessagesMock.mockReturnValue(currentWindowMessages)
      getConversationMessagesMock.mockReturnValue([
        { role: 'user' as const, content: 'Build this', source: 'history' as const },
      ])
      getCurrentContextWindowIdMock.mockReturnValue('window-2')

      getAllInstructionsMock.mockResolvedValue({ content: '', files: [] })
      getToolRegistryForModeMock.mockReturnValue({ tools: [], definitions: [], execute: vi.fn() })
      streamLLMPureMock.mockReturnValue({ kind: 'stream' })
      consumeStreamGeneratorMock.mockResolvedValue({
        content: 'Built',
        toolCalls: [],
        segments: [{ type: 'text', content: 'Built' }],
        usage: { promptTokens: 10, completionTokens: 5 },
        timing: { ttft: 1, completionTime: 1, tps: 5, prefillTps: 10 },
        aborted: false,
      })

      const sessionManager = createSessionManager({
        current: {
          id: 'session-1',
          projectId: 'project-1',
          workdir: '/tmp/project',
          mode: 'builder',
          phase: 'build',
          isRunning: true,
          criteria: [{ id: 'c1', description: 'Test', status: { type: 'pending' }, attempts: [] }],
          executionState: {},
          messages: [],
        },
      })

      await runAgentTurn(
        {
          sessionManager: sessionManager as never,
          sessionId: 'session-1',
          llmClient: { getModel: () => 'qwen3-32b' } as never,
        },
        new TurnMetrics(),
        'builder',
        vi.fn(),
      )

      // Verify getConversationMessages (the unified method) was called with session ID
      expect(getConversationMessagesMock).toHaveBeenCalledWith(
        { type: 'toplevel', sessionId: 'session-1' },
        expect.any(Object),
      )
      // After fix: Builder does NOT inject reminder into messages (preserves vLLM cache)
      // The reminder is injected as a separate message by injectAgentReminder()
      expect(streamLLMPureMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [expect.objectContaining({ role: 'user', content: 'Build this' })],
        }),
      )
      // The message should NOT contain the reminder (it's a separate message now)
      expect(streamLLMPureMock.mock.calls[0]?.[0]?.messages[0]?.content).not.toContain('Build mode ACTIVE')
    })

    it('does not inject step_done tool by default in builder turns', async () => {
      const eventStore = createEventStore()
      getEventStoreMock.mockReturnValue(eventStore)

      getContextMessagesMock.mockReturnValue([{ role: 'user' as const, content: 'Build this' }])
      getConversationMessagesMock.mockReturnValue([
        { role: 'user' as const, content: 'Build this', source: 'history' as const },
      ])
      getAllInstructionsMock.mockResolvedValue({ content: '', files: [] })

      const mockToolRegistry = {
        definitions: [{ type: 'function' as const, function: { name: 'read_file', parameters: {} } }],
        execute: vi.fn(),
        tools: [],
      }
      getToolRegistryForModeMock.mockReturnValue(mockToolRegistry)
      streamLLMPureMock.mockReturnValue({ kind: 'stream' })
      consumeStreamGeneratorMock.mockResolvedValue({
        content: 'Built',
        toolCalls: [],
        segments: [{ type: 'text', content: 'Built' }],
        usage: { promptTokens: 10, completionTokens: 5 },
        timing: { ttft: 1, completionTime: 1, tps: 5, prefillTps: 10 },
        aborted: false,
      })

      const sessionManager = createSessionManager({
        current: {
          id: 'session-1',
          projectId: 'project-1',
          workdir: '/tmp/project',
          mode: 'builder',
          phase: 'build',
          isRunning: true,
          criteria: [{ id: 'c1', description: 'Test', status: { type: 'pending' }, attempts: [] }],
          executionState: {},
          messages: [],
        },
      })

      await runAgentTurn(
        {
          sessionManager: sessionManager as never,
          sessionId: 'session-1',
          llmClient: { getModel: () => 'qwen3-32b' } as never,
        },
        new TurnMetrics(),
        'builder',
        vi.fn(),
      )

      expect(streamLLMPureMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([
            expect.objectContaining({ type: 'function', function: expect.objectContaining({ name: 'read_file' }) }),
          ]),
        }),
      )
      const calledTools = streamLLMPureMock.mock.calls[0]?.[0]?.tools
      // return_value should never be exposed to top-level agents
      expect(calledTools).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ function: expect.objectContaining({ name: 'return_value' }) }),
        ]),
      )
    })

    it('includes step_done tool for builder agent turns', async () => {
      const eventStore = createEventStore()
      getEventStoreMock.mockReturnValue(eventStore)

      getContextMessagesMock.mockReturnValue([{ role: 'user' as const, content: 'Build this' }])
      getConversationMessagesMock.mockReturnValue([
        { role: 'user' as const, content: 'Build this', source: 'history' as const },
      ])
      getAllInstructionsMock.mockResolvedValue({ content: '', files: [] })

      const mockToolRegistry = {
        tools: [
          {
            name: 'read_file',
            definition: { type: 'function' as const, function: { name: 'read_file', parameters: {} } },
          },
          {
            name: 'step_done',
            definition: { type: 'function' as const, function: { name: 'step_done', parameters: {} } },
          },
        ],
        definitions: [
          { type: 'function' as const, function: { name: 'read_file', parameters: {} } },
          { type: 'function' as const, function: { name: 'step_done', parameters: {} } },
        ],
        execute: vi.fn(),
      }
      getToolRegistryForModeMock.mockReturnValue(mockToolRegistry)
      streamLLMPureMock.mockReturnValue({ kind: 'stream' })
      consumeStreamGeneratorMock.mockResolvedValue({
        content: 'Built',
        toolCalls: [],
        segments: [{ type: 'text', content: 'Built' }],
        usage: { promptTokens: 10, completionTokens: 5 },
        timing: { ttft: 1, completionTime: 1, tps: 5, prefillTps: 10 },
        aborted: false,
      })

      const sessionManager = createSessionManager({
        current: {
          id: 'session-1',
          projectId: 'project-1',
          workdir: '/tmp/project',
          mode: 'builder',
          phase: 'build',
          isRunning: true,
          criteria: [{ id: 'c1', description: 'Test', status: { type: 'pending' }, attempts: [] }],
          executionState: {},
          messages: [],
        },
      })

      await runAgentTurn(
        {
          sessionManager: sessionManager as never,
          sessionId: 'session-1',
          llmClient: { getModel: () => 'qwen3-32b' } as never,
        },
        new TurnMetrics(),
        'builder',
        vi.fn(),
      )

      expect(streamLLMPureMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([
            expect.objectContaining({ function: expect.objectContaining({ name: 'step_done' }) }),
          ]),
        }),
      )
    })

    it('auto-compacts builder context before the next LLM call when over threshold', async () => {
      const eventStore = createEventStore()
      getEventStoreMock.mockReturnValue(eventStore)
      const append = vi.fn()

      getContextMessagesMock.mockReturnValue([{ role: 'user' as const, content: 'Build this' }])
      getConversationMessagesMock.mockReturnValue([
        { role: 'user' as const, content: 'Build this', source: 'history' as const },
      ])
      getAllInstructionsMock.mockResolvedValue({ content: '', files: [] })
      getToolRegistryForModeMock.mockReturnValue({ tools: [], definitions: [], execute: vi.fn() })
      streamLLMPureMock.mockReturnValue({ kind: 'stream' })
      consumeStreamGeneratorMock
        .mockResolvedValueOnce({
          content: 'Compacted summary of the session including all file modifications and current progress on tasks',
          toolCalls: [],
          segments: [
            {
              type: 'text',
              content:
                'Compacted summary of the session including all file modifications and current progress on tasks',
            },
          ],
          usage: { promptTokens: 190000, completionTokens: 100 },
          timing: { ttft: 1, completionTime: 1, tps: 100, prefillTps: 190000 },
          aborted: false,
        })
        .mockResolvedValueOnce({
          content: 'Compacted summary',
          toolCalls: [],
          segments: [{ type: 'text', content: 'Compacted summary' }],
          usage: { promptTokens: 500, completionTokens: 50 },
          timing: { ttft: 1, completionTime: 1, tps: 50, prefillTps: 500 },
          aborted: false,
        })
        .mockResolvedValueOnce({
          content: 'Built',
          toolCalls: [],
          segments: [{ type: 'text', content: 'Built' }],
          usage: { promptTokens: 20000, completionTokens: 5 },
          timing: { ttft: 1, completionTime: 1, tps: 5, prefillTps: 20000 },
          aborted: false,
        })

      const sessionManager = createSessionManager({
        current: {
          id: 'session-1',
          projectId: 'project-1',
          workdir: '/tmp/project',
          mode: 'builder',
          phase: 'build',
          isRunning: true,
          criteria: [{ id: 'c1', description: 'Test', status: { type: 'pending' }, attempts: [] }],
          executionState: {},
          messages: [],
        },
      })

      await runAgentTurn(
        {
          sessionManager: sessionManager as never,
          sessionId: 'session-1',
          llmClient: { getModel: () => 'qwen3-32b' } as any,
        },
        new TurnMetrics(),
        'builder',
        append,
      )

      // Compaction emits context.compacted via the append function
      const compactEvents = append.mock.calls
        .map((args: unknown[]) => args[0] as any)
        .filter((e: any) => e.type === 'context.compacted')
      expect(compactEvents.length).toBeGreaterThanOrEqual(1)
    })

    it('assistant messages include contextWindowId', async () => {
      const eventStore = createEventStore()
      getEventStoreMock.mockReturnValue(eventStore)

      getContextMessagesMock.mockReturnValue([{ role: 'user' as const, content: 'Hello' }])
      getConversationMessagesMock.mockReturnValue([
        { role: 'user' as const, content: 'Hello', source: 'history' as const },
      ])
      getCurrentContextWindowIdMock.mockReturnValue('window-123')

      getAllInstructionsMock.mockResolvedValue({ content: '', files: [] })
      getToolRegistryForModeMock.mockReturnValue({ definitions: [], execute: vi.fn() })
      streamLLMPureMock.mockReturnValue({ kind: 'stream' })
      consumeStreamGeneratorMock.mockResolvedValue({
        content: 'Hi',
        toolCalls: [],
        segments: [{ type: 'text', content: 'Hi' }],
        usage: { promptTokens: 5, completionTokens: 2 },
        timing: { ttft: 1, completionTime: 1, tps: 2, prefillTps: 5 },
        aborted: false,
      })

      const sessionManager = createSessionManager({
        current: {
          id: 'session-1',
          projectId: 'project-1',
          workdir: '/tmp/project',
          mode: 'planner',
          phase: 'plan',
          isRunning: true,
          criteria: [],
          executionState: {},
          messages: [],
        },
      })

      await runChatTurn({
        sessionManager: sessionManager as never,
        sessionId: 'session-1',
        llmClient: { getModel: () => 'qwen3-32b' } as never,
      })

      // Find the message.start event for the assistant
      const assistantStart = eventStore.append.mock.calls.find(
        ([, event]) => event.type === 'message.start' && (event.data as any).role === 'assistant',
      )

      expect(assistantStart).toBeDefined()
      expect((assistantStart![1].data as any).contextWindowId).toBe('window-123')
    })
  })
})
