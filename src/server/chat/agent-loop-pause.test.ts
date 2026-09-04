import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ToolRegistry } from '../tools/types.js'
import type { TurnMetrics } from './stream-pure.js'
import type { EventStore } from '../events/store.js'
import type { TopLevelLoopConfig } from './agent-loop.js'

// Mock the event store module
vi.mock('../events/store.js', () => ({
  getEventStore: vi.fn(),
}))

// Mock instructions
vi.mock('../context/instructions.js', () => ({
  getAllInstructions: vi.fn(),
}))

// Mock skills
vi.mock('../skills/registry.js', () => ({
  getEnabledSkillMetadata: vi.fn(),
}))

// Mock runtime config
vi.mock('../runtime-config.js', () => ({
  getRuntimeConfig: vi.fn().mockReturnValue({
    mode: 'test',
    workdir: '/test',
    agent: { toolTimeout: 60000 },
    context: { compactionThreshold: 0.85 },
    llm: {
      baseUrl: 'http://localhost:11434',
      model: 'test-model',
      timeout: 30000,
      idleTimeout: 30000,
      backend: 'ollama',
    },
  }),
}))

// Mock paths
vi.mock('../../cli/paths.js', () => ({
  getGlobalConfigDir: vi.fn().mockReturnValue('/test/config'),
}))

// Mock conversation history
vi.mock('./conversation-history.js', () => ({
  getConversationMessages: vi.fn().mockReturnValue([]),
}))

import { consumeStreamGenerator } from './stream-pure.js'

vi.mock('./stream-pure.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./stream-pure.js')>()
  return {
    ...actual,
    streamLLMPure: vi.fn(),
    consumeStreamGenerator: vi.fn(),
  }
})

import { runTopLevelAgentLoop } from './agent-loop.js'
import { getEventStore } from '../events/store.js'
import { getAllInstructions } from '../context/instructions.js'
import { getEnabledSkillMetadata } from '../skills/registry.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function makeStreamResult(toolCalls: unknown[]): unknown {
  return {
    content: '',
    toolCalls,
    segments: [],
    usage: { promptTokens: 10, completionTokens: 5 },
    timing: { ttft: 0.1, completionTime: 0.5, tps: 10, prefillTps: 100 },
    aborted: false,
    finishReason: 'stop',
    modelParams: {},
  }
}

describe('runTopLevelAgentLoop pause gate', () => {
  let mockEventStore: EventStore
  let mockSessionManager: any
  let mockLLMClient: any
  let mockTurnMetrics: TurnMetrics
  let mockToolRegistry: ToolRegistry
  let assembleRequestMock: ReturnType<typeof vi.fn>
  let mockAppend: ReturnType<typeof vi.fn>
  let gateCallCount = 0
  let secondGateResolve: (outcome: 'released' | 'aborted') => void = () => {}
  let gateSignal: AbortSignal | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    gateCallCount = 0
    secondGateResolve = () => {}
    gateSignal = undefined

    mockEventStore = {
      append: vi.fn(),
      getEvents: vi.fn().mockReturnValue([]),
      getLatestSeq: vi.fn().mockReturnValue(0),
      cleanupOldEvents: vi.fn().mockReturnValue(0),
    } as unknown as EventStore
    ;(getEventStore as any).mockReturnValue(mockEventStore)

    mockLLMClient = {
      getModel: vi.fn().mockReturnValue('test-model'),
    }

    mockTurnMetrics = {
      addToolTime: vi.fn(),
      addLLMCall: vi.fn(),
      buildStats: vi.fn().mockReturnValue({}),
    } as unknown as TurnMetrics

    assembleRequestMock = vi.fn().mockReturnValue({
      systemPrompt: 'test-system-prompt',
      messages: [],
    })
    ;(getAllInstructions as any).mockResolvedValue({ content: 'test instructions', files: [] })
    ;(getEnabledSkillMetadata as any).mockResolvedValue([])

    mockToolRegistry = {
      tools: [],
      definitions: [],
      execute: vi.fn().mockResolvedValue({
        success: true,
        output: 'ok',
        durationMs: 0,
        truncated: false,
      }),
    } as unknown as ToolRegistry

    // Iteration 1: a tool batch, iteration 2: final answer (no tools)
    ;(consumeStreamGenerator as any)
      .mockResolvedValueOnce(makeStreamResult([{ id: 'call-1', name: 'read_file', arguments: { path: 'a.ts' } }]))
      .mockResolvedValue(makeStreamResult([]))

    mockSessionManager = {
      requireSession: vi.fn().mockReturnValue({
        workdir: '/test',
        projectId: 'test-project',
        executionState: null,
        criteria: [],
        isRunning: true,
      }),
      getEffectiveWorkdir: vi.fn().mockReturnValue('/test'),
      getProjectWorkdir: vi.fn().mockReturnValue('/test'),
      getContextState: vi.fn().mockReturnValue({
        currentTokens: 0,
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(200000),
      getCurrentModelSettings: vi.fn().mockReturnValue({}),
      getModelCompactionThreshold: vi.fn().mockReturnValue(undefined),
      setCurrentContextSize: vi.fn(),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getQueueState: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
      // Gate: first iteration passes, second blocks until resolved by the test
      enterPauseGate: vi.fn((_sessionId: string, signal?: AbortSignal) => {
        gateCallCount += 1
        if (gateCallCount === 1) return Promise.resolve('released')
        gateSignal = signal
        return new Promise<'released' | 'aborted'>((resolve) => {
          secondGateResolve = resolve
        })
      }),
    } as any
  })

  function makeConfig(overrides?: Partial<TopLevelLoopConfig>): TopLevelLoopConfig {
    mockAppend = vi.fn()
    return {
      mode: 'planner',
      append: mockAppend as any,
      sessionManager: mockSessionManager,
      sessionId: 'test-session',
      llmClient: mockLLMClient,
      statsIdentity: { providerId: 'test', providerName: 'Test', backend: 'unknown' as const, model: 'test-model' },
      assembleRequest: assembleRequestMock as any,
      getToolRegistry: () => mockToolRegistry as any,
      getConversationMessages: vi.fn().mockResolvedValue([]),
      onMessage: vi.fn(),
      ...overrides,
    }
  }

  it('pauses before the next LLM request without aborting the current one, and resumes on release', async () => {
    const loop = runTopLevelAgentLoop(makeConfig(), mockTurnMetrics)

    // The first LLM call completes, the tool batch runs, then the gate blocks
    // BEFORE the second LLM request is issued.
    await sleep(50)
    expect(gateCallCount).toBe(2)
    expect(consumeStreamGenerator).toHaveBeenCalledTimes(1)

    // Still running — the turn is paused, not finished
    const settled = await Promise.race([
      loop.then(
        () => 'settled',
        () => 'settled',
      ),
      sleep(50).then(() => 'timeout'),
    ])
    expect(settled).toBe('timeout')

    secondGateResolve('released')
    await loop

    // Resume issued the second LLM request and the turn completed normally
    expect(consumeStreamGenerator).toHaveBeenCalledTimes(2)
    const doneEvents = mockAppend.mock.calls.flat().filter((e: any) => e?.type === 'chat.done')
    expect(doneEvents.at(-1)?.data?.reason).toBe('complete')
  })

  it('aborts with "Aborted" when the session is aborted while paused', async () => {
    const controller = new AbortController()
    const loop = runTopLevelAgentLoop(makeConfig({ signal: controller.signal }), mockTurnMetrics)

    await sleep(50)
    expect(gateCallCount).toBe(2)
    expect(consumeStreamGenerator).toHaveBeenCalledTimes(1)

    // Aborting the session resolves the gate as aborted
    expect(gateSignal?.aborted).toBe(false)
    controller.abort()
    secondGateResolve('aborted')

    await expect(loop).rejects.toThrow('Aborted')
    expect(consumeStreamGenerator).toHaveBeenCalledTimes(1)
  })

  it('never aborts the in-flight LLM request when pausing (gate is checked before the request)', async () => {
    const loop = runTopLevelAgentLoop(makeConfig(), mockTurnMetrics)
    await sleep(50)

    // The first (in-flight-at-pause) request ran to completion — pause did not interrupt it
    expect(consumeStreamGenerator).toHaveBeenCalledTimes(1)
    expect((consumeStreamGenerator as any).mock.calls[0]?.[1]).toBeDefined()

    secondGateResolve('released')
    await loop
  })
})
