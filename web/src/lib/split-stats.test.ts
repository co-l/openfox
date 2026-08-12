import { describe, expect, it } from 'vitest'
import { buildAggregateGenerationSeries } from './split-stats'
import type { Message } from '@shared/types.js'

const NOW = 1_800_000_000_000

function messageWithStats(timestamp: string, generationSpeed: number, id: string): Message {
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
      mode: 'builder',
      totalTime: 5,
      toolTime: 1,
      prefillTokens: 1000,
      prefillSpeed: 100,
      generationTokens: 100,
      generationSpeed,
    },
  }
}

// 3-minute buckets over a 30-minute window => 10 buckets starting at NOW-30min.
const WINDOW_START = NOW - 30 * 60_000
const BUCKET_MS = 3 * 60_000
const bucketStart = (index: number) => WINDOW_START + index * BUCKET_MS

describe('buildAggregateGenerationSeries', () => {
  it('returns one point per bucket spanning the window', () => {
    const series = buildAggregateGenerationSeries([[]], NOW)
    expect(series).toHaveLength(10)
    expect(series[0]!.x).toBe(WINDOW_START)
    expect(series[9]!.x).toBe(WINDOW_START + 9 * BUCKET_MS)
  })

  it('sums per-session averages within each bucket', () => {
    const paneA = [messageWithStats(new Date(bucketStart(5) + 1_000).toISOString(), 30, 'a')]
    const paneB = [messageWithStats(new Date(bucketStart(5) + 61_000).toISOString(), 40, 'b')]
    const series = buildAggregateGenerationSeries([paneA, paneB], NOW)
    expect(series[5]!.y).toBe(70)
  })

  it('averages multiple responses from one pane within a bucket', () => {
    const pane = [
      messageWithStats(new Date(bucketStart(2) + 1_000).toISOString(), 30, 'a'),
      messageWithStats(new Date(bucketStart(2) + 91_000).toISOString(), 50, 'b'),
    ]
    const series = buildAggregateGenerationSeries([pane], NOW)
    expect(series[2]!.y).toBe(40)
  })

  it('spreads responses from different buckets across the series', () => {
    const pane = [
      messageWithStats(new Date(bucketStart(0) + 1_000).toISOString(), 10, 'a'),
      messageWithStats(new Date(bucketStart(9) + 1_000).toISOString(), 999, 'b'),
    ]
    const series = buildAggregateGenerationSeries([pane], NOW)
    expect(series[0]!.y).toBe(10)
    expect(series[9]!.y).toBe(999)
    expect(series[5]!.y).toBe(0)
  })

  it('ignores responses outside the window', () => {
    const pane = [
      messageWithStats(new Date(WINDOW_START - 1).toISOString(), 777, 'old'),
      messageWithStats(new Date(NOW + 1).toISOString(), 888, 'future'),
      messageWithStats(new Date(bucketStart(3) + 1_000).toISOString(), 55, 'inside'),
    ]
    const series = buildAggregateGenerationSeries([pane], NOW)
    expect(Math.max(...series.map((p) => p.y))).toBe(55)
  })

  it('returns an all-zero series when no pane has stats', () => {
    const series = buildAggregateGenerationSeries(
      [[], [{ id: 'u', role: 'user', content: 'hi', timestamp: '2024-01-01', tokenCount: 5 }]],
      NOW,
    )
    expect(series.every((p) => p.y === 0)).toBe(true)
  })

  it('supports custom window and bucket sizes', () => {
    const series = buildAggregateGenerationSeries([[]], NOW, { windowMinutes: 10, bucketMinutes: 1 })
    expect(series).toHaveLength(10)
    expect(series[0]!.x).toBe(NOW - 10 * 60_000)
  })
})
