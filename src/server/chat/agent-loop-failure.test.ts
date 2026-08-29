/**
 * Agent Loop – LLM Failure Handling (case 1 + case 2 retry)
 *
 * The retry loop lives HERE (around each LLM request), not in streamLLMPure:
 *   - Case 1: a request fails before any content was streamed → retry the same
 *     request with exponential backoff; nothing is written to history.
 *   - Case 2: the stream fails mid-flight → keep the partial content, append
 *     ONE visible continuation prompt, and retry against the enriched context.
 * On give-up the turn returns { failed } so the caller can offer the definitive
 * Retry — with a recorded failure for the chat.retry guard.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TurnMetrics } from './stream-pure.js'
import type { TopLevelLoopConfig } from './agent-loop.js'

vi.mock('../events/store.js', () => ({
  getEventStore: vi.fn(),
}))

vi.mock('../events/index.js', () => ({
  getCurrentContextWindowId: vi.fn(() => undefined),
  getCurrentWindowMessageOptions: vi.fn(() => undefined),
}))

vi.mock('../context/instructions.js', () => ({
  getAllInstructions: vi.fn(),
}))

vi.mock('../skills/registry.js', () => ({
  getEnabledSkillMetadata: vi.fn(),
}))

vi.mock('../runtime-config.js', () => ({
  getRuntimeConfig: vi.fn().mockReturnValue({
    mode: 'test',
    workdir: '/test',
    context: { compactionThreshold: 800000 },
    llm: {
      baseUrl: 'http://localhost:11434',
      model: 'test-model',
      timeout: 30000,
      idleTimeout: 30000,
      backend: 'ollama',
    },
  }),
}))

vi.mock('../../cli/paths.js', () => ({
  getGlobalConfigDir: vi.fn().mockReturnValue('/test/config'),
}))

vi.mock('./conversation-history.js', () => ({
  getConversationMessages: vi.fn().mockReturnValue([]),
}))

vi.mock('../context/compactor.js', () => ({
  shouldCompact: vi.fn(() => false),
  appendCompactionPrompt: vi.fn(),
}))

vi.mock('../agents/registry.js', () => ({
  loadAllAgentsDefault: vi.fn(async () => []),
  getSubAgents: vi.fn(() => []),
}))

vi.mock('../drain-queue.js', () => ({
  drainQueue: vi.fn(),
}))

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('./stream-pure.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./stream-pure.js')>()
  return {
    ...actual,
    streamLLMPure: vi.fn(),
    consumeStreamGenerator: vi.fn(),
  }
})

import { runTopLevelAgentLoop } from './agent-loop.js'
import { consumeStreamGenerator, hasRecentLLMFailure, interruptLLMRetryWait, streamLLMPure } from './stream-pure.js'

const FAST_POLICY = { backoffMs: [0, 0, 0, 0], minIntervalMs: 0, maxDurationMs: 60_000, maxAttempts: 40 }

describe('agent loop LLM failure handling', () => {
  let mockSessionManager: any
  let mockLLMClient: any
  let mockTurnMetrics: TurnMetrics

  beforeEach(async () => {
    vi.clearAllMocks()

    mockSessionManager = {
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
        maxTokens: 128000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelContext: vi.fn().mockReturnValue(128000),
      getCurrentModelSettings: vi.fn().mockReturnValue({ maxTokens: 4096 }),
      getModelCompactionThreshold: vi.fn().mockReturnValue(800000),
      setCurrentContextSize: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
    }

    mockLLMClient = { getModel: vi.fn().mockReturnValue('test-model') }
    mockTurnMetrics = {
      addToolTime: vi.fn(),
      addLLMCall: vi.fn(),
      buildStats: vi.fn().mockReturnValue({ durationMs: 0 }),
    } as unknown as TurnMetrics

    const { getAllInstructions } = await import('../context/instructions.js')
    const { getEnabledSkillMetadata } = await import('../skills/registry.js')
    ;(getAllInstructions as any).mockResolvedValue({ content: 'test instructions', files: [] })
    ;(getEnabledSkillMetadata as any).mockResolvedValue([])
  })

  function makeConfig(overrides?: Partial<TopLevelLoopConfig>): TopLevelLoopConfig {
    return {
      mode: 'planner',
      append: vi.fn(),
      sessionManager: mockSessionManager,
      sessionId: 'test-session',
      llmClient: mockLLMClient,
      statsIdentity: { providerId: 'test', providerName: 'Test', backend: 'unknown' as const, model: 'test-model' },
      assembleRequest: vi.fn().mockResolvedValue({ systemPrompt: 'sys', messages: [] }),
      getToolRegistry: () => ({ tools: [], definitions: [], execute: vi.fn() }) as any,
      getConversationMessages: vi.fn().mockResolvedValue([]),
      ...overrides,
    }
  }

  function erroredResult(error: string) {
    return {
      content: '',
      toolCalls: [],
      segments: [],
      usage: { promptTokens: 0, completionTokens: 0 },
      timing: { ttft: 0, completionTime: 0, tps: 0, prefillTps: 0 },
      aborted: false,
      modelParams: { temperature: 0, topP: 1, topK: 1, maxTokens: 4096 },
      finishReason: 'stop',
      error,
    }
  }

  function successResult(content: string) {
    return {
      content,
      toolCalls: [],
      segments: [{ type: 'text' as const, content }],
      usage: { promptTokens: 10, completionTokens: 5 },
      timing: { ttft: 1, completionTime: 1, tps: 1, prefillTps: 1 },
      aborted: false,
      modelParams: { temperature: 0, topP: 1, topK: 1, maxTokens: 4096 },
      finishReason: 'stop',
    }
  }

  const assistantStarts = (append: ReturnType<typeof vi.fn>) =>
    append.mock.calls
      .map((c: any[]) => c[0])
      .filter((e: any) => e?.type === 'message.start' && e?.data?.role === 'assistant')

  const continuationMessages = (append: ReturnType<typeof vi.fn>) =>
    append.mock.calls
      .map((c: any[]) => c[0])
      .filter(
        (e: any) =>
          e?.type === 'message.start' &&
          e?.data?.role === 'user' &&
          typeof e?.data?.content === 'string' &&
          (e.data.content as string).includes('interrupted'),
      )

  it('case 1 — retries a request that failed before any content, leaving no trace', async () => {
    ;(consumeStreamGenerator as any)
      .mockImplementationOnce(async () => erroredResult('LLM boom'))
      .mockImplementationOnce(async (_gen: any, onEvent: any) => {
        onEvent({ type: 'message.delta', data: { messageId: 'assistant-2', content: 'ok' } })
        return successResult('ok')
      })

    const append = vi.fn()
    const result = await runTopLevelAgentLoop(makeConfig({ append, llmRetryPolicy: FAST_POLICY }), mockTurnMetrics)

    expect(result.failed).toBeUndefined()
    // Two attempts, then success
    expect(consumeStreamGenerator).toHaveBeenCalledTimes(2)
    // The failed attempt created NO message (message.start deferred until first event)
    const starts = assistantStarts(append)
    expect(starts).toHaveLength(1)
    // No continuation prompt for case 1
    expect(continuationMessages(append)).toHaveLength(0)
    const chatDone = append.mock.calls.map((c: any[]) => c[0]).filter((e: any) => e.type === 'chat.done')
    expect(chatDone[chatDone.length - 1]?.data.reason).toBe('complete')
  })

  it('case 2 — keeps partial content, appends ONE continuation, then retries', async () => {
    let attempt = 0
    ;(consumeStreamGenerator as any).mockImplementation(async (_gen: any, onEvent: any) => {
      attempt += 1
      if (attempt === 1) {
        onEvent({ type: 'message.delta', data: { messageId: 'assistant-1', content: 'partial ' } })
        return erroredResult('stream died')
      }
      onEvent({ type: 'message.delta', data: { messageId: 'assistant-2', content: 'final' } })
      return successResult('final')
    })

    const append = vi.fn()
    const result = await runTopLevelAgentLoop(makeConfig({ append, llmRetryPolicy: FAST_POLICY }), mockTurnMetrics)

    expect(result.failed).toBeUndefined()
    // Partial bubble from attempt 1 is KEPT in history
    const starts = assistantStarts(append)
    expect(starts).toHaveLength(2)
    const deltaContents = append.mock.calls
      .map((c: any[]) => c[0])
      .filter((e: any) => e.type === 'message.delta')
      .map((e: any) => (e.data as { content: string }).content)
    expect(deltaContents).toEqual(['partial ', 'final'])
    // The partial bubble is finalized and exactly ONE continuation is appended
    const partialDones = append.mock.calls
      .map((c: any[]) => c[0])
      .filter((e: any) => e?.type === 'message.done' && e?.data?.partial)
    expect(partialDones).toHaveLength(1)
    expect(continuationMessages(append)).toHaveLength(1)
    const chatDone = append.mock.calls.map((c: any[]) => c[0]).filter((e: any) => e.type === 'chat.done')
    expect(chatDone[chatDone.length - 1]?.data.reason).toBe('complete')
  })

  it('appends the continuation prompt only ONCE across repeated mid-stream failures', async () => {
    let attempt = 0
    ;(consumeStreamGenerator as any).mockImplementation(async (_gen: any, onEvent: any) => {
      attempt += 1
      if (attempt < 3) {
        onEvent({ type: 'message.delta', data: { messageId: `assistant-${attempt}`, content: `part-${attempt} ` } })
        return erroredResult('died')
      }
      onEvent({ type: 'message.delta', data: { messageId: 'assistant-3', content: 'done' } })
      return successResult('done')
    })

    const append = vi.fn()
    await runTopLevelAgentLoop(makeConfig({ append, llmRetryPolicy: FAST_POLICY }), mockTurnMetrics)

    expect(consumeStreamGenerator).toHaveBeenCalledTimes(3)
    expect(continuationMessages(append)).toHaveLength(1)
    expect(assistantStarts(append)).toHaveLength(3)
  })

  it('relays the backoff pill via onMessage (retry now affordance)', async () => {
    ;(consumeStreamGenerator as any)
      .mockResolvedValueOnce(erroredResult('boom'))
      .mockResolvedValueOnce(successResult('ok'))

    const onMessage = vi.fn()
    await runTopLevelAgentLoop(makeConfig({ onMessage, llmRetryPolicy: FAST_POLICY }), mockTurnMetrics)

    const retryMsg = onMessage.mock.calls.map((c: any[]) => c[0]).find((m: any) => m?.type === 'chat.llm_retry')
    expect(retryMsg).toBeDefined()
    expect(retryMsg.payload).toEqual({ attempt: 2, retryInMs: 0, error: 'boom' })
  })

  it('gives up after the retry window and relays chat.llm_retry_failed', async () => {
    ;(consumeStreamGenerator as any).mockResolvedValue(erroredResult('rate limited'))

    const append = vi.fn()
    const onMessage = vi.fn()
    const result = await runTopLevelAgentLoop(
      makeConfig({
        append,
        onMessage,
        llmRetryPolicy: { backoffMs: [0], minIntervalMs: 0, maxDurationMs: 60_000, maxAttempts: 1 },
      }),
      mockTurnMetrics,
    )

    expect(result.failed?.error).toBe('rate limited')
    // No assistant message was ever started (nothing to finalize)
    expect(assistantStarts(append)).toHaveLength(0)
    const failedMsg = onMessage.mock.calls.map((c: any[]) => c[0]).find((m: any) => m?.type === 'chat.llm_retry_failed')
    expect(failedMsg).toBeDefined()
    expect(failedMsg.payload).toEqual({ error: 'rate limited', attempts: 1 })
  })

  it('records the definitive failure for the chat.retry guard, cleared on success', async () => {
    ;(consumeStreamGenerator as any).mockResolvedValue(erroredResult('boom'))
    await runTopLevelAgentLoop(
      makeConfig({ llmRetryPolicy: { backoffMs: [0], minIntervalMs: 0, maxDurationMs: 60_000, maxAttempts: 1 } }),
      mockTurnMetrics,
    )
    expect(hasRecentLLMFailure('test-session', 60_000)).toBe(true)

    ;(consumeStreamGenerator as any).mockResolvedValueOnce(successResult('ok'))
    await runTopLevelAgentLoop(makeConfig({ llmRetryPolicy: FAST_POLICY }), mockTurnMetrics)
    expect(hasRecentLLMFailure('test-session', 60_000)).toBe(false)
  })

  it('interrupts the backoff wait via "Retry now"', async () => {
    vi.useFakeTimers()
    ;(consumeStreamGenerator as any)
      .mockResolvedValueOnce(erroredResult('boom'))
      .mockResolvedValueOnce(successResult('ok'))

    const runPromise = runTopLevelAgentLoop(
      makeConfig({
        llmRetryPolicy: { backoffMs: [10_000], minIntervalMs: 0, maxDurationMs: 60_000, maxAttempts: 5 },
      }),
      mockTurnMetrics,
    )

    // Let the first attempt fail and the backoff timer start
    await vi.advanceTimersByTimeAsync(0)
    expect(interruptLLMRetryWait('test-session')).toBe(true)
    const result = await runPromise

    expect(result.failed).toBeUndefined()
    vi.useRealTimers()
  })

  it('does not relay retry status for sub-agent turns', async () => {
    ;(consumeStreamGenerator as any)
      .mockResolvedValueOnce(erroredResult('boom'))
      .mockResolvedValueOnce(successResult('ok'))

    const onMessage = vi.fn()
    await runTopLevelAgentLoop(
      makeConfig({ onMessage, subAgentMetadata: { subAgentId: 'sub-1', subAgentType: 'verifier' } }),
      mockTurnMetrics,
    )

    const relayed = onMessage.mock.calls.map((c: any[]) => c[0])
    expect(relayed.some((m: any) => m?.type === 'chat.llm_retry')).toBe(false)
    expect(relayed.some((m: any) => m?.type === 'chat.llm_retry_failed')).toBe(false)
  })

  it('defers the assistant message.start until the first streamed event', async () => {
    ;(consumeStreamGenerator as any).mockImplementation(async (_gen: any, onEvent: any) => {
      onEvent({ type: 'message.delta', data: { messageId: 'assistant-1', content: 'ok' } })
      return successResult('ok')
    })

    const append = vi.fn()
    const result = await runTopLevelAgentLoop(makeConfig({ append }), mockTurnMetrics)

    expect(result.failed).toBeUndefined()
    const types = append.mock.calls.map((c: any[]) => c[0]?.type) as string[]
    expect(types.filter((t) => t === 'message.start')).toHaveLength(1)
    expect(types.indexOf('message.start')).toBeLessThan(types.indexOf('message.delta'))
  })

  it('re-resolves the LLM client per retry attempt so a provider switch takes effect', async () => {
    ;(consumeStreamGenerator as any)
      .mockResolvedValueOnce(erroredResult('boom'))
      .mockResolvedValueOnce(successResult('ok'))

    const switchedClient = { getModel: vi.fn().mockReturnValue('other-model') }
    let resolverCalls = 0
    const getLLMClient = vi.fn(() => {
      resolverCalls += 1
      return resolverCalls === 1 ? mockLLMClient : switchedClient
    })

    const result = await runTopLevelAgentLoop(
      makeConfig({ getLLMClient, llmRetryPolicy: FAST_POLICY }),
      mockTurnMetrics,
    )

    expect(result.failed).toBeUndefined()
    expect(streamLLMPure).toHaveBeenCalledTimes(2)
    const clientPerAttempt = (streamLLMPure as any).mock.calls.map((c: any[]) => c[0].llmClient)
    expect(clientPerAttempt[0]).toBe(mockLLMClient)
    // The retried attempt uses the freshly resolved (switched) client
    expect(clientPerAttempt[1]).toBe(switchedClient)
  })

  it('aborts cleanly when the user stops generation mid-stream', async () => {
    ;(consumeStreamGenerator as any).mockImplementation(async (_gen: any, onEvent: any) => {
      onEvent({ type: 'message.delta', data: { messageId: 'assistant-1', content: 'partial' } })
      return {
        content: '',
        toolCalls: [],
        segments: [],
        usage: { promptTokens: 0, completionTokens: 0 },
        timing: { ttft: 0, completionTime: 0, tps: 0, prefillTps: 0 },
        aborted: true,
      }
    })

    const append = vi.fn()
    await expect(runTopLevelAgentLoop(makeConfig({ append }), mockTurnMetrics)).rejects.toThrow('Aborted')
    // Partial content preserved + finalized as stopped
    expect(assistantStarts(append)).toHaveLength(1)
    const done = append.mock.calls.map((c: any[]) => c[0]).filter((e: any) => e?.type === 'message.done')
    expect(done).toHaveLength(1)
  })
})
