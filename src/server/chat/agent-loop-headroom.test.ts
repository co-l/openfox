import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runTopLevelAgentLoop } from './agent-loop.js'
import * as headroom from '../headroom/index.js'
import type { SessionManager } from '../session/index.js'
import type { EventStore } from '../events/store.js'
import { getEventStore } from '../events/store.js'
import { getAllInstructions } from '../context/instructions.js'
import { getEnabledSkillMetadata } from '../skills/registry.js'
import { streamLLMPure, consumeStreamGenerator, TurnMetrics } from './stream-pure.js'

vi.mock('../events/store.js', () => ({
  getEventStore: vi.fn(),
}))
vi.mock('../context/instructions.js', () => ({
  getAllInstructions: vi.fn(),
}))
vi.mock('../skills/registry.js', () => ({
  getEnabledSkillMetadata: vi.fn(),
}))
vi.mock('../../cli/paths.js', () => ({
  getGlobalConfigDir: vi.fn().mockReturnValue('/test/config'),
}))
vi.mock('../runtime-config.js', () => ({
  getRuntimeConfig: vi.fn().mockReturnValue({ mode: 'test' }),
}))
vi.mock('../agents/registry.js', () => ({
  loadAllAgentsDefault: vi.fn().mockResolvedValue([]),
  getSubAgents: vi.fn().mockReturnValue([]),
}))

vi.mock('./stream-pure.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./stream-pure.js')>()
  return {
    ...actual,
    streamLLMPure: vi.fn(),
    consumeStreamGenerator: vi.fn(),
  }
})

describe('runTopLevelAgentLoop with Headroom compression', () => {
  let mockEventStore: EventStore
  let mockSessionManager: SessionManager
  let mockLLMClient: any
  let mockTurnMetrics: TurnMetrics

  beforeEach(() => {
    vi.clearAllMocks()

    mockEventStore = {
      append: vi.fn(),
      getEvents: vi.fn().mockReturnValue([]),
      getLatestSeq: vi.fn().mockReturnValue(0),
      cleanupOldEvents: vi.fn().mockReturnValue(0),
    } as unknown as EventStore
    ;(getEventStore as any).mockReturnValue(mockEventStore)

    mockLLMClient = {
      getModel: vi.fn().mockReturnValue('gpt-4o'),
    }

    mockTurnMetrics = {
      addToolTime: vi.fn(),
      addLLMCall: vi.fn(),
      addHeadroomSaved: vi.fn(),
      setRtkTokensSaved: vi.fn(),
      buildStats: vi.fn().mockReturnValue({}),
    } as unknown as TurnMetrics

    mockSessionManager = {
      enterPauseGate: vi.fn().mockResolvedValue('released'),
      requireSession: vi.fn().mockReturnValue({
        workdir: '/test',
        projectId: 'test-project',
        executionState: null,
        criteria: [],
        isRunning: false,
      }),
      getEffectiveWorkdir: vi.fn().mockReturnValue('/test'),
      getProjectWorkdir: vi.fn().mockReturnValue('/test'),
      getContextState: vi.fn().mockReturnValue({
        currentTokens: 0,
        maxTokens: 200000,
        compactionCount: 0,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(128000),
      getCurrentModelSettings: vi.fn().mockReturnValue(undefined),
      getModelCompactionThreshold: vi.fn().mockReturnValue(0.85),
      setCurrentContextSize: vi.fn(),
      drainAsapMessages: vi.fn().mockReturnValue([]),
    } as unknown as SessionManager

    ;(getAllInstructions as any).mockResolvedValue({ content: '', files: [] })
    ;(getEnabledSkillMetadata as any).mockResolvedValue([])
    ;(streamLLMPure as any).mockReturnValue(
      (async function* () {
        yield { type: 'chat.done', data: {} }
      })(),
    )
    ;(consumeStreamGenerator as any).mockResolvedValue({
      toolCalls: [],
      error: undefined,
      usage: { promptTokens: 50, completionTokens: 20 },
      timing: { durationMs: 10, firstChunkDurationMs: 5 },
      modelParams: {},
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('compresses messages when Headroom is enabled', async () => {
    const isHeadroomEnabledSpy = vi.spyOn(headroom, 'isHeadroomEnabled').mockReturnValue(true)
    const compressSpy = vi.spyOn(headroom, 'compressMessagesWithHeadroom').mockResolvedValue({
      messages: [{ role: 'user', content: 'compressed prompt' }],
      tokensBefore: 200,
      tokensAfter: 50,
      tokensSaved: 150,
      compressionRatio: 0.25,
      transformsApplied: ['smart_crusher'],
      compressed: true,
    })

    const assembleRequestMock = vi.fn().mockResolvedValue({
      systemPrompt: 'system prompt',
      messages: [{ role: 'user', content: 'original uncompressed prompt' }],
      tools: [],
    })

    await runTopLevelAgentLoop(
      {
        mode: 'builder',
        append: vi.fn(),
        sessionManager: mockSessionManager,
        sessionId: 'test-session',
        llmClient: mockLLMClient,
        statsIdentity: { providerId: 'test', providerName: 'Test', backend: 'unknown' as const, model: 'gpt-4o' },
        assembleRequest: assembleRequestMock as any,
        getToolRegistry: () => ({ tools: [], definitions: [], execute: vi.fn() }) as any,
        getConversationMessages: vi.fn().mockResolvedValue([]),
      },
      mockTurnMetrics,
    )

    expect(isHeadroomEnabledSpy).toHaveBeenCalled()
    expect(compressSpy).toHaveBeenCalledWith({
      messages: [{ role: 'user', content: 'original uncompressed prompt' }],
      model: 'gpt-4o',
    })

    expect(streamLLMPure).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'compressed prompt' }],
      }),
    )
  })

  it('passes uncompressed messages when Headroom is disabled', async () => {
    vi.spyOn(headroom, 'isHeadroomEnabled').mockReturnValue(false)
    const compressSpy = vi.spyOn(headroom, 'compressMessagesWithHeadroom')

    const assembleRequestMock = vi.fn().mockResolvedValue({
      systemPrompt: 'system prompt',
      messages: [{ role: 'user', content: 'original uncompressed prompt' }],
      tools: [],
    })

    await runTopLevelAgentLoop(
      {
        mode: 'builder',
        append: vi.fn(),
        sessionManager: mockSessionManager,
        sessionId: 'test-session',
        llmClient: mockLLMClient,
        statsIdentity: { providerId: 'test', providerName: 'Test', backend: 'unknown' as const, model: 'gpt-4o' },
        assembleRequest: assembleRequestMock as any,
        getToolRegistry: () => ({ tools: [], definitions: [], execute: vi.fn() }) as any,
        getConversationMessages: vi.fn().mockResolvedValue([]),
      },
      mockTurnMetrics,
    )

    expect(compressSpy).not.toHaveBeenCalled()
    expect(streamLLMPure).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'original uncompressed prompt' }],
      }),
    )
  })

  it('records the Headroom savings on the turn stats', async () => {
    vi.spyOn(headroom, 'isHeadroomEnabled').mockReturnValue(true)
    vi.spyOn(headroom, 'compressMessagesWithHeadroom').mockResolvedValue({
      messages: [{ role: 'user', content: 'compressed prompt' }],
      tokensBefore: 200,
      tokensAfter: 50,
      tokensSaved: 150,
      compressionRatio: 0.25,
      transformsApplied: [],
      compressed: true,
    })
    ;(consumeStreamGenerator as any).mockResolvedValue({
      toolCalls: [],
      error: undefined,
      usage: { promptTokens: 50, completionTokens: 20 },
      timing: { ttft: 5, completionTime: 10, tps: 0, prefillTps: 0 },
      modelParams: {},
    })

    const assembleRequestMock = vi.fn().mockResolvedValue({
      systemPrompt: 'system prompt',
      messages: [{ role: 'user', content: 'original uncompressed prompt' }],
      tools: [],
    })
    const append = vi.fn()

    await runTopLevelAgentLoop(
      {
        mode: 'builder',
        append,
        sessionManager: mockSessionManager,
        sessionId: 'test-session',
        llmClient: mockLLMClient,
        statsIdentity: { providerId: 'test', providerName: 'Test', backend: 'unknown' as const, model: 'gpt-4o' },
        assembleRequest: assembleRequestMock as any,
        getToolRegistry: () => ({ tools: [], definitions: [], execute: vi.fn() }) as any,
        getConversationMessages: vi.fn().mockResolvedValue([]),
      },
      new TurnMetrics(),
    )

    const doneEvent = append.mock.calls.map((call: any[]) => call[0]).find((event: any) => event?.type === 'chat.done')
    expect(doneEvent?.data?.stats?.headroomTokensSaved).toBe(150)
  })
})
