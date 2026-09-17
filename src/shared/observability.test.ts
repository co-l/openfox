import { describe, it, expect } from 'vitest'
import { computeObservability } from './observability.js'
import type { Message, MessageStats, LLMCallStats } from './types.js'

function makeCall(overrides: Partial<LLMCallStats> = {}): LLMCallStats {
  return {
    providerId: 'p1',
    providerName: 'Local',
    backend: 'vllm',
    model: 'm',
    callIndex: 1,
    promptTokens: 1000,
    completionTokens: 50,
    ttft: 0.1,
    completionTime: 0.5,
    prefillSpeed: 10000,
    generationSpeed: 100,
    totalTime: 0.6,
    ...overrides,
  }
}

function makeStats(overrides: Partial<MessageStats> = {}): MessageStats {
  return {
    providerId: 'p1',
    providerName: 'Local',
    backend: 'vllm',
    model: 'm',
    mode: 'planner',
    totalTime: 5,
    toolTime: 1,
    prefillTokens: 1000,
    prefillSpeed: 10000,
    generationTokens: 50,
    generationSpeed: 100,
    ...overrides,
  }
}

function makeMessage(id: string, stats: MessageStats, timestamp: string): Message {
  return {
    id,
    role: 'assistant',
    content: 'ok',
    timestamp,
    stats,
  }
}

function makeEvent(
  type: string,
  data: Record<string, unknown>,
  timestamp = 0,
): { type: string; data: Record<string, unknown>; timestamp: number } {
  return { type, data, timestamp }
}

describe('computeObservability', () => {
  it('returns null for empty messages', () => {
    expect(computeObservability([], [])).toBeNull()
  })

  it('returns null when no messages have stats', () => {
    const messages: Message[] = [{ id: 'm1', role: 'assistant', content: 'ok', timestamp: '2024-01-01T00:00:00Z' }]
    expect(computeObservability(messages, [])).toBeNull()
  })

  it('builds summary with provider cache hit ratio when cacheSource=provider', () => {
    const stats = makeStats({
      prefillTokens: 1000,
      cachedPromptTokens: 800,
      cacheSource: 'provider',
      llmCalls: [makeCall({ promptTokens: 1000, cachedPromptTokens: 800, cacheSource: 'provider' })],
    })
    const messages = [makeMessage('m1', stats, '2024-01-01T00:00:00Z')]
    const result = computeObservability(messages, [], { sessionId: 's1' })
    expect(result).not.toBeNull()
    expect(result!.summary.cacheSource).toBe('provider')
    expect(result!.summary.providerCachedTokens).toBe(800)
    expect(result!.summary.rawPromptTokens).toBe(1000)
    expect(result!.summary.providerCacheHitRatio).toBeCloseTo(0.8, 5)
    expect(result!.summary.contextAmplificationFactor).toBeCloseTo(5, 5) // 1000 / (1000-800)
    expect(result!.summary.amplificationSource).toBe('provider')
  })

  it('marks cacheSource as unavailable when no cache data is provided', () => {
    const stats = makeStats({ prefillTokens: 500, llmCalls: [makeCall({ promptTokens: 500 })] })
    const messages = [makeMessage('m1', stats, '2024-01-01T00:00:00Z')]
    const result = computeObservability(messages, [])
    expect(result).not.toBeNull()
    expect(result!.summary.cacheSource).toBe('unavailable')
    expect(result!.summary.providerCacheHitRatio).toBeUndefined()
    expect(result!.summary.contextAmplificationFactor).toBeUndefined()
  })

  it('aggregates compactions from context.compacted events', () => {
    const stats = makeStats({ prefillTokens: 1000, llmCalls: [makeCall({ promptTokens: 1000 })] })
    const messages = [makeMessage('m1', stats, '2024-01-01T00:00:00Z')]
    const events = [
      makeEvent(
        'context.compacted',
        { closedWindowId: 'w1', newWindowId: 'w2', beforeTokens: 175000, afterTokens: 0, summary: 's' },
        Date.parse('2024-01-01T00:01:00Z'),
      ),
    ]
    const result = computeObservability(messages, events)
    expect(result).not.toBeNull()
    expect(result!.compactions).toHaveLength(1)
    expect(result!.compactions[0]).toMatchObject({
      beforeTokens: 175000,
      afterTokens: 0,
      reduction: 175000,
      reductionPercent: 100,
    })
    expect(result!.summary.compactions).toBe(1)
  })

  it('aggregates retries from pattern.retry events', () => {
    const stats = makeStats({ prefillTokens: 100, llmCalls: [makeCall({ promptTokens: 100 })] })
    const messages = [makeMessage('m1', stats, '2024-01-01T00:00:00Z')]
    const events = [
      makeEvent(
        'pattern.retry',
        { pattern: '<tool_call', field: 'content', attempt: 1, maxAttempts: 10, messageId: 'm1' },
        Date.parse('2024-01-01T00:01:00Z'),
      ),
    ]
    const result = computeObservability(messages, events)
    expect(result).not.toBeNull()
    expect(result!.retries.length).toBeGreaterThan(0)
    expect(result!.retries[0]).toMatchObject({ type: 'pattern', pattern: '<tool_call' })
  })

  it('aggregates tool activity from tool.call + tool.result events', () => {
    const stats = makeStats({ prefillTokens: 100, llmCalls: [makeCall({ promptTokens: 100 })] })
    const messages = [makeMessage('m1', stats, '2024-01-01T00:00:00Z')]
    const events = [
      makeEvent('message.start', { messageId: 'm1' }, 0),
      makeEvent('message.done', { messageId: 'm1' }, 1),
      makeEvent('tool.call', { messageId: 'm1', toolCall: { id: 'tc1', name: 'read_file' } }, 2),
      makeEvent('tool.result', { messageId: 'm1', toolCallId: 'tc1', result: { success: true, durationMs: 12 } }, 3),
      makeEvent('tool.call', { messageId: 'm1', toolCall: { id: 'tc2', name: 'run_command' } }, 4),
      makeEvent(
        'tool.result',
        { messageId: 'm1', toolCallId: 'tc2', result: { success: false, durationMs: 8, error: 'x' } },
        5,
      ),
    ]
    const result = computeObservability(messages, events)
    expect(result).not.toBeNull()
    expect(result!.toolActivity.totalCount).toBe(2)
    expect(result!.toolActivity.totalErrors).toBe(1)
    expect(result!.toolActivity.byCategory.read).toBe(1)
    expect(result!.toolActivity.byCategory.shell).toBe(1)
  })

  it('groups multi-model sessions into modelBreakdown', () => {
    const a = makeStats({
      providerId: 'p1',
      providerName: 'Local',
      model: 'm1',
      prefillTokens: 100,
      llmCalls: [makeCall({ providerId: 'p1', model: 'm1', promptTokens: 100 })],
    })
    const b = makeStats({
      providerId: 'p2',
      providerName: 'Cloud',
      model: 'm2',
      prefillTokens: 200,
      llmCalls: [makeCall({ providerId: 'p2', providerName: 'Cloud', model: 'm2', promptTokens: 200 })],
    })
    const messages = [makeMessage('m1', a, '2024-01-01T00:00:00Z'), makeMessage('m2', b, '2024-01-01T00:01:00Z')]
    const result = computeObservability(messages, [])
    expect(result).not.toBeNull()
    expect(result!.modelBreakdown).toHaveLength(2)
    const labels = result!.modelBreakdown.map((mb) => mb.label).sort()
    expect(labels).toEqual(['Cloud > m2', 'Local > m1'])
  })

  it('handles legacy sessions without new stats fields', () => {
    // Legacy MessageStats with no retryCount, no cacheSource, no llmCalls
    const legacy: MessageStats = {
      providerId: 'p1',
      providerName: 'Local',
      backend: 'vllm',
      model: 'm',
      mode: 'planner',
      totalTime: 5,
      toolTime: 0,
      prefillTokens: 100,
      prefillSpeed: 50,
      generationTokens: 10,
      generationSpeed: 100,
    }
    const messages = [makeMessage('m1', legacy, '2024-01-01T00:00:00Z')]
    const result = computeObservability(messages, [])
    expect(result).not.toBeNull()
    expect(result!.summary.llmCalls).toBe(0) // no llmCalls on legacy stats
    expect(result!.summary.cacheSource).toBe('unavailable')
  })

  it('computes P50/P95/Max from call promptTokens distribution', () => {
    const calls = [100, 200, 300, 400, 500, 6000].map((n, i) => makeCall({ callIndex: i + 1, promptTokens: n }))
    const stats = makeStats({ prefillTokens: calls.reduce((s, c) => s + c.promptTokens!, 0), llmCalls: calls })
    const messages = [makeMessage('m1', stats, '2024-01-01T00:00:00Z')]
    const result = computeObservability(messages, [])
    expect(result).not.toBeNull()
    expect(result!.summary.contextMax).toBe(6000)
    expect(result!.summary.contextP50).toBeGreaterThan(0)
    expect(result!.summary.contextP95).toBeGreaterThan(result!.summary.contextP50)
  })

  it('schemaVersion is obs.v1', () => {
    const stats = makeStats({ prefillTokens: 100, llmCalls: [makeCall({ promptTokens: 100 })] })
    const messages = [makeMessage('m1', stats, '2024-01-01T00:00:00Z')]
    const result = computeObservability(messages, [])
    expect(result!.schemaVersion).toBe('obs.v1')
  })
})
