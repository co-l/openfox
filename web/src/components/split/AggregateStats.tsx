import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { getLocale } from '@shared/i18n/index.js'
import { useShallow } from 'zustand/react/shallow'
import { useSessionStore } from '../../stores/session'
import { buildAggregateGenerationSeries } from '../../lib/split-stats'
import { useT } from '../../hooks/useT'
import type { Message } from '@shared/types.js'

const CHART_WIDTH = 280
const CHART_HEIGHT = 44
const CHART_PAD = 4

/** Catmull-Rom spline converted to cubic Béziers for smooth angles. */
function buildSmoothPath(series: Array<{ y: number }>, maxY: number): string {
  const points = series.map((point, index) => {
    const cx = (index / Math.max(1, series.length - 1)) * CHART_WIDTH
    const cy = CHART_HEIGHT - CHART_PAD - (point.y / maxY) * (CHART_HEIGHT - CHART_PAD * 2)
    return { x: cx, y: cy }
  })
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0]!.x.toFixed(1)} ${points[0]!.y.toFixed(1)}`

  let d = `M ${points[0]!.x.toFixed(1)} ${points[0]!.y.toFixed(1)}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[Math.min(points.length - 1, i + 2)]!
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }
  return d
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Clamp the tooltip's centered left position (%) so it stays inside the chart. */
export function clampTooltipLeft(pointPercent: number, tooltipWidth: number, containerWidth: number): number {
  if (containerWidth <= 0 || tooltipWidth <= 0) return Math.min(100, Math.max(0, pointPercent))
  const halfPercent = Math.min((tooltipWidth / 2 / containerWidth) * 100, 50)
  return Math.min(Math.max(pointPercent, halfPercent), 100 - halfPercent)
}

/**
 * Split-view aggregate indicator: a sparkline of combined token-generation
 * throughput across the open panes over the last 30 minutes (one point per
 * 3-minute bucket — each pane's average in the bucket, summed across panes).
 */
export function AggregateStats() {
  const t = useT()
  const openSessionIds = useSessionStore((state) => state.openSessionIds)
  const messagesByPane = useSessionStore(
    useShallow((state) => Object.fromEntries(openSessionIds.map((id) => [id, state.panes[id]?.messages]))),
  )
  const [now, setNow] = useState(() => Date.now())
  const [hovered, setHovered] = useState<number | null>(null)
  const [tooltipSize, setTooltipSize] = useState<{ width: number; container: number } | null>(null)
  const chartRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const chartEl = chartRef.current
    const tipEl = tooltipRef.current
    if (!chartEl || !tipEl) return
    setTooltipSize({ width: tipEl.offsetWidth, container: chartEl.clientWidth })
  }, [hovered])

  const panes = useMemo(
    () => Object.values(messagesByPane).filter((messages): messages is Message[] => Boolean(messages)),
    [messagesByPane],
  )

  const series = useMemo(() => buildAggregateGenerationSeries(panes, now), [panes, now])
  const maxY = useMemo(() => series.reduce((max, point) => Math.max(max, point.y), 0), [series])
  const path = useMemo(() => (maxY > 0 ? buildSmoothPath(series, maxY) : ''), [series, maxY])

  const maxIndex = series.length - 1
  const xPercent = (index: number) => (index / Math.max(1, maxIndex)) * 100
  const topPercent = (value: number) =>
    ((CHART_HEIGHT - CHART_PAD - (value / maxY) * (CHART_HEIGHT - CHART_PAD * 2)) / CHART_HEIGHT) * 100
  const tooltipLeft =
    hovered !== null ? clampTooltipLeft(xPercent(hovered), tooltipSize?.width ?? 0, tooltipSize?.container ?? 0) : 0

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    const fraction = (event.clientX - rect.left) / rect.width
    setHovered(Math.min(maxIndex, Math.max(0, Math.round(fraction * maxIndex))))
  }

  return (
    <div
      data-testid="aggregate-stats"
      title={t({
        en: 'Combined generation speed across open panes, last 30 min (3-min buckets)',
        fr: 'Vitesse de génération combinée des panneaux ouverts, 30 dernières minutes (tranches de 3 min)',
      })}
    >
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
          {t({ en: 'Generation', fr: 'Génération' })}
        </span>
        {maxY > 0 && (
          <span
            className="text-[10px] text-text-muted"
            title={t({
              en: 'Peak combined generation speed in the window',
              fr: 'Pic de vitesse de génération combinée sur la fenêtre',
            })}
          >
            {t({ en: '{{n}} tok/s', fr: '{{n}} tok/s' }, { n: Math.round(maxY) })}
          </span>
        )}
      </div>
      {maxY > 0 ? (
        <div
          data-testid="aggregate-chart"
          ref={chartRef}
          className="relative"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHovered(null)}
        >
          <svg
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            className="w-full h-9"
            preserveAspectRatio="none"
            aria-label={t({
              en: 'Generation speed over the last 30 minutes',
              fr: 'Vitesse de génération sur les 30 dernières minutes',
            })}
            role="img"
          >
            <path
              d={`${path} L ${CHART_WIDTH} ${CHART_HEIGHT} L 0 ${CHART_HEIGHT} Z`}
              fill="currentColor"
              className="text-accent-primary/15"
            />
            <path
              d={path}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              className="text-accent-primary"
            />
          </svg>
          {hovered !== null && (
            <>
              <div
                className="pointer-events-none absolute w-1.5 h-1.5 rounded-full bg-accent-primary -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${xPercent(hovered)}%`, top: `${topPercent(series[hovered]!.y)}%` }}
              />
              <div
                ref={tooltipRef}
                data-testid="aggregate-tooltip"
                className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-secondary shadow"
                style={{ left: `${tooltipLeft}%`, top: `${topPercent(series[hovered]!.y)}%` }}
              >
                {`${formatClock(series[hovered]!.x)} · ${Math.round(series[hovered]!.y)} tok/s`}
              </div>
            </>
          )}
        </div>
      ) : (
        <p className="text-xs text-text-muted">
          {t({ en: 'No generation in the last 30 min', fr: 'Aucune génération au cours des 30 dernières minutes' })}
        </p>
      )}
    </div>
  )
}
