import { describe, it, expect } from 'vitest'
import { computeSessionStats } from './stats.js'
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
})
