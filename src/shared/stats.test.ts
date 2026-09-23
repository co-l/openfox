import { describe, it, expect } from 'vitest'
import { computeSessionStats, computeSessionStatsSummary, mergeLiveStats } from './stats.js'
import type { Message, MessageStats } from './types.js'

// Helper to create a message with stats
function createMessageWithStats(
  id: string,
  stats: Partial<MessageStats> & { mode: MessageStats['mode'] },
  timestamp = '2024-01-01T10:00:00Z',
): Message {
  const {
    mode,
    totalTime = 10,
    toolTime = 2,
    prefillTokens = 50000,
    prefillSpeed = 10000,
    generationTokens = 500,
    generationSpeed = 150,
    ...restStats
  } = stats

  return {
    id,
    role: 'assistant',
    content: 'test',
    timestamp,
    tokenCount: 100,
    stats: {
      providerId: 'provider-1',
      providerName: 'Local vLLM',
      backend: 'vllm',
      model: 'test-model',
      mode,
      totalTime,
      toolTime,
      prefillTokens,
      prefillSpeed,
      generationTokens,
      generationSpeed,
      ...restStats,
    },
  }
}

describe('computeSessionStats', () => {
  it('returns null for empty messages array', () => {
    const result = computeSessionStats([])
    expect(result).toBeNull()
  })

  it('returns null when no messages have stats', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'hello', timestamp: '2024-01-01T10:00:00Z', tokenCount: 10 },
      { id: '2', role: 'assistant', content: 'hi', timestamp: '2024-01-01T10:00:01Z', tokenCount: 5 },
    ]
    const result = computeSessionStats(messages)
    expect(result).toBeNull()
  })

  it('computes stats for a single message', () => {
    const messages = [
      createMessageWithStats('1', {
        mode: 'builder',
        totalTime: 10,
        toolTime: 2,
        prefillTokens: 50000,
        prefillSpeed: 10000,
        generationTokens: 500,
        generationSpeed: 150,
      }),
    ]

    const result = computeSessionStats(messages)

    expect(result).not.toBeNull()
    expect(result!.responseCount).toBe(1)
    expect(result!.totalTime).toBe(10)
    expect(result!.toolTime).toBe(2)
    expect(result!.aiTime).toBe(8) // 10 - 2
    expect(result!.prefillTokens).toBe(50000)
    expect(result!.generationTokens).toBe(500)
    expect(result!.avgPrefillSpeed).toBe(10000)
    expect(result!.avgGenerationSpeed).toBe(150)
    expect(result!.dataPoints).toHaveLength(1)
    expect(result!.dataPoints[0]).toMatchObject({
      responseIndex: 1,
      prefillTokens: 50000,
      generationTokens: 500,
      toolTime: 2,
    })
  })

  it('aggregates multiple messages correctly', () => {
    const messages = [
      createMessageWithStats(
        '1',
        {
          mode: 'planner',
          totalTime: 10,
          toolTime: 2,
          prefillTokens: 50000,
          prefillSpeed: 10000,
          generationTokens: 500,
          generationSpeed: 150,
        },
        '2024-01-01T10:00:00Z',
      ),
      createMessageWithStats(
        '2',
        {
          mode: 'builder',
          totalTime: 20,
          toolTime: 5,
          prefillTokens: 100000,
          prefillSpeed: 8000,
          generationTokens: 1000,
          generationSpeed: 120,
        },
        '2024-01-01T10:00:30Z',
      ),
    ]

    const result = computeSessionStats(messages)

    expect(result).not.toBeNull()
    expect(result!.responseCount).toBe(2)
    expect(result!.totalTime).toBe(30) // 10 + 20
    expect(result!.toolTime).toBe(7) // 2 + 5
    expect(result!.aiTime).toBe(23) // 30 - 7
    expect(result!.prefillTokens).toBe(150000) // 50000 + 100000
    expect(result!.generationTokens).toBe(1500) // 500 + 1000
    expect(result!.dataPoints).toHaveLength(2)
  })

  it('computes weighted average speeds correctly', () => {
    // Two messages with different speeds and token counts
    // Weighted average: totalTokens / totalTime
    const messages = [
      createMessageWithStats('1', {
        mode: 'builder',
        totalTime: 5, // 5 seconds total
        toolTime: 0,
        prefillTokens: 50000, // 50k in ~5s = 10k tok/s
        prefillSpeed: 10000,
        generationTokens: 500, // 500 in ~3.3s = 150 tok/s
        generationSpeed: 150,
      }),
      createMessageWithStats('2', {
        mode: 'builder',
        totalTime: 15, // 15 seconds total
        toolTime: 0,
        prefillTokens: 150000, // 150k in ~12.5s = 12k tok/s
        prefillSpeed: 12000,
        generationTokens: 1500, // 1500 in ~10s = 150 tok/s
        generationSpeed: 150,
      }),
    ]

    const result = computeSessionStats(messages)

    // Total: 200k prefill tokens, 2000 gen tokens
    // Need to compute time from tokens/speed:
    // Msg1: prefillTime = 50000/10000 = 5s, genTime = 500/150 = 3.33s
    // Msg2: prefillTime = 150000/12000 = 12.5s, genTime = 1500/150 = 10s
    // Total prefillTime = 17.5s, genTime = 13.33s
    // Weighted avg prefill: 200000 / 17.5 = 11428.6 tok/s
    // Weighted avg gen: 2000 / 13.33 = 150 tok/s

    expect(result!.prefillTokens).toBe(200000)
    expect(result!.generationTokens).toBe(2000)
    // Allow small floating point differences
    expect(result!.avgPrefillSpeed).toBeCloseTo(11428.6, 0)
    expect(result!.avgGenerationSpeed).toBeCloseTo(150, 0)
  })

  it('aggregates cache-aware prefill speeds on the same token source as the per-message speed', () => {
    // Msg1: 80k total prompt, 2k increment (78k cached) processed in 0.5s ttft -> 4000 tok/s
    // Msg2: 5k prompt, no cache info, 5k increment processed in 2.5s ttft -> 2000 tok/s
    const messages = [
      createMessageWithStats('1', {
        mode: 'builder',
        totalTime: 0.5,
        toolTime: 0,
        prefillTokens: 80000,
        prefTokenIncrement: 2000,
        prefillSpeed: 4000,
        generationTokens: 500,
        generationSpeed: 150,
      }),
      createMessageWithStats('2', {
        mode: 'builder',
        totalTime: 2.5,
        toolTime: 0,
        prefillTokens: 5000,
        prefillSpeed: 2000,
        generationTokens: 500,
        generationSpeed: 150,
      }),
    ]

    const result = computeSessionStats(messages)

    // Real compute aggregate: sum(source) / sum(ttft) = (2000 + 5000) / (0.5 + 2.5) = 7000/3 = 2333.3 tok/s
    // The old buggy aggregation recomputed time as prefillTokens/speed, giving 3777.8.
    expect(result!.avgPrefillSpeed).toBeCloseTo(2333.3, 1)
  })

  it('includes sub-agent (verifier) messages in stats', () => {
    const messages = [
      createMessageWithStats('1', { mode: 'builder' }),
      {
        ...createMessageWithStats('2', { mode: 'verifier' }),
        subAgentId: 'verifier-1',
        subAgentType: 'verifier' as const,
      },
    ]

    const result = computeSessionStats(messages)

    expect(result!.responseCount).toBe(2)
    expect(result!.dataPoints.some((dp) => dp.mode === 'verifier')).toBe(true)
  })

  it('skips messages without stats', () => {
    const messages: Message[] = [
      createMessageWithStats('1', { mode: 'builder' }),
      { id: '2', role: 'assistant', content: 'no stats', timestamp: '2024-01-01T10:00:01Z', tokenCount: 50 },
      createMessageWithStats('3', { mode: 'builder' }),
    ]

    const result = computeSessionStats(messages)

    expect(result!.responseCount).toBe(2)
    expect(result!.dataPoints).toHaveLength(2)
  })

  it('creates data points in chronological order', () => {
    const messages = [
      createMessageWithStats('1', { mode: 'planner' }, '2024-01-01T10:00:00Z'),
      createMessageWithStats('2', { mode: 'builder' }, '2024-01-01T10:01:00Z'),
      createMessageWithStats('3', { mode: 'verifier' }, '2024-01-01T10:02:00Z'),
    ]

    const result = computeSessionStats(messages)

    expect(result!.dataPoints[0]!.messageId).toBe('1')
    expect(result!.dataPoints[1]!.messageId).toBe('2')
    expect(result!.dataPoints[2]!.messageId).toBe('3')
    expect(result!.dataPoints[0]!.responseIndex).toBe(1)
    expect(result!.dataPoints[1]!.responseIndex).toBe(2)
    expect(result!.dataPoints[2]!.responseIndex).toBe(3)
    expect(result!.dataPoints[0]!.mode).toBe('planner')
    expect(result!.dataPoints[1]!.mode).toBe('builder')
    expect(result!.dataPoints[2]!.mode).toBe('verifier')
  })

  it('computes aiTime correctly for each data point', () => {
    const messages = [
      createMessageWithStats('1', {
        mode: 'builder',
        totalTime: 10,
        toolTime: 3,
      }),
    ]

    const result = computeSessionStats(messages)

    expect(result!.dataPoints[0]!.aiTime).toBe(7) // 10 - 3
    expect(result!.dataPoints[0]!.totalTime).toBe(10)
    expect(result!.dataPoints[0]!.toolTime).toBe(3)
  })

  it('handles zero tool time', () => {
    const messages = [
      createMessageWithStats('1', {
        mode: 'planner',
        totalTime: 5,
        toolTime: 0,
      }),
    ]

    const result = computeSessionStats(messages)

    expect(result!.aiTime).toBe(5)
    expect(result!.toolTime).toBe(0)
  })

  it('handles messages with zero generation tokens (prefill-only)', () => {
    const messages = [
      createMessageWithStats('1', {
        mode: 'builder',
        totalTime: 5,
        toolTime: 0,
        prefillTokens: 50000,
        prefillSpeed: 10000,
        generationTokens: 0,
        generationSpeed: 0,
      }),
    ]

    const result = computeSessionStats(messages)

    expect(result!.generationTokens).toBe(0)
    expect(result!.avgGenerationSpeed).toBe(0)
  })

  it('tracks prompt work per response instead of pretending it is context size', () => {
    const messages = [
      createMessageWithStats(
        '1',
        {
          mode: 'builder',
          prefillTokens: 12000000,
          prefillSpeed: 19500,
        },
        '2024-01-01T10:00:00Z',
      ),
      createMessageWithStats(
        '2',
        {
          mode: 'builder',
          prefillTokens: 17500,
          prefillSpeed: 2200,
        },
        '2024-01-01T10:10:00Z',
      ),
    ]

    const result = computeSessionStats(messages)

    expect(result!.dataPoints[0]).toMatchObject({
      responseIndex: 1,
      prefillTokens: 12000000,
    })
    expect(result!.dataPoints[1]).toMatchObject({
      responseIndex: 2,
      prefillTokens: 17500,
    })
    expect(result!.dataPoints[0]).not.toHaveProperty('contextTokens')
    expect(result!.dataPoints[1]).not.toHaveProperty('contextTokens')
  })

  it('flattens persisted llm call details into session-level call progression', () => {
    const messages: Message[] = [
      {
        ...createMessageWithStats('1', {
          mode: 'planner',
          totalTime: 8,
          toolTime: 1,
          prefillTokens: 120,
          generationTokens: 24,
          prefillSpeed: 20,
          generationSpeed: 6,
          llmCalls: [
            {
              providerId: 'provider-1',
              providerName: 'Local vLLM',
              backend: 'vllm',
              model: 'test-model',
              callIndex: 1,
              promptTokens: 40,
              completionTokens: 8,
              ttft: 2,
              completionTime: 1,
              prefillSpeed: 20,
              generationSpeed: 8,
              totalTime: 3,
            },
            {
              providerId: 'provider-1',
              providerName: 'Local vLLM',
              backend: 'vllm',
              model: 'test-model',
              callIndex: 2,
              promptTokens: 80,
              completionTokens: 16,
              ttft: 4,
              completionTime: 4,
              prefillSpeed: 20,
              generationSpeed: 4,
              totalTime: 8,
            },
          ],
        }),
        timestamp: '2024-01-01T10:00:00Z',
      },
      {
        ...createMessageWithStats('2', {
          mode: 'builder',
          totalTime: 4,
          toolTime: 0,
          prefillTokens: 60,
          generationTokens: 12,
          prefillSpeed: 30,
          generationSpeed: 6,
          llmCalls: [
            {
              providerId: 'provider-1',
              providerName: 'Local vLLM',
              backend: 'vllm',
              model: 'test-model',
              callIndex: 1,
              promptTokens: 60,
              completionTokens: 12,
              ttft: 2,
              completionTime: 2,
              prefillSpeed: 30,
              generationSpeed: 6,
              totalTime: 4,
            },
          ],
        }),
        timestamp: '2024-01-01T10:05:00Z',
      },
    ]

    const result = computeSessionStats(messages)

    expect(result!.llmCallCount).toBe(3)
    expect(result!.callDataPoints).toEqual([
      expect.objectContaining({
        sessionCallIndex: 1,
        responseIndex: 1,
        callIndex: 1,
        promptTokens: 40,
        completionTokens: 8,
      }),
      expect.objectContaining({
        sessionCallIndex: 2,
        responseIndex: 1,
        callIndex: 2,
        promptTokens: 80,
        completionTokens: 16,
      }),
      expect.objectContaining({
        sessionCallIndex: 3,
        responseIndex: 2,
        callIndex: 1,
        promptTokens: 60,
        completionTokens: 12,
      }),
    ])
  })

  it('preserves provider cache and context fields in full stats progression', () => {
    const messages = [
      createMessageWithStats('1', {
        mode: 'builder',
        cachedPromptTokens: 78000,
        cacheWriteTokens: 2000,
        cacheSource: 'provider',
        retryCount: 1,
        compactionCount: 2,
        llmCalls: [
          {
            providerId: 'provider-1',
            providerName: 'MiniMax',
            backend: 'openai',
            model: 'MiniMax-M3',
            callIndex: 1,
            promptTokens: 80000,
            completionTokens: 500,
            ttft: 0.5,
            completionTime: 2,
            prefillSpeed: 4000,
            generationSpeed: 250,
            totalTime: 2.5,
            cachedPromptTokens: 78000,
            cacheWriteTokens: 2000,
            cacheSource: 'provider',
            contextSize: 80000,
            retries: 1,
          },
        ],
      }),
    ]

    const result = computeSessionStats(messages)!

    expect(result.dataPoints[0]).toMatchObject({
      cachedPromptTokens: 78000,
      cacheWriteTokens: 2000,
      cacheSource: 'provider',
      retryCount: 1,
      compactionCount: 2,
    })
    expect(result.callDataPoints[0]).toMatchObject({
      promptTokens: 80000,
      cachedPromptTokens: 78000,
      cacheWriteTokens: 2000,
      cacheSource: 'provider',
      contextSize: 80000,
      retries: 1,
    })
  })

  it('skips messages with error-only stats (e.g., aborted/terminated)', () => {
    const messages: Message[] = [
      createMessageWithStats('1', { mode: 'builder' }),
      {
        id: '2',
        role: 'assistant',
        content: 'aborted',
        timestamp: '2024-01-01T10:00:01Z',
        tokenCount: 50,
        stats: { error: 'terminated' } as unknown as MessageStats,
      },
      createMessageWithStats('3', { mode: 'builder' }),
    ]

    const result = computeSessionStats(messages)

    expect(result).not.toBeNull()
    expect(result!.responseCount).toBe(2)
    expect(result!.totalTime).toBeGreaterThan(0)
    expect(result!.avgPrefillSpeed).toBeGreaterThan(0)
    expect(Number.isNaN(result!.totalTime)).toBe(false)
    expect(Number.isNaN(result!.avgPrefillSpeed)).toBe(false)
    expect(Number.isNaN(result!.avgGenerationSpeed)).toBe(false)
  })

  it('groups session stats by provider and model', () => {
    const messages = [
      createMessageWithStats('1', {
        providerId: 'provider-1',
        providerName: 'Local vLLM',
        backend: 'vllm',
        model: 'qwen-1',
        mode: 'planner',
        totalTime: 8,
        prefillTokens: 800,
        generationTokens: 80,
      }),
      createMessageWithStats('2', {
        providerId: 'provider-2',
        providerName: 'Anthropic',
        backend: 'anthropic',
        model: 'claude-1',
        mode: 'builder',
        totalTime: 12,
        prefillTokens: 1200,
        generationTokens: 120,
      }),
    ]

    const result = computeSessionStats(messages)

    expect(result!.modelGroups).toHaveLength(2)
    expect(result!.modelGroups[0]).toMatchObject({
      key: 'provider-1::qwen-1',
      label: 'Local vLLM > qwen-1',
      providerId: 'provider-1',
      providerName: 'Local vLLM',
      model: 'qwen-1',
      responseCount: 1,
    })
    expect(result!.modelGroups[1]).toMatchObject({
      key: 'provider-2::claude-1',
      label: 'Anthropic > claude-1',
      providerId: 'provider-2',
      providerName: 'Anthropic',
      model: 'claude-1',
      responseCount: 1,
    })
  })

  it('groups session stats by agent and sub-agent', () => {
    const messages: Message[] = [
      createMessageWithStats('1', {
        mode: 'builder',
        totalTime: 10,
        toolTime: 2,
        prefillTokens: 2000,
        generationTokens: 200,
        prefillSpeed: 1000,
        generationSpeed: 100,
      }),
      {
        ...createMessageWithStats('2', {
          mode: 'code_reviewer',
          totalTime: 5,
          toolTime: 1,
          prefillTokens: 4000,
          generationTokens: 150,
          prefillSpeed: 2000,
          generationSpeed: 150,
        }),
        subAgentId: 'reviewer-run-1',
        subAgentType: 'code_reviewer',
      },
      {
        ...createMessageWithStats('3', {
          mode: 'verifier',
          totalTime: 4,
          toolTime: 0.5,
          prefillTokens: 3000,
          generationTokens: 100,
          prefillSpeed: 1500,
          generationSpeed: 100,
        }),
        subAgentId: 'verifier-run-1',
        subAgentType: 'verifier',
      },
    ]

    const result = computeSessionStats(messages)
    expect(result).not.toBeNull()
    expect(result!.agentGroups).toHaveLength(3)

    expect(result!.agentGroups[0]).toMatchObject({
      agentId: 'builder',
      isSubAgent: false,
      responseCount: 1,
      totalTime: 10,
      aiTime: 8,
      toolTime: 2,
      prefillTokens: 2000,
      generationTokens: 200,
    })

    expect(result!.agentGroups[1]).toMatchObject({
      agentId: 'code_reviewer',
      isSubAgent: true,
      responseCount: 1,
      totalTime: 5,
      aiTime: 4,
      toolTime: 1,
      prefillTokens: 4000,
      generationTokens: 150,
    })

    expect(result!.agentGroups[2]).toMatchObject({
      agentId: 'verifier',
      isSubAgent: true,
      responseCount: 1,
      totalTime: 4,
      aiTime: 3.5,
      toolTime: 0.5,
      prefillTokens: 3000,
      generationTokens: 100,
    })
  })
})

describe('computeSessionStatsSummary', () => {
  it('returns null for empty or stat-less input', () => {
    expect(computeSessionStatsSummary([])).toBeNull()
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'hello', timestamp: '2024-01-01T10:00:00Z', tokenCount: 10 },
    ]
    expect(computeSessionStatsSummary(messages)).toBeNull()
  })

  it('computes the same headline aggregates as computeSessionStats', () => {
    const messages = [
      createMessageWithStats('1', {
        mode: 'planner',
        totalTime: 10,
        toolTime: 2,
        prefillTokens: 50000,
        prefillSpeed: 10000,
        generationTokens: 500,
        generationSpeed: 150,
      }),
      createMessageWithStats(
        '2',
        {
          mode: 'builder',
          totalTime: 20,
          toolTime: 5,
          prefillTokens: 100000,
          prefillSpeed: 8000,
          generationTokens: 1000,
          generationSpeed: 120,
        },
        '2024-01-01T10:00:30Z',
      ),
    ]

    const summary = computeSessionStatsSummary(messages)
    const full = computeSessionStats(messages)

    expect(summary).not.toBeNull()
    expect(summary!.totalTime).toBe(full!.totalTime)
    expect(summary!.aiTime).toBe(full!.aiTime)
    expect(summary!.toolTime).toBe(full!.toolTime)
    expect(summary!.prefillTokens).toBe(full!.prefillTokens)
    expect(summary!.generationTokens).toBe(full!.generationTokens)
    expect(summary!.avgPrefillSpeed).toBe(full!.avgPrefillSpeed)
    expect(summary!.avgGenerationSpeed).toBe(full!.avgGenerationSpeed)
    expect(summary!.responseCount).toBe(2)
    expect(summary!.llmCallCount).toBe(full!.llmCallCount)
    // Summary never carries the discrete progression arrays
    expect(summary).not.toHaveProperty('dataPoints')
    expect(summary).not.toHaveProperty('callDataPoints')
    // Accumulators match the weighted-average math: prefill (50000/10000 +
    // 100000/8000) seconds, gen (500/150 + 1000/120) seconds
    expect(summary!.totalPrefillSource).toBe(150000)
    expect(summary!.totalPrefillTime).toBeCloseTo(17.5, 1)
    expect(summary!.totalGenTime).toBeCloseTo(500 / 150 + 1000 / 120, 4)
  })

  it('uses prefTokenIncrement as the prefill source like the full stats', () => {
    const messages = [
      createMessageWithStats('1', {
        mode: 'builder',
        totalTime: 0.5,
        toolTime: 0,
        prefillTokens: 80000,
        prefTokenIncrement: 2000,
        prefillSpeed: 4000,
        generationTokens: 500,
        generationSpeed: 150,
      }),
    ]

    const summary = computeSessionStatsSummary(messages)

    expect(summary!.avgPrefillSpeed).toBe(4000)
    expect(summary!.totalPrefillSource).toBe(2000)
    expect(summary!.totalPrefillTime).toBeCloseTo(0.5, 3)
  })

  it('groups by model with per-group accumulators', () => {
    const messages = [
      createMessageWithStats('1', {
        mode: 'builder',
        totalTime: 10,
        toolTime: 2,
        prefillTokens: 50000,
        prefillSpeed: 10000,
        generationTokens: 500,
        generationSpeed: 150,
      }),
    ]
    const summary = computeSessionStatsSummary(messages)

    expect(summary!.modelGroups).toHaveLength(1)
    expect(summary!.modelGroups[0]).toMatchObject({
      key: 'provider-1::test-model',
      providerId: 'provider-1',
      providerName: 'Local vLLM',
      model: 'test-model',
      responseCount: 1,
      llmCallCount: 0,
    })
    expect(summary!.modelGroups[0]!.totalPrefillSource).toBe(50000)
  })
})

describe('mergeLiveStats', () => {
  const live: MessageStats = {
    providerId: 'provider-1',
    providerName: 'Local vLLM',
    backend: 'vllm',
    model: 'test-model',
    mode: 'builder',
    totalTime: 5,
    toolTime: 1,
    prefillTokens: 20000,
    prefillSpeed: 20000,
    generationTokens: 200,
    generationSpeed: 100,
  }

  it('adds the live response on top of a base summary exactly', () => {
    const base = computeSessionStatsSummary([
      createMessageWithStats('1', {
        mode: 'builder',
        totalTime: 10,
        toolTime: 2,
        prefillTokens: 50000,
        prefillSpeed: 10000,
        generationTokens: 500,
        generationSpeed: 150,
      }),
    ])!

    const merged = mergeLiveStats(base, live)

    expect(merged.responseCount).toBe(2)
    expect(merged.totalTime).toBe(15)
    expect(merged.toolTime).toBe(3)
    expect(merged.aiTime).toBe(12)
    expect(merged.prefillTokens).toBe(70000)
    expect(merged.generationTokens).toBe(700)
    expect(merged.llmCallCount).toBe(0)
    // Weighted: prefill (50000 + 20000) / (5 + 1) = 11666.7 tok/s
    expect(merged.avgPrefillSpeed).toBeCloseTo(11666.7, 0)
    // Gen: 700 / (500/150 + 200/100) = 700 / 5.333 = 131.2 tok/s
    expect(merged.avgGenerationSpeed).toBeCloseTo(131.2, 0)
    // Accumulators stay mergeable for the next live delta
    expect(merged.totalPrefillSource).toBeCloseTo(70000, 0)
    expect(merged.totalPrefillTime).toBeCloseTo(6, 1)
    // The matching model group is updated too
    expect(merged.modelGroups[0]!.responseCount).toBe(2)
    expect(merged.modelGroups[0]!.totalTime).toBe(15)
  })

  it('builds a summary from the live response alone when there is no base', () => {
    const merged = mergeLiveStats(null, live)

    expect(merged.responseCount).toBe(1)
    expect(merged.totalTime).toBe(5)
    expect(merged.aiTime).toBe(4)
    expect(merged.avgPrefillSpeed).toBe(20000)
    expect(merged.modelGroups).toHaveLength(1)
    expect(merged.modelGroups[0]!.model).toBe('test-model')
  })

  it('adds a new model group when the live response uses an unseen model', () => {
    const base = computeSessionStatsSummary([
      createMessageWithStats('1', {
        mode: 'builder',
        totalTime: 10,
        toolTime: 2,
        prefillTokens: 50000,
        prefillSpeed: 10000,
        generationTokens: 500,
        generationSpeed: 150,
      }),
    ])!
    const otherLive: MessageStats = { ...live, model: 'other-model', providerName: 'Other' }

    const merged = mergeLiveStats(base, otherLive)

    expect(merged.modelGroups).toHaveLength(2)
    const other = merged.modelGroups.find((g) => g.model === 'other-model')!
    expect(other.responseCount).toBe(1)
    expect(other.totalTime).toBe(5)
    // Base group untouched
    const baseGroup = merged.modelGroups.find((g) => g.model === 'test-model')!
    expect(baseGroup.responseCount).toBe(1)
  })

  it('counts live llm calls in the aggregate', () => {
    const base = computeSessionStatsSummary([
      createMessageWithStats('1', {
        mode: 'builder',
        totalTime: 10,
        toolTime: 2,
        prefillTokens: 50000,
        prefillSpeed: 10000,
        generationTokens: 500,
        generationSpeed: 150,
      }),
    ])!
    const liveWithCalls: MessageStats = {
      ...live,
      llmCalls: [
        {
          providerId: 'provider-1',
          providerName: 'Local vLLM',
          backend: 'vllm',
          model: 'test-model',
          callIndex: 0,
          promptTokens: 100,
          completionTokens: 10,
          ttft: 0.1,
          completionTime: 0.5,
          prefillSpeed: 1000,
          generationSpeed: 50,
          totalTime: 0.6,
        },
        {
          providerId: 'provider-1',
          providerName: 'Local vLLM',
          backend: 'vllm',
          model: 'test-model',
          callIndex: 1,
          promptTokens: 50,
          completionTokens: 5,
          ttft: 0.05,
          completionTime: 0.25,
          prefillSpeed: 1000,
          generationSpeed: 50,
          totalTime: 0.3,
        },
      ],
    }

    const merged = mergeLiveStats(base, liveWithCalls)

    expect(merged.llmCallCount).toBe(2)
    expect(merged.modelGroups[0]!.llmCallCount).toBe(2)
  })
})
