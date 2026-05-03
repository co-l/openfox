/**
 * Test that runVerifierTurn uses the agent registry for context building
 */

import { describe, it, expect, vi } from 'vitest'

const {
  getEventStoreMock,
  getCurrentContextWindowIdMock,
  getAllInstructionsMock,
  getToolRegistryForModeMock,
  streamLLMPureMock,
  consumeStreamGeneratorMock,
} = vi.hoisted(() => ({
  getEventStoreMock: vi.fn(),
  getCurrentContextWindowIdMock: vi.fn(),
  getAllInstructionsMock: vi.fn(),
  getToolRegistryForModeMock: vi.fn(),
  streamLLMPureMock: vi.fn(),
  consumeStreamGeneratorMock: vi.fn(),
}))

vi.mock('../events/index.js', () => ({
  getEventStore: getEventStoreMock,
  getContextMessages: vi.fn().mockReturnValue([]),
  getCurrentContextWindowId: getCurrentContextWindowIdMock,
}))

vi.mock('../context/instructions.js', () => ({
  getAllInstructions: getAllInstructionsMock,
  toInjectedFiles: (files: unknown[]) => files as unknown,
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

vi.mock('../agents/registry.js', () => {
  const agents = [
    {
      metadata: {
        id: 'verifier',
        name: 'Verifier',
        description: 'Verify criteria',
        subagent: true,
        allowedTools: ['read_file', 'pass_criterion'],
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

vi.mock('../skills/registry.js', () => ({
  getEnabledSkillMetadata: vi.fn(async () => []),
}))

vi.mock('../runtime-config.js', () => ({
  getRuntimeConfig: vi.fn(() => ({ mode: 'development', context: { compactionThreshold: 0.9 } })),
}))

vi.mock('../../cli/paths.js', () => ({
  getGlobalConfigDir: vi.fn(() => '/tmp/openfox-test'),
}))

import { runVerifierTurn } from './orchestrator.js'
import { TurnMetrics } from './stream-pure.js'

function createEventStore() {
  return {
    append: vi.fn((_sessionId: string, event: { type: string; data: unknown }) => ({
      seq: 1,
      sessionId: _sessionId,
      timestamp: Date.now(),
      ...event,
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
    updateCriterionStatus: vi.fn((_sessionId: string, criterionId: string, status: any) => {
      state.current.criteria = state.current.criteria.map((c: any) => (c.id === criterionId ? { ...c, status } : c))
    }),
    addCriterionAttempt: vi.fn(),
    setCurrentContextSize: vi.fn(),
    addTokensUsed: vi.fn(),
    getLspManager: vi.fn(),
    getContextState: vi.fn(() => ({
      currentTokens: 50000,
      maxTokens: 128000,
      compactionCount: 0,
      dangerZone: false,
      canCompact: true,
    })),
    getQueueState: vi.fn(() => []),
    drainAsapMessages: vi.fn(() => []),
  }
}

describe('runVerifierTurn - Agent Registry Integration', () => {
  it('should use agent registry for sub-agent definition and build context', async () => {
    const eventStore = createEventStore()
    getEventStoreMock.mockReturnValue(eventStore)
    getCurrentContextWindowIdMock.mockReturnValue(undefined)
    getAllInstructionsMock.mockResolvedValue({ content: '', files: [] })
    getToolRegistryForModeMock.mockReturnValue({ definitions: [], execute: vi.fn() })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })

    // Need enough responses for nudges (10) + final stall + return_value nudge = 12
    for (let i = 0; i < 12; i++) {
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
        criteria: [
          {
            id: 'test-1',
            description: 'Test criterion',
            status: { type: 'completed', completedAt: new Date().toISOString() },
            attempts: [],
          },
        ],
        executionState: { modifiedFiles: ['src/test.ts'] },
      },
    }
    const sessionManager = createSessionManager(state)

    const result = await runVerifierTurn(
      {
        sessionManager: sessionManager as never,
        sessionId: 'test-session',
        llmClient: { getModel: () => 'test-model' } as never,
        onMessage: vi.fn(),
      },
      new TurnMetrics(),
    )

    // Verify result structure
    expect(result).toHaveProperty('allPassed')
    expect(result).toHaveProperty('failed')
    expect(Array.isArray(result.failed)).toBe(true)

    // Verify EventStore events were emitted (context-reset, auto-prompt, etc.)
    const eventTypes = eventStore.append.mock.calls.map(([, event]: any) => event.type)
    expect(eventTypes).toContain('message.start')
    expect(eventTypes).toContain('message.done')

    // Verify system prompt includes the agent definition's prompt body
    const systemPromptUsed = streamLLMPureMock.mock.calls[0]?.[0]?.systemPrompt as string
    expect(systemPromptUsed).toContain('You are a verifier')
  })
})
