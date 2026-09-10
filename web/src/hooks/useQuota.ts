import { useResource } from './useResource'
import { quotaResource } from '../lib/resources'
import { isQuotaMetricOverLimit } from '../lib/quota'
import type { QuotaReport } from '@shared/types.js'

export interface UseQuotaResult {
  report: QuotaReport | undefined
  loading: boolean
  error: unknown
  refresh: () => Promise<QuotaReport | undefined>
  hasWarning: boolean
}

/**
 * Usage and quotas with implicit loadership via the quota resource cache.
 */
export function useQuota(): UseQuotaResult {
  const { data: report, loading, error, refresh } = useResource(quotaResource)
  const hasWarning = (report?.sources ?? []).some((s) => s.metrics.some(isQuotaMetricOverLimit))
  return { report, loading, error, refresh, hasWarning }
}
