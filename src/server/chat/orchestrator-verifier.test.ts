/**
 * Test that runVerifierTurn uses the sub-agent registry for context building
 */

import { describe, it, expect, vi } from 'vitest'

const {
  getEventStoreMock,
  getCurrentContextWindowIdMock,
  getAllInstructionsMock,
  getToolRegistryForModeMock,
  streamLLMPureMock,
  consumeStreamGeneratorMock,
  createSubAgentRegistryMock,
} = vi.hoisted(() => ({
  getEventStoreMock: vi.fn(),
  getCurrentContextWindowIdMock: vi.fn(),
  getAllInstructionsMock: vi.fn(),
  getToolRegistryForModeMock: vi.fn(),
  streamLLMPureMock: vi.fn(),
  consumeStreamGeneratorMock: vi.fn(),
  createSubAgentRegistryMock: vi.fn(),
}))

vi.mock('../events/index.js', () => ({
  getEventStore: getEventStoreMock,
  getContextMessages: vi.fn().mockReturnValue([]),
  getCurrentContextWindowId: getCurrentContextWindowIdMock,
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
  createToolProgressHandler: vi.fn(() => undefined),
}))

vi.mock('./stream-pure.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./stream-pure.js')>()
  return {
    ...actual,
    streamLLMPure: streamLLMPureMock,
    consumeStreamGenerator: consumeStreamGeneratorMock,
  }
})

vi.mock('../sub-agents/registry.js', () => ({
  createSubAgentRegistry: createSubAgentRegistryMock,
}))

import { runVerifierTurn } from './orchestrator.js'
import { TurnMetrics } from './stream-pure.js'

function createEventStore() {
  return {
    append: vi.fn((_sessionId: string, event: { type: string; data: unknown }) => ({
      seq: 1, sessionId: _sessionId, timestamp: Date.now(), ...event,
    })),
    getEvents: vi.fn().mockReturnValue([]),
    getLatestSeq: vi.fn().mockReturnValue(0),
    cleanupOldEvents: vi.fn().mockReturnValue(0),
  }
}

function createSessionManager(state: any) {
  return {
    requireSession: vi.fn(() => state.current),
    addMessage: vi.fn(),
    updateMessage: vi.fn(),
    updateMessageStats: vi.fn(),
    updateCriterionStatus: vi.fn((sessionId: string, criterionId: string, status: any) => {
      state.current.criteria = state.current.criteria.map((c: any) =>
        c.id === criterionId ? { ...c, status } : c
      )
    }),
    addCriterionAttempt: vi.fn(),
    setCurrentContextSize: vi.fn(),
    addTokensUsed: vi.fn(),
    getLspManager: vi.fn(),
  }
}

describe('runVerifierTurn - Sub-Agent Registry Integration', () => {
  it('should use sub-agent registry for context building', async () => {
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    getCurrentContextWindowIdMock.mockReturnValue(undefined)
    getAllInstructionsMock.mockResolvedValue({ content: '', files: [] })
    getToolRegistryForModeMock.mockReturnValue({ definitions: [], execute: vi.fn() })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })

    const mockCreateContext = vi.fn().mockReturnValue({
      systemPrompt: 'You are a verifier',
      injectedFiles: [],
      userMessage: 'Verify criteria',
      messages: [
        { role: 'user', content: 'Context content', source: 'runtime' },
        { role: 'user', content: 'Verify criteria', source: 'runtime' },
      ],
      tools: [],
      requestOptions: { toolChoice: 'auto', disableThinking: true },
    })

    createSubAgentRegistryMock.mockReturnValue({
      getSubAgent: vi.fn().mockReturnValue({
        id: 'verifier',
        name: 'Verifier',
        systemPrompt: 'You are a verifier',
        tools: ['read_file', 'pass_criterion'],
        createContext: mockCreateContext,
      }),
    })

    // LLM returns no tool calls - verifier is done (criteria will be nudged then stalled)
    // Need enough responses for nudges (MAX_CONSECUTIVE_VERIFIER_NUDGES = 10) + final stall = 11
    for (let i = 0; i < 11; i++) {
      consumeStreamGeneratorMock.mockResolvedValueOnce({
        content: 'All verified',
        toolCalls: [],
        segments: [{ type: 'text', content: 'All verified' }],
        usage: { promptTokens: 10, completionTokens: 5 },
        timing: { ttft: 1, completionTime: 1, tps: 5, prefillTps: 10 },
        aborted: false,
        xmlFormatError: false,
      })
    }

    const state = {
      current: {
        id: 'test-session',
        projectId: 'test-project',
        workdir: '/tmp/test',
        mode: 'builder',
        phase: 'verification',
        isRunning: true,
        summary: 'Test summary',
        messages: [],
        criteria: [{
          id: 'test-1',
          description: 'Test criterion',
          status: { type: 'completed', completedAt: new Date().toISOString() },
          attempts: [],
        }],
        executionState: { modifiedFiles: ['src/test.ts'] },
      },
    }
    const sessionManager = createSessionManager(state)

    const result = await runVerifierTurn({
      sessionManager: sessionManager as never,
      sessionId: 'test-session',
      llmClient: { getModel: () => 'test-model' } as never,
      onMessage: vi.fn(),
    }, new TurnMetrics())

    // Verify registry was used
    expect(createSubAgentRegistryMock).toHaveBeenCalled()
    expect(mockCreateContext).toHaveBeenCalled()

    // Verify result structure
    expect(result).toHaveProperty('allPassed')
    expect(result).toHaveProperty('failed')
    expect(Array.isArray(result.failed)).toBe(true)

    // Verify EventStore events were emitted (context-reset, auto-prompt, etc.)
    const eventTypes = eventStore.append.mock.calls.map(([, event]: any) => event.type)
    expect(eventTypes).toContain('message.start')
    expect(eventTypes).toContain('message.done')
  })
})
