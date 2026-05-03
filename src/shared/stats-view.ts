import type { CallStatsDataPoint, ModelSessionStats, SessionStats, StatsDataPoint } from './types.js'

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

type StatsViewData =
  | Pick<SessionStats, 'dataPoints' | 'callDataPoints'>
  | Pick<ModelSessionStats, 'dataPoints' | 'callDataPoints'>

export function buildResponseLogRows(stats: StatsViewData): ResponseLogRow[] {
  const callsByMessageId = new Map<string, CallStatsDataPoint[]>()

  for (const call of stats.callDataPoints) {
    const existing = callsByMessageId.get(call.messageId) ?? []
    callsByMessageId.set(call.messageId, [...existing, call])
  }

  return stats.dataPoints.map((response) => {
    const calls = [...(callsByMessageId.get(response.messageId) ?? [])].sort((a, b) => a.callIndex - b.callIndex)

    return {
      ...response,
      callCount: calls.length,
      calls,
      isExpandable: calls.length > 1,
    }
  })
}

function buildResponseChartData(stats: StatsViewData): PerformanceChartData {
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

function buildCallChartData(stats: StatsViewData): PerformanceChartData {
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

export function buildPerformanceChartData(stats: StatsViewData): PerformanceChartData {
  if (stats.callDataPoints.length > 0) {
    return buildCallChartData(stats)
  }

  return buildResponseChartData(stats)
}
