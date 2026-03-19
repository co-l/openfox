import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getEventStoreMock,
  getAllInstructionsMock,
  getToolRegistryForModeMock,
  createToolProgressHandlerMock,
  streamLLMPureMock,
  consumeStreamGeneratorMock,
} = vi.hoisted(() => ({
  getEventStoreMock: vi.fn(),
  getAllInstructionsMock: vi.fn(),
  getToolRegistryForModeMock: vi.fn(),
  createToolProgressHandlerMock: vi.fn(() => undefined),
  streamLLMPureMock: vi.fn(),
  consumeStreamGeneratorMock: vi.fn(),
}))

vi.mock('../events/index.js', () => ({
  getEventStore: getEventStoreMock,
}))

vi.mock('../context/instructions.js', () => ({
  getAllInstructions: getAllInstructionsMock,
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
    setCurrentContextSize: vi.fn(),
    getLspManager: vi.fn(() => ({ name: 'lsp' })),
    addModifiedFile: vi.fn((_: string, path: string) => {
      state['current'].executionState = { ...(state['current'].executionState ?? {}), modifiedFiles: [path] }
    }),
  }
}

describe('chat orchestrator', () => {
  beforeEach(() => {
    getEventStoreMock.mockReset()
    getAllInstructionsMock.mockReset()
    getToolRegistryForModeMock.mockReset()
    createToolProgressHandlerMock.mockClear()
    streamLLMPureMock.mockReset()
    consumeStreamGeneratorMock.mockReset()
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

  it('handles verifier path denial and returns success when nothing failed', async () => {
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
      throw new PathAccessDeniedError(['/etc/passwd'], 'read_file')
    })
    getToolRegistryForModeMock.mockReturnValue({ definitions: [{ type: 'function', function: { name: 'read_file', description: 'Read', parameters: {} } }], execute })
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
})
