import { describe, expect, it } from 'vitest'
import { buildPerformanceChartData, buildResponseLogRows } from './stats-view.js'
import type { SessionStats } from './types.js'

const baseStats: SessionStats = {
  totalTime: 34.6,
  aiTime: 34.6,
  toolTime: 0,
  prefillTokens: 8300,
  generationTokens: 931,
  avgPrefillSpeed: 1900,
  avgGenerationSpeed: 30.8,
  responseCount: 4,
  llmCallCount: 5,
  dataPoints: [
    {
      messageId: 'r1',
      timestamp: '2024-01-01T16:37:48Z',
      mode: 'planner',
      responseIndex: 1,
      prefillTokens: 1400,
      generationTokens: 120,
      prefillSpeed: 1800,
      generationSpeed: 30.9,
      totalTime: 5.2,
      aiTime: 5.2,
      toolTime: 0,
    },
    {
      messageId: 'r2',
      timestamp: '2024-01-01T16:37:54Z',
      mode: 'planner',
      responseIndex: 2,
      prefillTokens: 1500,
      generationTokens: 130,
      prefillSpeed: 1900,
      generationSpeed: 31,
      totalTime: 4.8,
      aiTime: 4.8,
      toolTime: 0,
    },
    {
      messageId: 'r3',
      timestamp: '2024-01-01T16:38:02Z',
      mode: 'planner',
      responseIndex: 3,
      prefillTokens: 1600,
      generationTokens: 140,
      prefillSpeed: 1900,
      generationSpeed: 31.1,
      totalTime: 5.5,
      aiTime: 5.5,
      toolTime: 0,
    },
    {
      messageId: 'r4',
      timestamp: '2024-01-01T16:41:01Z',
      mode: 'planner',
      responseIndex: 4,
      prefillTokens: 3800,
      generationTokens: 541,
      prefillSpeed: 2000,
      generationSpeed: 30.7,
      totalTime: 19.0,
      aiTime: 19.0,
      toolTime: 0,
    },
  ],
  callDataPoints: [
    {
      messageId: 'r1',
      timestamp: '2024-01-01T16:37:53Z',
      mode: 'planner',
      responseIndex: 1,
      sessionCallIndex: 1,
      callIndex: 1,
      promptTokens: 1400,
      completionTokens: 120,
      ttft: 0.8,
      completionTime: 4.4,
      prefillSpeed: 1800,
      generationSpeed: 30.9,
      totalTime: 5.2,
    },
    {
      messageId: 'r2',
      timestamp: '2024-01-01T16:37:59Z',
      mode: 'planner',
      responseIndex: 2,
      sessionCallIndex: 2,
      callIndex: 1,
      promptTokens: 1500,
      completionTokens: 130,
      ttft: 0.8,
      completionTime: 4.0,
      prefillSpeed: 1900,
      generationSpeed: 31.0,
      totalTime: 4.8,
    },
    {
      messageId: 'r3',
      timestamp: '2024-01-01T16:38:08Z',
      mode: 'planner',
      responseIndex: 3,
      sessionCallIndex: 3,
      callIndex: 1,
      promptTokens: 1600,
      completionTokens: 140,
      ttft: 0.9,
      completionTime: 4.6,
      prefillSpeed: 1900,
      generationSpeed: 31.1,
      totalTime: 5.5,
    },
    {
      messageId: 'r4',
      timestamp: '2024-01-01T16:41:01Z',
      mode: 'planner',
      responseIndex: 4,
      sessionCallIndex: 4,
      callIndex: 1,
      promptTokens: 1700,
      completionTokens: 180,
      ttft: 0.9,
      completionTime: 5.0,
      prefillSpeed: 1900,
      generationSpeed: 31.1,
      totalTime: 5.9,
    },
    {
      messageId: 'r4',
      timestamp: '2024-01-01T16:41:14Z',
      mode: 'planner',
      responseIndex: 4,
      sessionCallIndex: 5,
      callIndex: 2,
      promptTokens: 2100,
      completionTokens: 361,
      ttft: 1.0,
      completionTime: 12.1,
      prefillSpeed: 2100,
      generationSpeed: 30.5,
      totalTime: 13.1,
    },
  ],
}

describe('stats view helpers', () => {
  it('groups calls under their parent response rows', () => {
    const rows = buildResponseLogRows(baseStats)

    expect(rows).toHaveLength(4)
    expect(rows[0]).toMatchObject({ responseIndex: 1, callCount: 1, isExpandable: false })
    expect(rows[3]).toMatchObject({ responseIndex: 4, callCount: 2, isExpandable: true })
    expect(rows[3]!.calls.map((call) => call.callIndex)).toEqual([1, 2])
  })

  it('uses call-level chart data by default when call data exists', () => {
    const chart = buildPerformanceChartData(baseStats)

    expect(chart.mode).toBe('calls')
    expect(chart.xLabel).toBe('context')
    expect(chart.points).toHaveLength(5)
    expect(chart.points[4]).toMatchObject({ x: 2100, ppSpeed: 2100, tgSpeed: 30.5 })
  })

  it('falls back to response-level chart data when no call data exists', () => {
    const responseOnlyStats: SessionStats = {
      ...baseStats,
      llmCallCount: 0,
      callDataPoints: [],
    }

    const chart = buildPerformanceChartData(responseOnlyStats)

    expect(chart.mode).toBe('responses')
    expect(chart.xLabel).toBe('response')
    expect(chart.points).toHaveLength(4)
  })
})
