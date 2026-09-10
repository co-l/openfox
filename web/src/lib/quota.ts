import type { QuotaMetric } from '@shared/types'

/**
 * Single source of truth for "is this metric at/over its limit".
 * Used by both the header warning dot and the quota modal so the two never diverge.
 */
export function isQuotaMetricOverLimit(metric: QuotaMetric): boolean {
  if (metric.kind === 'windowed') return metric.used >= metric.limit
  return metric.remaining <= 0
}

export function hasQuotaWarning(metrics: QuotaMetric[]): boolean {
  return metrics.some(isQuotaMetricOverLimit)
}
