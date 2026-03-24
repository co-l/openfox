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
  streamLLMResponseMock,
} = vi.hoisted(() => ({
  getEventStoreMock: vi.fn(),
  getContextMessagesMock: vi.fn(),
  getCurrentContextWindowIdMock: vi.fn(),
  getAllInstructionsMock: vi.fn(),
  getToolRegistryForModeMock: vi.fn(),
  createToolProgressHandlerMock: vi.fn(() => undefined),
  streamLLMPureMock: vi.fn(),
  consumeStreamGeneratorMock: vi.fn(),
  streamLLMResponseMock: vi.fn(async (options?: any) => {
    const consumeResult = await consumeStreamGeneratorMock()
    if (!consumeResult) {
      return {
        messageId: 'verifier-msg',
        content: 'done',
        toolCalls: [],
        segments: [],
        usage: { promptTokens: 5, completionTokens: 1 },
        timing: { ttft: 1, completionTime: 1, tps: 1, prefillTps: 5 },
      }
    }
    if (consumeResult.aborted) {
      throw new Error('Aborted')
    }
    return {
      messageId: 'verifier-msg',
      content: consumeResult.content,
      toolCalls: consumeResult.toolCalls,
      segments: consumeResult.segments ?? [],
      usage: consumeResult.usage,
      timing: consumeResult.timing,
    }
  }),
}))

vi.mock('../events/index.js', () => ({
  getEventStore: getEventStoreMock,
  getContextMessages: getContextMessagesMock,
  getCurrentContextWindowId: getCurrentContextWindowIdMock,
}))

vi.mock('../context/instructions.js', () => ({
  getAllInstructions: getAllInstructionsMock,
}))

vi.mock('../skills/registry.js', () => ({
  getEnabledSkillMetadata: vi.fn(async () => []),
}))

vi.mock('../runtime-config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime-config.js')>()
  return {
    ...actual,
    getRuntimeConfig: vi.fn(() => ({
      ...actual.getRuntimeConfig(),
      mode: 'development',
    })),
  }
})

vi.mock('../../cli/paths.js', () => ({
  getGlobalConfigDir: vi.fn(() => '/tmp/openfox-test'),
}))

vi.mock('../tools/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tools/index.js')>()
  return {
    ...actual,
    getToolRegistryForMode: getToolRegistryForModeMock,
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

vi.mock('./stream.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./stream.js')>()
  return {
    ...actual,
    streamLLMResponse: streamLLMResponseMock,
  }
})

vi.mock('../sub-agents/registry.js', () => ({
  createSubAgentRegistry: () => ({
    getSubAgent: () => ({
      id: 'verifier',
      name: 'Verifier',
      systemPrompt: 'You are a verifier',
      tools: ['read_file', 'run_command', 'pass_criterion', 'fail_criterion'],
      createContext: (session: any, args: any) => ({
        systemPrompt: 'You are a verifier',
        injectedFiles: [],
        userMessage: args.prompt,
        messages: [
          { role: 'user', content: `Context for ${session.summary ?? 'task'}`, source: 'runtime' },
          { role: 'user', content: args.prompt, source: 'runtime' },
        ],
        tools: [],
        requestOptions: { toolChoice: 'auto', disableThinking: true },
      }),
    }),
  }),
}))

import { AskUserInterrupt } from '../tools/ask.js'
import { PathAccessDeniedError } from '../tools/path-security.js'
import { TurnMetrics, runBuilderTurn, runChatTurn, runVerifierTurn } from './orchestrator.js'

function createEventStore() {
  const eventsBySession = new Map<string, Array<{ seq: number; sessionId: string; timestamp: number; type: string; data: unknown }>>()

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
    getLatestSeq: vi.fn((sessionId: string) => {
      const events = eventsBySession.get(sessionId) ?? []
      return events.at(-1)?.seq ?? null
    }),
  }
}

function createSessionManager(state: Record<string, any>) {
  return {
    requireSession: vi.fn(() => structuredClone(state['current'])),
    getCurrentWindowMessages: vi.fn(() => state['current'].messages ?? []),
    getContextState: vi.fn(() => ({
      currentTokens: 0,
      maxTokens: 200000,
      compactionCount: 0,
      dangerZone: false,
      canCompact: false,
    })),
    setCurrentContextSize: vi.fn(),
    addTokensUsed: vi.fn(),
    compactContext: vi.fn(),
    getLspManager: vi.fn(() => ({ name: 'lsp' })),
    updateCriterionStatus: vi.fn((_: string, criterionId: string, status: Record<string, unknown>) => {
      state['current'].criteria = state['current'].criteria.map((criterion: any) =>
        criterion.id === criterionId ? { ...criterion, status } : criterion,
      )
    }),
    addCriterionAttempt: vi.fn((_: string, criterionId: string, attempt: Record<string, unknown>) => {
      state['current'].criteria = state['current'].criteria.map((criterion: any) =>
        criterion.id === criterionId
          ? { ...criterion, attempts: [...criterion.attempts, attempt] }
          : criterion,
      )
    }),
    addModifiedFile: vi.fn((_: string, path: string) => {
      state['current'].executionState = { ...(state['current'].executionState ?? {}), modifiedFiles: [path] }
    }),
    addMessage: vi.fn((_: string, __: any) => ({ id: crypto.randomUUID(), role: 'user', content: '', timestamp: new Date().toISOString() })),
    addAssistantMessage: vi.fn((_: string, __: any) => ({ id: crypto.randomUUID(), role: 'assistant', content: '', timestamp: new Date().toISOString(), isStreaming: true })),
    updateMessage: vi.fn(),
    updateMessageStats: vi.fn(),
  }
}

describe('chat orchestrator', () => {
  beforeEach(() => {
    getEventStoreMock.mockReset()
    getContextMessagesMock.mockReset()
    getCurrentContextWindowIdMock.mockReset()
    getContextMessagesMock.mockReturnValue([])
    getCurrentContextWindowIdMock.mockReturnValue(undefined)
    getAllInstructionsMock.mockReset()
    getToolRegistryForModeMock.mockReset()
    createToolProgressHandlerMock.mockClear()
    streamLLMPureMock.mockReset()
    consumeStreamGeneratorMock.mockReset()
    streamLLMResponseMock.mockReset()
    streamLLMResponseMock.mockResolvedValue({
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
    getToolRegistryForModeMock.mockReturnValue({ definitions: [{ type: 'function', function: { name: 'glob', description: 'Search', parameters: {} } }], execute: vi.fn() })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock.mockResolvedValue({
      content: 'Planned response',
      toolCalls: [],
      segments: [{ type: 'text', content: 'Planned response' }],
      usage: { promptTokens: 30, completionTokens: 10 },
      timing: { ttft: 1, completionTime: 2, tps: 5, prefillTps: 30 },
      aborted: false,
      xmlFormatError: false,
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
    expect(sessionManager.setCurrentContextSize).toHaveBeenCalledWith('session-1', 30)
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
        content: 'Compacted summary',
        toolCalls: [],
        segments: [{ type: 'text', content: 'Compacted summary' }],
        usage: { promptTokens: 190000, completionTokens: 100 },
        timing: { ttft: 1, completionTime: 1, tps: 100, prefillTps: 190000 },
        aborted: false,
        xmlFormatError: false,
      })
      .mockResolvedValueOnce({
        content: 'Planned response',
        toolCalls: [],
        segments: [{ type: 'text', content: 'Planned response' }],
        usage: { promptTokens: 20000, completionTokens: 10 },
        timing: { ttft: 1, completionTime: 1, tps: 10, prefillTps: 20000 },
        aborted: false,
        xmlFormatError: false,
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
    }))

    await runChatTurn({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
    })

    expect(consumeStreamGeneratorMock).toHaveBeenCalledTimes(2)
    expect(streamLLMPureMock.mock.calls[0]?.[0]).toMatchObject({ toolChoice: 'none', disableThinking: true, tools: [] })
    expect(streamLLMPureMock.mock.calls[1]?.[0]).toMatchObject({ toolChoice: 'auto' })
    expect(sessionManager.compactContext).toHaveBeenCalledWith('session-1', 'Compacted summary', 190000)
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
      xmlFormatError: false,
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

    expect(eventStore.append.mock.calls.find(([, event]) => event.type === 'message.done')?.[1]).toMatchObject({
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
    getToolRegistryForModeMock.mockReturnValue({
      definitions: [{ type: 'function', function: { name: 'ask_user', description: 'Ask', parameters: {} } }],
      execute: vi.fn(async () => {
        throw new AskUserInterrupt('call-1', 'Need help?')
      }),
    })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock.mockResolvedValue({
      content: '',
      toolCalls: [{ id: 'call-1', name: 'ask_user', arguments: { question: 'Need help?' } }],
      segments: [],
      usage: { promptTokens: 5, completionTokens: 1 },
      timing: { ttft: 1, completionTime: 1, tps: 1, prefillTps: 5 },
      aborted: false,
      xmlFormatError: false,
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

    const waitEvent = eventStore.append.mock.calls.find(([, event]) => event.type === 'chat.done' && (event.data as any).reason === 'waiting_for_user')
    expect(waitEvent).toBeDefined()
    expect(eventStore.append.mock.calls.some(([, event]) => event.type === 'turn.snapshot')).toBe(false)
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

    await runChatTurn({ sessionManager: sessionManager as never, sessionId: 'session-1', llmClient: { getModel: () => 'qwen3-32b' } as never })
    expect(pathErrorStore.append.mock.calls.find(([, event]) => event.type === 'chat.error')?.[1]).toMatchObject({
      data: { error: 'User denied access to files outside the project and sensitive files.', recoverable: false },
    })

    const unknownStore = createEventStore()
    getEventStoreMock.mockReturnValue(unknownStore)
    getAllInstructionsMock.mockRejectedValueOnce(new Error('boom'))

    await runChatTurn({ sessionManager: sessionManager as never, sessionId: 'session-1', llmClient: { getModel: () => 'qwen3-32b' } as never })
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
      xmlFormatError: false,
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
      xmlFormatError: false,
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
        executionState: { modifiedFiles: [] },
        messages: [{ id: 'user-1', role: 'user', content: 'Build it' }],
      },
    }
    const sessionManager = createSessionManager(state)
    const execute = vi.fn(async () => {
      state.current.criteria = [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'completed', completedAt: '2024-01-01T00:00:00.000Z' }, attempts: [] }]
      return { success: true, output: 'written', durationMs: 25, truncated: false }
    })
    getToolRegistryForModeMock.mockImplementation((mode: string) => ({
      definitions: [{ type: 'function', function: { name: mode === 'builder' ? 'write_file' : 'noop', description: 'Tool', parameters: {} } }],
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
        xmlFormatError: true,
      })
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{ id: 'call-1', name: 'write_file', arguments: { path: 'src/index.ts' } }],
        segments: [{ type: 'tool_call', toolCallId: 'call-1' }],
        usage: { promptTokens: 10, completionTokens: 4 },
        timing: { ttft: 1, completionTime: 1, tps: 4, prefillTps: 10 },
        aborted: false,
        xmlFormatError: false,
      })
      .mockResolvedValueOnce({
        content: 'done',
        toolCalls: [],
        segments: [{ type: 'text', content: 'done' }],
        usage: { promptTokens: 5, completionTokens: 2 },
        timing: { ttft: 1, completionTime: 1, tps: 2, prefillTps: 5 },
        aborted: false,
        xmlFormatError: false,
      })

    await runBuilderTurn({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
      onMessage: vi.fn(),
    }, new TurnMetrics())

    const appendedTypes = eventStore.append.mock.calls.map(([, event]) => event.type)
    expect(appendedTypes).toContain('format.retry')
    expect(appendedTypes).toContain('tool.call')
    expect(appendedTypes).toContain('tool.result')
    expect(appendedTypes).toContain('criteria.set')
    expect(appendedTypes).toContain('chat.done')
    expect(sessionManager.addModifiedFile).toHaveBeenCalledWith('session-1', 'src/index.ts')
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
        executionState: { modifiedFiles: [] },
        messages: [{ id: 'user-1', role: 'user', content: 'Build it' }],
      },
    }
    const deniedManager = createSessionManager(deniedState)
    getToolRegistryForModeMock.mockImplementation((mode: string) => ({
      definitions: [{ type: 'function', function: { name: mode === 'builder' ? 'edit_file' : 'noop', description: 'Tool', parameters: {} } }],
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
        xmlFormatError: false,
      })
      .mockResolvedValueOnce({
        content: 'done',
        toolCalls: [],
        segments: [{ type: 'text', content: 'done' }],
        usage: { promptTokens: 5, completionTokens: 2 },
        timing: { ttft: 1, completionTime: 1, tps: 2, prefillTps: 5 },
        aborted: false,
        xmlFormatError: false,
      })

    await runBuilderTurn({
      sessionManager: deniedManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
      onMessage: vi.fn(),
    }, new TurnMetrics())
    expect(deniedStore.append.mock.calls.find(([, event]) => event.type === 'tool.result')?.[1]).toMatchObject({
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
        executionState: { modifiedFiles: [] },
        messages: [{ id: 'user-1', role: 'user', content: 'Build it' }],
      },
    }
    const errorManager = createSessionManager(errorState)
    getToolRegistryForModeMock.mockImplementation((mode: string) => ({
      definitions: [{ type: 'function', function: { name: mode === 'builder' ? 'edit_file' : 'noop', description: 'Tool', parameters: {} } }],
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
      xmlFormatError: false,
    })

    await expect(runBuilderTurn({
      sessionManager: errorManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
      onMessage: vi.fn(),
    }, new TurnMetrics())).rejects.toThrow('unexpected builder failure')
  })

  it('returns error tool result when tool call has parseError', async () => {
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    getCurrentContextWindowIdMock.mockReturnValue('window-1')
    getAllInstructionsMock.mockResolvedValue({ content: '', files: [] })
    getContextMessagesMock.mockReturnValue([
      { role: 'user' as const, content: 'Do something' },
    ])
    const execute = vi.fn()
    getToolRegistryForModeMock.mockReturnValue({
      definitions: [{ type: 'function', function: { name: 'glob', description: 'Tool', parameters: {} } }],
      execute,
    })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [{
          id: 'call-1',
          name: 'glob',
          arguments: {},
          parseError: 'Unexpected token in JSON at position 1',
          rawArguments: '{bad-json',
        }],
        segments: [],
        usage: { promptTokens: 10, completionTokens: 3 },
        timing: { ttft: 1, completionTime: 1, tps: 3, prefillTps: 10 },
        aborted: false,
        xmlFormatError: false,
      })
      .mockResolvedValueOnce({
        content: 'Done',
        toolCalls: [],
        segments: [{ type: 'text', content: 'Done' }],
        usage: { promptTokens: 5, completionTokens: 2 },
        timing: { ttft: 1, completionTime: 1, tps: 2, prefillTps: 5 },
        aborted: false,
        xmlFormatError: false,
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
        executionState: { modifiedFiles: [] },
        messages: [{ id: 'user-1', role: 'user', content: 'Do something' }],
      },
    })

    await runBuilderTurn({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
      onMessage: vi.fn(),
    }, new TurnMetrics())

    // Verify tool execution was NOT called
    expect(execute).not.toHaveBeenCalled()

    // Verify tool.result event was emitted with error
    const toolResultEvent = eventStore.append.mock.calls.find(([, event]) => event.type === 'tool.result')
    expect(toolResultEvent).toBeDefined()
    const toolResultData = toolResultEvent![1].data as { toolCallId: string; result: { success: boolean; error: string } }
    expect(toolResultData.toolCallId).toBe('call-1')
    expect(toolResultData.result.success).toBe(false)
    expect(toolResultData.result.error).toContain('Failed to parse tool call arguments')
    expect(toolResultData.result.error).toContain('Unexpected token in JSON at position 1')
    expect(toolResultData.result.error).toContain('Please ensure your JSON function call arguments are valid')
  })

  it('does not inject a builder kickoff prompt for manual builder turns', async () => {
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    getCurrentContextWindowIdMock.mockReturnValue('window-1')
    getAllInstructionsMock.mockResolvedValue({ content: 'Build carefully', files: [] })
    getContextMessagesMock.mockReturnValue([
      { role: 'user' as const, content: 'Rename the helper function' },
    ])
    getToolRegistryForModeMock.mockReturnValue({ definitions: [], execute: vi.fn() })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock.mockResolvedValueOnce({
      content: 'Done',
      toolCalls: [],
      segments: [{ type: 'text', content: 'Done' }],
      usage: { promptTokens: 10, completionTokens: 3 },
      timing: { ttft: 1, completionTime: 1, tps: 3, prefillTps: 10 },
      aborted: false,
      xmlFormatError: false,
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
        executionState: { modifiedFiles: [] },
        messages: [{ id: 'user-1', role: 'user', content: 'Rename the helper function' }],
      },
    })

    await runBuilderTurn({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
    }, new TurnMetrics())

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
    getContextMessagesMock.mockReturnValue([
      { role: 'user' as const, content: 'Rename the helper function' },
    ])
    getToolRegistryForModeMock.mockReturnValue({ definitions: [], execute: vi.fn() })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock.mockResolvedValueOnce({
      content: 'Done',
      toolCalls: [],
      segments: [{ type: 'text', content: 'Done' }],
      usage: { promptTokens: 10, completionTokens: 3 },
      timing: { ttft: 1, completionTime: 1, tps: 3, prefillTps: 10 },
      aborted: false,
      xmlFormatError: false,
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
        executionState: { modifiedFiles: [] },
        messages: [{ id: 'user-1', role: 'user', content: 'Rename the helper function' }],
      },
    })

    await runBuilderTurn({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
      injectBuilderKickoff: true,
    }, new TurnMetrics())

    const kickoffEvent = eventStore.append.mock.calls.find(([, event]) => {
      if (event.type !== 'message.start') return false
      const data = event.data as { content?: string; messageKind?: string }
      return data.messageKind === 'auto-prompt' && data.content?.includes('Implement the task and make sure you fulfil')
    })

    expect(kickoffEvent).toBeDefined()
  })

  it('returns early for verifier when nothing is completed and handles full verifier loop', async () => {
    const emptyStore = createEventStore()
    getEventStoreMock.mockReturnValue(emptyStore)
    const emptyManager = createSessionManager({
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'builder',
        phase: 'verification',
        isRunning: true,
        criteria: [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'pending' }, attempts: [] }],
        executionState: { modifiedFiles: [] },
        summary: null,
        messages: [],
      },
    })

    await expect(runVerifierTurn({
      sessionManager: emptyManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
    }, new TurnMetrics())).resolves.toEqual({ allPassed: true, failed: [] })

    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    getAllInstructionsMock.mockResolvedValue({ content: 'Verify carefully', files: [] })
    const state: any = {
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'builder',
        phase: 'verification',
        isRunning: true,
        criteria: [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'completed', completedAt: '2024-01-01T00:00:00.000Z' }, attempts: [] }],
        executionState: { modifiedFiles: ['src/index.ts'] },
        summary: 'Task summary',
        messages: [],
      },
    }
    const sessionManager = createSessionManager(state)
    const execute = vi.fn(async () => {
      state.current.criteria = [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'failed', failedAt: '2024-01-01T00:00:00.000Z', reason: 'still broken' }, attempts: [] }]
      return { success: true, output: 'verification failed', durationMs: 15, truncated: false }
    })
    getToolRegistryForModeMock.mockReturnValue({ definitions: [{ type: 'function', function: { name: 'fail_criterion', description: 'Fail', parameters: {} } }], execute })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock
      .mockResolvedValueOnce({
        content: 'checking',
        toolCalls: [{ id: 'call-1', name: 'fail_criterion', arguments: { id: 'tests-pass' } }],
        segments: [],
        usage: { promptTokens: 8, completionTokens: 3 },
        timing: { ttft: 1, completionTime: 1, tps: 3, prefillTps: 8 },
        aborted: false,
        xmlFormatError: false,
      })
      .mockResolvedValueOnce({
        content: 'done',
        toolCalls: [],
        segments: [{ type: 'text', content: 'done' }],
        usage: { promptTokens: 5, completionTokens: 1 },
        timing: { ttft: 1, completionTime: 1, tps: 1, prefillTps: 5 },
        aborted: false,
        xmlFormatError: false,
      })

    const result = await runVerifierTurn({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
      onMessage: vi.fn(),
    }, new TurnMetrics())

    expect(result).toEqual({ allPassed: false, failed: [{ id: 'tests-pass', reason: 'still broken' }] })
    const types = eventStore.append.mock.calls.map(([, event]) => event.type)
    expect(types).toContain('tool.call')
    expect(types).toContain('tool.result')
    expect(types).toContain('criteria.set')
    expect(types).toContain('chat.done')
  })

  it('nudges verifier in the same context when it stops before terminalizing criteria', async () => {
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    getAllInstructionsMock.mockResolvedValue({ content: 'Verify carefully', files: [] })

    const state: any = {
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'builder',
        phase: 'verification',
        isRunning: true,
        criteria: [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'completed', completedAt: '2024-01-01T00:00:00.000Z' }, attempts: [] }],
        executionState: { modifiedFiles: ['src/index.ts'] },
        summary: 'Task summary',
        messages: [],
      },
    }
    const sessionManager = createSessionManager(state)
    const execute = vi.fn(async () => {
      state.current.criteria = [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'failed', failedAt: '2024-01-01T00:00:00.000Z', reason: 'still broken' }, attempts: [] }]
      return { success: true, output: 'verification failed', durationMs: 15, truncated: false }
    })

    getToolRegistryForModeMock.mockReturnValue({
      definitions: [{ type: 'function', function: { name: 'fail_criterion', description: 'Fail', parameters: {} } }],
      execute,
    })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock
      .mockResolvedValueOnce({
        content: 'I need to keep verifying.',
        toolCalls: [],
        segments: [{ type: 'text', content: 'I need to keep verifying.' }],
        usage: { promptTokens: 8, completionTokens: 3 },
        timing: { ttft: 1, completionTime: 1, tps: 3, prefillTps: 8 },
        aborted: false,
        xmlFormatError: false,
      })
      .mockResolvedValueOnce({
        content: 'marking failed',
        toolCalls: [{ id: 'call-1', name: 'fail_criterion', arguments: { id: 'tests-pass', reason: 'still broken' } }],
        segments: [],
        usage: { promptTokens: 6, completionTokens: 2 },
        timing: { ttft: 1, completionTime: 1, tps: 2, prefillTps: 6 },
        aborted: false,
        xmlFormatError: false,
      })
      .mockResolvedValueOnce({
        content: 'done',
        toolCalls: [],
        segments: [{ type: 'text', content: 'done' }],
        usage: { promptTokens: 5, completionTokens: 1 },
        timing: { ttft: 1, completionTime: 1, tps: 1, prefillTps: 5 },
        aborted: false,
        xmlFormatError: false,
      })

    const result = await runVerifierTurn({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
      onMessage: vi.fn(),
    }, new TurnMetrics())

    expect(result).toEqual({ allPassed: false, failed: [{ id: 'tests-pass', reason: 'still broken' }] })
    expect(execute).toHaveBeenCalledTimes(1)

    expect(streamLLMPureMock.mock.calls).toHaveLength(3)
    expect(streamLLMPureMock.mock.calls[1]?.[0]).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', content: 'I need to keep verifying.' }),
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('Use pass_criterion or fail_criterion'),
        }),
      ]),
    })

    expect(eventStore.append.mock.calls.find(([, event]) => {
      if (event.type !== 'message.start') return false
      const data = event.data as { content?: string; subAgentType?: string; messageKind?: string }
      return data.subAgentType === 'verifier'
        && data.messageKind === 'correction'
        && data.content?.includes('tests-pass') === true
    })).toBeDefined()
  })

  it('verifier continues without nudge after tool calls (tool calls are progress)', async () => {
    // After the fix: tool calls should NOT trigger nudges. The model gets to see
    // the tool results and respond naturally without being nagged.
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    getAllInstructionsMock.mockResolvedValue({ content: 'Verify carefully', files: [] })

    const state: any = {
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'builder',
        phase: 'verification',
        isRunning: true,
        criteria: [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'completed', completedAt: '2024-01-01T00:00:00.000Z' }, attempts: [] }],
        executionState: { modifiedFiles: ['src/index.ts'] },
        summary: 'Task summary',
        messages: [],
      },
    }
    const sessionManager = createSessionManager(state)
    const execute = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'read_file') {
        return { success: true, output: 'file contents', durationMs: 5, truncated: false }
      }

      if (name === 'fail_criterion') {
        const id = args['id'] as string
        // Trigger the session manager mock to update the criterion
        sessionManager.updateCriterionStatus('session-1', id, { 
          type: 'failed', 
          failedAt: '2024-01-01T00:00:00.000Z', 
          reason: 'still broken' 
        })
        return { success: true, output: 'verification failed', durationMs: 15, truncated: false }
      }

      return { success: true, output: 'verification failed', durationMs: 15, truncated: false }
    })

    getToolRegistryForModeMock.mockReturnValue({
      definitions: [
        { type: 'function', function: { name: 'read_file', description: 'Read', parameters: {} } },
        { type: 'function', function: { name: 'fail_criterion', description: 'Fail', parameters: {} } },
      ],
      execute,
    })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock
      .mockResolvedValueOnce({
        content: 'checking files',
        toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'src/index.ts' } }],
        segments: [],
        usage: { promptTokens: 8, completionTokens: 3 },
        timing: { ttft: 1, completionTime: 1, tps: 3, prefillTps: 8 },
        aborted: false,
        xmlFormatError: false,
      })
      .mockResolvedValueOnce({
        content: 'marking failed',
        toolCalls: [{ id: 'call-2', name: 'fail_criterion', arguments: { id: 'tests-pass', reason: 'still broken' } }],
        segments: [],
        usage: { promptTokens: 6, completionTokens: 2 },
        timing: { ttft: 1, completionTime: 1, tps: 2, prefillTps: 6 },
        aborted: false,
        xmlFormatError: false,
      })
      .mockResolvedValueOnce({
        content: 'done',
        toolCalls: [],
        segments: [{ type: 'text', content: 'done' }],
        usage: { promptTokens: 5, completionTokens: 1 },
        timing: { ttft: 1, completionTime: 1, tps: 1, prefillTps: 5 },
        aborted: false,
        xmlFormatError: false,
      })

    const result = await runVerifierTurn({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
      onMessage: vi.fn(),
    }, new TurnMetrics())

    expect(result).toEqual({ allPassed: false, failed: [{ id: 'tests-pass', reason: 'still broken' }] })

    // Verify NO nudge messages were sent after tool calls
    const nudgeMessages = eventStore.append.mock.calls.filter(
      ([, event]) => event.type === 'message.start' &&
        (event.data as any).messageKind === 'correction' &&
        (event.data as any).content?.includes('stopped before finalizing')
    )
    expect(nudgeMessages).toHaveLength(0)

    // The second call should NOT contain a nudge - just the tool result from the first call
    expect(streamLLMPureMock.mock.calls[1]?.[0]).toMatchObject({
      messages: expect.not.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining('Use pass_criterion or fail_criterion'),
        }),
      ]),
    })
  })

  it('nudges verifier 10 times, then exits without failing criteria', async () => {
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    getAllInstructionsMock.mockResolvedValue({ content: 'Verify carefully', files: [] })

    const state: any = {
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'builder',
        phase: 'verification',
        isRunning: true,
        criteria: [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'completed', completedAt: '2024-01-01T00:00:00.000Z' }, attempts: [] }],
        executionState: { modifiedFiles: ['src/index.ts'] },
        summary: 'Task summary',
        messages: [],
      },
    }
    const sessionManager = createSessionManager(state)

    getToolRegistryForModeMock.mockReturnValue({
      definitions: [{ type: 'function', function: { name: 'fail_criterion', description: 'Fail', parameters: {} } }],
      execute: vi.fn(),
    })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    for (let index = 0; index < 11; index++) {
      consumeStreamGeneratorMock.mockResolvedValueOnce({
        content: `stopped-${index}`,
        toolCalls: [],
        segments: [{ type: 'text', content: `stopped-${index}` }],
        usage: { promptTokens: 8, completionTokens: 1 },
        timing: { ttft: 1, completionTime: 1, tps: 1, prefillTps: 8 },
        aborted: false,
        xmlFormatError: false,
      })
    }

    const result = await runVerifierTurn({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
      onMessage: vi.fn(),
    }, new TurnMetrics())

    expect(result).toEqual({ allPassed: false, failed: [] })
    expect(sessionManager.updateCriterionStatus).not.toHaveBeenCalled()
    expect(sessionManager.addCriterionAttempt).not.toHaveBeenCalled()
    expect(streamLLMPureMock.mock.calls).toHaveLength(11)

    const nudgeMessages = eventStore.append.mock.calls.filter(
      ([, event]) => event.type === 'message.start'
        && (event.data as any).messageKind === 'correction'
        && (event.data as any).subAgentType === 'verifier'
        && (event.data as any).content?.includes('You stopped before finalizing verification.')
    )
    expect(nudgeMessages).toHaveLength(10)
  })

  it('does not nudge verifier when tool calls terminalize criteria', async () => {
    // This test verifies that the verifier does NOT get nudged when tool calls
    // actually terminalize criteria (pass_criterion/fail_criterion). Nudging should
    // only happen when tool calls don't make progress toward terminalizing criteria.
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    getAllInstructionsMock.mockResolvedValue({ content: 'Verify carefully', files: [] })

    const state: any = {
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'builder',
        phase: 'verification',
        isRunning: true,
        criteria: [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'completed', completedAt: '2024-01-01T00:00:00.000Z' }, attempts: [] }],
        executionState: { modifiedFiles: ['src/index.ts'] },
        summary: 'Task summary',
        messages: [],
      },
    }
    const sessionManager = createSessionManager(state)
    const execute = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'pass_criterion') {
        // Update criterion status to 'passed' (terminalized)
        const id = args['id'] as string
        state.current.criteria = state.current.criteria.map((c: any) => 
          c.id === id 
            ? { ...c, status: { type: 'passed', verifiedAt: '2024-01-01T00:00:00.000Z' } }
            : c
        )
        return { success: true, output: 'Criterion passed', durationMs: 5, truncated: false }
      }
      return { success: true, output: 'file contents', durationMs: 5, truncated: false }
    })

    getToolRegistryForModeMock.mockReturnValue({
      definitions: [
        { type: 'function', function: { name: 'read_file', description: 'Read', parameters: {} } },
        { type: 'function', function: { name: 'pass_criterion', description: 'Pass', parameters: {} } },
      ],
      execute,
    })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })

    // Model makes 1 information-gathering tool call, then passes the criterion
    consumeStreamGeneratorMock.mockResolvedValueOnce({
      content: 'checking',
      toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'src/index.ts' } }],
      segments: [],
      usage: { promptTokens: 8, completionTokens: 1 },
      timing: { ttft: 1, completionTime: 1, tps: 1, prefillTps: 8 },
      aborted: false,
      xmlFormatError: false,
    })
    // Passes the criterion
    consumeStreamGeneratorMock.mockResolvedValueOnce({
      content: 'verified',
      toolCalls: [{ id: 'call-pass', name: 'pass_criterion', arguments: { id: 'tests-pass', reason: 'All checks pass' } }],
      segments: [],
      usage: { promptTokens: 8, completionTokens: 1 },
      timing: { ttft: 1, completionTime: 1, tps: 1, prefillTps: 8 },
      aborted: false,
      xmlFormatError: false,
    })
    // Final response - no tool calls, all criteria terminalized
    consumeStreamGeneratorMock.mockResolvedValueOnce({
      content: 'All criteria verified',
      toolCalls: [],
      segments: [{ type: 'text', content: 'All criteria verified' }],
      usage: { promptTokens: 8, completionTokens: 1 },
      timing: { ttft: 1, completionTime: 1, tps: 1, prefillTps: 8 },
      aborted: false,
      xmlFormatError: false,
    })

    const result = await runVerifierTurn({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
      onMessage: vi.fn(),
    }, new TurnMetrics())

    // Should pass - criterion was terminalized
    expect(result).toEqual({ allPassed: true, failed: [] })
    expect(execute).toHaveBeenCalledTimes(2) // 1 read_file + 1 pass_criterion

    // Verify NO nudge messages were emitted (criteria were terminalized)
    // Filter for stall messages specifically
    const stallMessages = eventStore.append.mock.calls.filter(
      ([, event]) => event.type === 'message.start' &&
        (event.data as any).messageKind === 'correction' &&
        (event.data as any).subAgentType === 'verifier' &&
        (event.data as any).content?.includes('Verifier stopped repeatedly')
    )
    expect(stallMessages).toHaveLength(0)
  })

  it('nudges verifier that makes non-terminalizing tool calls repeatedly', async () => {
    // Exploratory tool calls should not consume the empty-stop budget.
    // Only repeated no-tool verifier stops should count toward auto-failure.
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    getAllInstructionsMock.mockResolvedValue({ content: 'Verify carefully', files: [] })

    const state: any = {
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'builder',
        phase: 'verification',
        isRunning: true,
        criteria: [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'completed', completedAt: '2024-01-01T00:00:00.000Z' }, attempts: [] }],
        executionState: { modifiedFiles: ['src/index.ts'] },
        summary: 'Task summary',
        messages: [],
      },
    }
    const sessionManager = createSessionManager(state)
    const execute = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'pass_criterion') {
        const id = args['id'] as string
        state.current.criteria = state.current.criteria.map((criterion: any) => (
          criterion.id === id
            ? { ...criterion, status: { type: 'passed', verifiedAt: '2024-01-01T00:00:00.000Z' } }
            : criterion
        ))
        return { success: true, output: 'criterion passed', durationMs: 5, truncated: false }
      }

      return { success: true, output: 'file contents', durationMs: 5, truncated: false }
    })

    getToolRegistryForModeMock.mockReturnValue({
      definitions: [
        { type: 'function', function: { name: 'read_file', description: 'Read', parameters: {} } },
        { type: 'function', function: { name: 'run_command', description: 'Run', parameters: {} } },
        { type: 'function', function: { name: 'pass_criterion', description: 'Pass', parameters: {} } },
      ],
      execute,
    })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })

    let toolCallCount = 0
    consumeStreamGeneratorMock.mockImplementation(async () => {
      toolCallCount += 1
      if (toolCallCount <= 4) {
        return {
          content: `checking-${toolCallCount}`,
          toolCalls: [{ id: `call-${toolCallCount}`, name: 'read_file', arguments: { path: 'src/index.ts' } }],
          segments: [],
          usage: { promptTokens: 8, completionTokens: 1 },
          timing: { ttft: 1, completionTime: 1, tps: 1, prefillTps: 8 },
          aborted: false,
          xmlFormatError: false,
        }
      }

      if (toolCallCount === 5) {
        return {
          content: 'still checking',
          toolCalls: [],
          segments: [{ type: 'text', content: 'still checking' }],
          usage: { promptTokens: 8, completionTokens: 1 },
          timing: { ttft: 1, completionTime: 1, tps: 1, prefillTps: 8 },
          aborted: false,
          xmlFormatError: false,
        }
      }

      if (toolCallCount === 6) {
        return {
          content: 'passing criterion',
          toolCalls: [{ id: 'call-pass', name: 'pass_criterion', arguments: { id: 'tests-pass', reason: 'verified after continued checking' } }],
          segments: [],
          usage: { promptTokens: 8, completionTokens: 1 },
          timing: { ttft: 1, completionTime: 1, tps: 1, prefillTps: 8 },
          aborted: false,
          xmlFormatError: false,
        }
      }

      // Final response after criteria are terminalized
      return {
        content: 'All criteria verified',
        toolCalls: [],
        segments: [{ type: 'text', content: 'All criteria verified' }],
        usage: { promptTokens: 8, completionTokens: 1 },
        timing: { ttft: 1, completionTime: 1, tps: 1, prefillTps: 8 },
        aborted: false,
        xmlFormatError: false,
      }
    })

    const result = await runVerifierTurn({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
      onMessage: vi.fn(),
    }, new TurnMetrics())

    expect(result).toEqual({ allPassed: true, failed: [] })
    expect(sessionManager.updateCriterionStatus).not.toHaveBeenCalledWith(
      'session-1',
      'tests-pass',
      expect.objectContaining({ type: 'failed' }),
    )

    const nudgeMessages = eventStore.append.mock.calls.filter(
      ([, event]) => event.type === 'message.start' &&
        (event.data as any).messageKind === 'correction' &&
        (event.data as any).subAgentType === 'verifier'
    )
    expect(nudgeMessages).toHaveLength(1)
    expect((nudgeMessages[0]?.[1].data as any).content).toContain('Use pass_criterion or fail_criterion')
  })

  it('fails verifier only after repeated empty stops even after exploratory tool calls', async () => {
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    getAllInstructionsMock.mockResolvedValue({ content: 'Verify carefully', files: [] })

    const state: any = {
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'builder',
        phase: 'verification',
        isRunning: true,
        criteria: [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'completed', completedAt: '2024-01-01T00:00:00.000Z' }, attempts: [] }],
        executionState: { modifiedFiles: ['src/index.ts'] },
        summary: 'Task summary',
        messages: [],
      },
    }
    const sessionManager = createSessionManager(state)
    const execute = vi.fn(async () => {
      return { success: true, output: 'file contents', durationMs: 5, truncated: false }
    })

    getToolRegistryForModeMock.mockReturnValue({
      definitions: [
        { type: 'function', function: { name: 'read_file', description: 'Read', parameters: {} } },
        { type: 'function', function: { name: 'run_command', description: 'Run', parameters: {} } },
        { type: 'function', function: { name: 'pass_criterion', description: 'Pass', parameters: {} } },
      ],
      execute,
    })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })

    let iterationCount = 0
    consumeStreamGeneratorMock.mockImplementation(async () => {
      iterationCount += 1

      if (iterationCount <= 4) {
        return {
          content: `checking-${iterationCount}`,
          toolCalls: [{ id: `call-${iterationCount}`, name: 'read_file', arguments: { path: 'src/index.ts' } }],
          segments: [],
          usage: { promptTokens: 8, completionTokens: 1 },
          timing: { ttft: 1, completionTime: 1, tps: 1, prefillTps: 8 },
          aborted: false,
          xmlFormatError: false,
        }
      }

      return {
        content: `stopped-${iterationCount}`,
        toolCalls: [],
        segments: [{ type: 'text', content: `stopped-${iterationCount}` }],
        usage: { promptTokens: 8, completionTokens: 1 },
        timing: { ttft: 1, completionTime: 1, tps: 1, prefillTps: 8 },
        aborted: false,
        xmlFormatError: false,
      }
    })

    const result = await runVerifierTurn({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
      onMessage: vi.fn(),
    }, new TurnMetrics())

    expect(result).toEqual({ allPassed: false, failed: [] })
    expect(sessionManager.updateCriterionStatus).not.toHaveBeenCalled()
    expect(sessionManager.addCriterionAttempt).not.toHaveBeenCalled()

    const correctionMessages = eventStore.append.mock.calls.filter(
      ([, event]) => event.type === 'message.start' &&
        (event.data as any).messageKind === 'correction' &&
        (event.data as any).subAgentType === 'verifier'
    )
    // 10 nudges + 1 stall restart message = 11
    expect(correctionMessages).toHaveLength(11)
  })

  it('does not consume the empty-stop budget for malformed verifier tool calls', async () => {
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    getAllInstructionsMock.mockResolvedValue({ content: 'Verify carefully', files: [] })

    const state: any = {
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'builder',
        phase: 'verification',
        isRunning: true,
        criteria: [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'completed', completedAt: '2024-01-01T00:00:00.000Z' }, attempts: [] }],
        executionState: { modifiedFiles: ['src/index.ts'] },
        summary: 'Task summary',
        messages: [],
      },
    }
    const sessionManager = createSessionManager(state)
    const execute = vi.fn()

    getToolRegistryForModeMock.mockReturnValue({
      definitions: [{ type: 'function', function: { name: 'read_file', description: 'Read', parameters: {} } }],
      execute,
    })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock.mockResolvedValueOnce({
      content: 'checking',
      toolCalls: [{
        id: 'call-1',
        name: 'read_file',
        arguments: {},
        parseError: 'Unexpected token in JSON at position 1',
        rawArguments: '{bad-json',
      }],
      segments: [],
      usage: { promptTokens: 8, completionTokens: 1 },
      timing: { ttft: 1, completionTime: 1, tps: 1, prefillTps: 8 },
      aborted: false,
      xmlFormatError: false,
    })

    for (let index = 0; index < 11; index++) {
      consumeStreamGeneratorMock.mockResolvedValueOnce({
        content: `stopped-${index}`,
        toolCalls: [],
        segments: [{ type: 'text', content: `stopped-${index}` }],
        usage: { promptTokens: 8, completionTokens: 1 },
        timing: { ttft: 1, completionTime: 1, tps: 1, prefillTps: 8 },
        aborted: false,
        xmlFormatError: false,
      })
    }

    const result = await runVerifierTurn({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
      onMessage: vi.fn(),
    }, new TurnMetrics())

    expect(result).toEqual({ allPassed: false, failed: [] })
    expect(execute).not.toHaveBeenCalled()
    expect(sessionManager.updateCriterionStatus).not.toHaveBeenCalled()
    expect(sessionManager.addCriterionAttempt).not.toHaveBeenCalled()
    expect(streamLLMPureMock.mock.calls).toHaveLength(12)
  })

  it('handles verifier path denial and nudges until verification reaches a terminal state', async () => {
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    getAllInstructionsMock.mockResolvedValue({ content: 'Verify carefully', files: [] })
    const state: any = {
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'builder',
        phase: 'verification',
        isRunning: true,
        criteria: [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'completed', completedAt: '2024-01-01T00:00:00.000Z' }, attempts: [] }],
        executionState: { modifiedFiles: ['src/index.ts'] },
        summary: 'Task summary',
        messages: [],
      },
    }
    const sessionManager = createSessionManager(state)
    const execute = vi.fn(async (name: string) => {
      if (name === 'read_file') {
        throw new PathAccessDeniedError(['/etc/passwd'], 'read_file')
      }

      state.current.criteria = [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'passed', verifiedAt: '2024-01-01T00:00:00.000Z' }, attempts: [] }]
      return { success: true, output: 'verification passed', durationMs: 10, truncated: false }
    })
    getToolRegistryForModeMock.mockReturnValue({
      definitions: [
        { type: 'function', function: { name: 'read_file', description: 'Read', parameters: {} } },
        { type: 'function', function: { name: 'pass_criterion', description: 'Pass', parameters: {} } },
      ],
      execute,
    })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock
      .mockResolvedValueOnce({
        content: 'checking',
        toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: '/etc/passwd' } }],
        segments: [],
        usage: { promptTokens: 8, completionTokens: 3 },
        timing: { ttft: 1, completionTime: 1, tps: 3, prefillTps: 8 },
        aborted: false,
        xmlFormatError: false,
      })
      .mockResolvedValueOnce({
        content: 'done',
        toolCalls: [],
        segments: [{ type: 'text', content: 'done' }],
        usage: { promptTokens: 5, completionTokens: 1 },
        timing: { ttft: 1, completionTime: 1, tps: 1, prefillTps: 5 },
        aborted: false,
        xmlFormatError: false,
      })
      .mockResolvedValueOnce({
        content: 'passing criterion',
        toolCalls: [{ id: 'call-2', name: 'pass_criterion', arguments: { id: 'tests-pass', reason: 'verified from available signals' } }],
        segments: [],
        usage: { promptTokens: 6, completionTokens: 2 },
        timing: { ttft: 1, completionTime: 1, tps: 2, prefillTps: 6 },
        aborted: false,
        xmlFormatError: false,
      })
      .mockResolvedValueOnce({
        content: 'verified',
        toolCalls: [],
        segments: [{ type: 'text', content: 'verified' }],
        usage: { promptTokens: 5, completionTokens: 1 },
        timing: { ttft: 1, completionTime: 1, tps: 1, prefillTps: 5 },
        aborted: false,
        xmlFormatError: false,
      })

    const result = await runVerifierTurn({
      sessionManager: sessionManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
      onMessage: vi.fn(),
    }, new TurnMetrics())

    expect(result).toEqual({ allPassed: true, failed: [] })
    const toolResultEvent = eventStore.append.mock.calls.find(([, event]) => event.type === 'tool.result')?.[1]
    expect(toolResultEvent).toMatchObject({
      data: {
        result: {
          success: false,
          error: 'User denied access to /etc/passwd. If you need this file, explain why and ask for permission.',
        },
      },
    })
  })

  it('throws on verifier abort and on unexpected verifier tool errors', async () => {
    const abortedStore = createEventStore()
    getEventStoreMock.mockReturnValue(abortedStore)
    getAllInstructionsMock.mockResolvedValue({ content: 'Verify carefully', files: [] })
    const abortedState: any = {
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'builder',
        phase: 'verification',
        isRunning: true,
        criteria: [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'completed', completedAt: '2024-01-01T00:00:00.000Z' }, attempts: [] }],
        executionState: { modifiedFiles: [] },
        summary: 'Task summary',
        messages: [],
      },
    }
    const abortedManager = createSessionManager(abortedState)
    getToolRegistryForModeMock.mockReturnValue({ definitions: [], execute: vi.fn() })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock.mockResolvedValueOnce({
      content: '',
      toolCalls: [],
      segments: [],
      usage: { promptTokens: 4, completionTokens: 1 },
      timing: { ttft: 1, completionTime: 1, tps: 1, prefillTps: 4 },
      aborted: true,
      xmlFormatError: false,
    })

    await expect(runVerifierTurn({
      sessionManager: abortedManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
    }, new TurnMetrics())).rejects.toThrow('Aborted')
    expect(abortedStore.append.mock.calls.find(([, event]) => event.type === 'chat.done')?.[1]).toMatchObject({ data: { reason: 'stopped' } })

    const errorStore = createEventStore()
    getEventStoreMock.mockReturnValue(errorStore)
    const errorState: any = {
      current: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project',
        mode: 'builder',
        phase: 'verification',
        isRunning: true,
        criteria: [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'completed', completedAt: '2024-01-01T00:00:00.000Z' }, attempts: [] }],
        executionState: { modifiedFiles: [] },
        summary: 'Task summary',
        messages: [],
      },
    }
    const errorManager = createSessionManager(errorState)
    getToolRegistryForModeMock.mockReturnValue({
      definitions: [{ type: 'function', function: { name: 'fail', description: 'Fail', parameters: {} } }],
      execute: vi.fn(async () => {
        throw new Error('unexpected verifier failure')
      }),
    })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock.mockResolvedValueOnce({
      content: 'checking',
      toolCalls: [{ id: 'call-1', name: 'fail', arguments: {} }],
      segments: [],
      usage: { promptTokens: 8, completionTokens: 2 },
      timing: { ttft: 1, completionTime: 1, tps: 2, prefillTps: 8 },
      aborted: false,
      xmlFormatError: false,
    })

    await expect(runVerifierTurn({
      sessionManager: errorManager as never,
      sessionId: 'session-1',
      llmClient: { getModel: () => 'qwen3-32b' } as never,
      onMessage: vi.fn(),
    }, new TurnMetrics())).rejects.toThrow('unexpected verifier failure')
  })

  describe('context window filtering', () => {
    it('planner turn uses getContextMessages to filter by current window', async () => {
      const eventStore = createEventStore()
      getEventStoreMock.mockReturnValue(eventStore)
      
      // Mock getContextMessages to return only current-window messages
      const currentWindowMessages = [
        { role: 'user' as const, content: 'Current window message' },
      ]
      getContextMessagesMock.mockReturnValue(currentWindowMessages)
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
        xmlFormatError: false,
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

      // Verify getContextMessages was called with session ID
      expect(getContextMessagesMock).toHaveBeenCalledWith('session-1')
      
      // Verify streamLLMPure merged the planner runtime reminder into the user message
      expect(streamLLMPureMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            expect.objectContaining({ role: 'user', content: expect.stringContaining('Current window message') }),
          ],
        })
      )
      expect(streamLLMPureMock.mock.calls[0]?.[0]?.messages[0]?.content).toContain('Plan mode ACTIVE')
    })

    it('builder turn uses getContextMessages to filter by current window', async () => {
      const eventStore = createEventStore()
      getEventStoreMock.mockReturnValue(eventStore)
      
      const currentWindowMessages = [
        { role: 'user' as const, content: 'Build this' },
      ]
      getContextMessagesMock.mockReturnValue(currentWindowMessages)
      getCurrentContextWindowIdMock.mockReturnValue('window-2')
      
      getAllInstructionsMock.mockResolvedValue({ content: '', files: [] })
      getToolRegistryForModeMock.mockReturnValue({ definitions: [], execute: vi.fn() })
      streamLLMPureMock.mockReturnValue({ kind: 'stream' })
      consumeStreamGeneratorMock.mockResolvedValue({
        content: 'Built',
        toolCalls: [],
        segments: [{ type: 'text', content: 'Built' }],
        usage: { promptTokens: 10, completionTokens: 5 },
        timing: { ttft: 1, completionTime: 1, tps: 5, prefillTps: 10 },
        aborted: false,
        xmlFormatError: false,
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
          executionState: { modifiedFiles: [] },
          messages: [],
        },
      })

      await runBuilderTurn({
        sessionManager: sessionManager as never,
        sessionId: 'session-1',
        llmClient: { getModel: () => 'qwen3-32b' } as never,
      }, new TurnMetrics())

      expect(getContextMessagesMock).toHaveBeenCalledWith('session-1')
      // Builder merges the runtime reminder into the triggering user turn
      expect(streamLLMPureMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            expect.objectContaining({ role: 'user', content: expect.stringContaining('Build this') }),
          ],
        })
      )
      expect(streamLLMPureMock.mock.calls[0]?.[0]?.messages[0]?.content).toContain('Build mode ACTIVE')
    })

    it('auto-compacts builder context before the next LLM call when over threshold', async () => {
      const eventStore = createEventStore()
      getEventStoreMock.mockReturnValue(eventStore)

      getContextMessagesMock.mockReturnValue([{ role: 'user' as const, content: 'Build this' }])
      getAllInstructionsMock.mockResolvedValue({ content: '', files: [] })
      getToolRegistryForModeMock.mockReturnValue({ definitions: [], execute: vi.fn() })
      streamLLMPureMock.mockReturnValue({ kind: 'stream' })
      consumeStreamGeneratorMock
        .mockResolvedValueOnce({
          content: 'Compacted summary',
          toolCalls: [],
          segments: [{ type: 'text', content: 'Compacted summary' }],
          usage: { promptTokens: 190000, completionTokens: 100 },
          timing: { ttft: 1, completionTime: 1, tps: 100, prefillTps: 190000 },
          aborted: false,
          xmlFormatError: false,
        })
        .mockResolvedValueOnce({
          content: 'Built',
          toolCalls: [],
          segments: [{ type: 'text', content: 'Built' }],
          usage: { promptTokens: 20000, completionTokens: 5 },
          timing: { ttft: 1, completionTime: 1, tps: 5, prefillTps: 20000 },
          aborted: false,
          xmlFormatError: false,
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
          executionState: { modifiedFiles: [] },
          messages: [],
        },
      })
      sessionManager.getContextState = vi.fn(() => ({
        currentTokens: 190000,
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: true,
        canCompact: true,
      }))

      await runBuilderTurn({
        sessionManager: sessionManager as never,
        sessionId: 'session-1',
        llmClient: { getModel: () => 'qwen3-32b' } as never,
      }, new TurnMetrics())

      expect(consumeStreamGeneratorMock).toHaveBeenCalledTimes(2)
      expect(streamLLMPureMock.mock.calls[0]?.[0]).toMatchObject({ toolChoice: 'none', disableThinking: true, tools: [] })
      expect(streamLLMPureMock.mock.calls[1]?.[0]).toMatchObject({ toolChoice: 'auto' })
      expect(sessionManager.compactContext).toHaveBeenCalledWith('session-1', 'Compacted summary', 190000)
    })

    it('assistant messages include contextWindowId', async () => {
      const eventStore = createEventStore()
      getEventStoreMock.mockReturnValue(eventStore)
      
      getContextMessagesMock.mockReturnValue([{ role: 'user' as const, content: 'Hello' }])
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
        xmlFormatError: false,
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
        ([, event]) => event.type === 'message.start' && (event.data as any).role === 'assistant'
      )
      
      expect(assistantStart).toBeDefined()
      expect((assistantStart![1].data as any).contextWindowId).toBe('window-123')
    })
  })
})
