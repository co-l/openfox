import type { CallStatsDataPoint, SessionStats, StatsDataPoint } from './types.js'

export type StatsChartMode = 'responses' | 'calls'

export interface ResponseLogRow extends StatsDataPoint {
  callCount: number
  calls: CallStatsDataPoint[]
  isExpandable: boolean
}

export interface PerformanceChartData {
  mode: StatsChartMode
  xLabel: 'response' | 'context'
  prefillLabel: string
  generationLabel: string
  points: Array<{ x: number; ppSpeed: number; tgSpeed: number }>
}

export function buildResponseLogRows(stats: SessionStats): ResponseLogRow[] {
  const callsByMessageId = new Map<string, CallStatsDataPoint[]>()

  for (const call of stats.callDataPoints) {
    const existing = callsByMessageId.get(call.messageId) ?? []
    callsByMessageId.set(call.messageId, [...existing, call])
  }

  return stats.dataPoints.map((response) => {
    const calls = [...(callsByMessageId.get(response.messageId) ?? [])]
      .sort((a, b) => a.callIndex - b.callIndex)

    return {
      ...response,
      callCount: calls.length,
      calls,
      isExpandable: calls.length > 1,
    }
  })
}

function buildResponseChartData(stats: SessionStats): PerformanceChartData {
  return {
    mode: 'responses',
    xLabel: 'response',
    prefillLabel: 'Prefill Speed (tok/s) by Response',
    generationLabel: 'Generation Speed (tok/s) by Response',
    points: stats.dataPoints.map((point) => ({
      x: point.responseIndex,
      ppSpeed: point.prefillSpeed,
      tgSpeed: point.generationSpeed,
    })),
  }
}

function buildCallChartData(stats: SessionStats): PerformanceChartData {
  return {
    mode: 'calls',
    xLabel: 'context',
    prefillLabel: 'Prefill Speed (tok/s) vs Context',
    generationLabel: 'Generation Speed (tok/s) vs Context',
    points: stats.callDataPoints.map((point) => ({
      x: point.promptTokens,
      ppSpeed: point.prefillSpeed,
      tgSpeed: point.generationSpeed,
    })),
  }
}

export function buildPerformanceChartData(
  stats: SessionStats
): PerformanceChartData {
  if (stats.callDataPoints.length > 0) {
    return buildCallChartData(stats)
  }

  return buildResponseChartData(stats)
}
