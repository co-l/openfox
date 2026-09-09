import type { CallStatsDataPoint, ModelSessionStats, Provider, SessionStats, StatsDataPoint } from './types.js'

export type StatsChartMode = 'responses' | 'calls'

export function parseDiscountPercentage(discount?: number | string): number | null {
  if (discount === undefined || discount === null) return null
  if (typeof discount === 'number') {
    return discount > 0 && discount < 100 ? discount : null
  }
  const match = String(discount).match(/(\d+(?:\.\d+)?)/)
  if (!match || !match[1]) return null
  const num = parseFloat(match[1])
  return !isNaN(num) && num > 0 && num < 100 ? num : null
}

export function calculateDiscountedPrice(price: number, discountPercent: number): number {
  const discounted = price * (1 - discountPercent / 100)
  return Number(discounted.toPrecision(4))
}

export function calculatePointCost(
  point: {
    promptTokens?: number
    prefillTokens?: number
    generationTokens?: number
    completionTokens?: number
    providerId: string
    model: string
  },
  providers: Provider[],
): number | null {
  const provider = providers.find((p) => p.id === point.providerId)
  const modelConfig = provider?.models.find((m) => m.id === point.model)
  if (!modelConfig?.pricing) return null

  const pricing = modelConfig.pricing
  const discountPercent = parseDiscountPercentage(pricing.discount)

  const promptToks = point.promptTokens ?? point.prefillTokens ?? 0
  const completionToks = point.completionTokens ?? point.generationTokens ?? 0

  let cost = 0
  if (pricing.input !== undefined) {
    const rate = discountPercent !== null ? calculateDiscountedPrice(pricing.input, discountPercent) : pricing.input
    cost += (promptToks / 1_000_000) * rate
  }
  if (pricing.output !== undefined) {
    const rate = discountPercent !== null ? calculateDiscountedPrice(pricing.output, discountPercent) : pricing.output
    cost += (completionToks / 1_000_000) * rate
  }

  return cost > 0 ? cost : null
}

export function calculateTotalSessionCost(
  stats: SessionStats | ModelSessionStats,
  providers: Provider[],
): number | null {
  let total = 0
  let hasAnyPricing = false

  for (const point of stats.callDataPoints) {
    const callCost = calculatePointCost(point, providers)
    if (callCost !== null) {
      total += callCost
      hasAnyPricing = true
    }
  }

  return hasAnyPricing ? total : null
}

export type PriceCurrency = 'usd' | 'eur' | 'tokens'

export function formatPriceValue(value: number, currency: PriceCurrency = 'usd', perMillion = true): string {
  const safeCurrency = currency || 'usd'
  const suffix = perMillion
    ? safeCurrency === 'tokens'
      ? ' tk / 1M'
      : ' / 1M'
    : safeCurrency === 'tokens'
      ? ' tk'
      : ''
  switch (safeCurrency) {
    case 'usd':
      return `$${value}${suffix}`
    case 'eur':
      return `${value} €${suffix}`
    case 'tokens':
      return `${value}${suffix}`
    default:
      return `$${value}${suffix}`
  }
}

export function formatCost(cost: number | null | undefined, currency: PriceCurrency = 'usd'): string | null {
  if (cost === null || cost === undefined) return null
  let formattedNumber: string
  if (cost === 0) {
    formattedNumber = '0.00'
  } else if (cost < 0.0001) {
    formattedNumber = '< 0.0001'
  } else if (cost < 0.01) {
    formattedNumber = cost.toFixed(4)
  } else {
    formattedNumber = cost.toFixed(3)
  }

  switch (currency) {
    case 'usd':
      return formattedNumber.startsWith('<') ? `< $${formattedNumber.slice(2)}` : `$${formattedNumber}`
    case 'eur':
      return formattedNumber.startsWith('<') ? `< ${formattedNumber.slice(2)} €` : `${formattedNumber} €`
    case 'tokens':
      return `${formattedNumber} tk`
  }
}

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
  Pick<SessionStats, 'dataPoints' | 'callDataPoints'> | Pick<ModelSessionStats, 'dataPoints' | 'callDataPoints'>

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
