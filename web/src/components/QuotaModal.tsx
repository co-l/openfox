import { useEffect } from 'react'
import { Modal } from './shared/Modal'
import { QuotaIcon } from './shared/icons'
import { useQuota } from '../hooks/useQuota'
import { useT } from '../hooks/useT'
import { isQuotaMetricOverLimit } from '../lib/quota'
import type { QuotaMetric, QuotaSource } from '@shared/types'

interface QuotaModalProps {
  isOpen: boolean
  onClose: () => void
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

function formatReset(iso: string | undefined, t: ReturnType<typeof useT>): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return t({ en: 'Resets {{date}}', fr: 'Réinitialisation le {{date}}' }, { date: date.toLocaleString() })
}

function metricUsage(m: QuotaMetric): number {
  return m.kind === 'windowed' ? m.used : m.total - m.remaining
}

function metricLimit(m: QuotaMetric): number {
  return m.kind === 'windowed' ? m.limit : m.total
}

function MetricCard({ metric }: { metric: QuotaMetric }) {
  const t = useT()
  const used = metricUsage(metric)
  const limit = metricLimit(metric)
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const over = isQuotaMetricOverLimit(metric)
  const barColor = over ? 'bg-accent-danger' : pct >= 80 ? 'bg-accent-warning' : 'bg-accent-primary'

  const reset = metric.kind === 'windowed' ? formatReset(metric.resetsAt, t) : null

  const windowLabel =
    metric.kind === 'windowed'
      ? metric.window === 'hour'
        ? t({ en: 'per hour', fr: 'par heure' })
        : metric.window === 'week'
          ? t({ en: 'per week', fr: 'par semaine' })
          : t({ en: 'per month', fr: 'par mois' })
      : ''

  // For windowed: show used/limit + % used. For token-balance: show remaining/total + % remaining.
  const primaryValue = metric.kind === 'windowed' ? formatNumber(used) : formatNumber(metric.remaining)
  const primarySub =
    metric.kind === 'windowed'
      ? t(
          { en: '/ {{limit}} {{window}}', fr: '/ {{limit}} {{window}}' },
          { limit: formatNumber(limit), window: windowLabel },
        )
      : t({ en: 'of {{total}} total', fr: 'sur {{total}} au total' }, { total: formatNumber(limit) })
  const pctLabel =
    metric.kind === 'windowed'
      ? t({ en: '{{pct}}% used', fr: '{{pct}} % utilisé' }, { pct })
      : t({ en: '{{pct}}% left', fr: '{{pct}} % restant' }, { pct: 100 - pct })
  // Remaining count shown on the same line as the big value, on the right.
  const remainingLabel =
    metric.kind === 'windowed'
      ? t({ en: '{{count}} left', fr: '{{count}} restant' }, { count: formatNumber(limit - used) })
      : t({ en: '{{count}} left', fr: '{{count}} restant' }, { count: formatNumber(metric.remaining) })
  // Line under the bar: windowed shows the reset date; token-balance has none.
  const bottomLeft = metric.kind === 'windowed' ? reset : null
  const usedTooltip =
    metric.kind === 'windowed'
      ? t(
          { en: '{{used}} used of {{limit}}', fr: '{{used}} utilisé sur {{limit}}' },
          { used: formatNumber(used), limit: formatNumber(limit) },
        )
      : t(
          { en: '{{remaining}} remaining of {{total}}', fr: '{{remaining}} restant sur {{total}}' },
          { remaining: formatNumber(metric.remaining), total: formatNumber(limit) },
        )

  return (
    <div className="flex-1 min-w-[160px] rounded-lg border border-border bg-bg-tertiary/30 p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-muted truncate">{metric.label}</span>
        {over && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-accent-danger/20 text-accent-danger shrink-0">
            {t({ en: 'Limit', fr: 'Limite' })}
          </span>
        )}
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-lg font-semibold text-text-primary">{primaryValue}</span>
          <span className="text-xs text-text-muted">{primarySub}</span>
        </div>
        <span className="text-[11px] text-text-muted shrink-0">{remainingLabel}</span>
      </div>

      <div className="h-1.5 w-full rounded-full bg-bg-tertiary overflow-hidden" title={usedTooltip}>
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px] text-text-muted">
        <span>{bottomLeft}</span>
        <span className="font-medium text-text-primary">{pctLabel}</span>
      </div>
    </div>
  )
}

function SourceSection({ source }: { source: QuotaSource }) {
  const hasWarning = source.metrics.some(isQuotaMetricOverLimit)

  // Group metrics: those without a model are "shared" (e.g. hour/week/month),
  // those with a model are grouped under that model's name.
  const shared = source.metrics.filter((m) => !m.model)
  const byModel = new Map<string, QuotaMetric[]>()
  for (const m of source.metrics) {
    if (!m.model) continue
    const list = byModel.get(m.model) ?? []
    list.push(m)
    byModel.set(m.model, list)
  }

  return (
    <div className="rounded-lg border border-border bg-bg-secondary overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5 bg-bg-tertiary/40 border-b border-border">
        <QuotaIcon className="w-4 h-4 text-accent-primary shrink-0" />
        <h3 className="text-sm font-semibold text-text-primary">{source.name}</h3>
        {hasWarning && <span className="w-1.5 h-1.5 rounded-full bg-accent-danger" />}
      </div>

      <div className="flex flex-col gap-3 p-3">
        {shared.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {shared.map((metric, i) => (
              <MetricCard key={`shared-${metric.kind}-${metric.label}-${i}`} metric={metric} />
            ))}
          </div>
        )}

        {[...byModel.entries()].map(([model, metrics]) => (
          <div key={model} className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{model}</span>
            <div className="flex flex-wrap gap-2">
              {metrics.map((metric, i) => (
                <MetricCard key={`${model}-${metric.kind}-${metric.label}-${i}`} metric={metric} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function QuotaModal({ isOpen, onClose }: QuotaModalProps) {
  const t = useT()
  const { report, loading, error, refresh, hasWarning } = useQuota()

  useEffect(() => {
    if (!isOpen) return
    void refresh()
    // Keep the modal fresh while open; also clears a stale warning after recovery.
    const interval = setInterval(() => void refresh(), 30_000)
    return () => clearInterval(interval)
  }, [isOpen, refresh])

  const errorMessage = error ? (error instanceof Error ? error.message : String(error)) : null

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t({ en: 'Usage & Quotas', fr: 'Utilisation & quotas' })}
      size="xl"
      closeOnBackdropClick
      showCloseButton
      footer={
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="px-3 py-1.5 rounded bg-bg-tertiary hover:bg-bg-tertiary/70 text-sm text-text-primary transition-colors disabled:opacity-50"
        >
          {loading ? t({ en: 'Refreshing…', fr: 'Actualisation…' }) : t({ en: 'Refresh', fr: 'Actualiser' })}
        </button>
      }
    >
      <div className="flex flex-col gap-5 min-h-0">
        {loading && !report && (
          <div className="flex items-center justify-center py-12">
            <div className="w-5 h-5 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {errorMessage && !loading && (
          <div className="text-sm text-accent-danger py-8 text-center">
            {t(
              { en: 'Failed to load quota: {{error}}', fr: 'Échec du chargement des quotas : {{error}}' },
              { error: errorMessage },
            )}
          </div>
        )}

        {report && report.sources.length === 0 && (
          <div className="text-sm text-text-muted py-8 text-center">
            {t({ en: 'No quota information available.', fr: 'Aucune information de quota disponible.' })}
          </div>
        )}

        {report?.sources.map((source) => (
          <SourceSection key={source.id} source={source} />
        ))}
      </div>

      {hasWarning && (
        <div className="mt-4 text-xs text-accent-danger">
          {t({
            en: 'One or more quotas have reached their limit.',
            fr: 'Un ou plusieurs quotas ont atteint leur limite.',
          })}
        </div>
      )}
    </Modal>
  )
}
