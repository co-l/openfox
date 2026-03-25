import { useMemo } from 'react'
import { buildSparklineChart } from '@shared/sparkline.js'

interface DataPoint {
  x: number
  y: number
  label?: string
}

interface SparklineProps {
  data: DataPoint[]
  width?: number
  height?: number
  label?: string
  xLabel?: string
  yLabel?: string
  showAxes?: boolean
  formatY?: (value: number) => string
  formatX?: (value: number) => string
}

interface ChartPoint {
  cx: number
  cy: number
  x: number
  y: number
  leftPercent: number
  topPercent: number
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toFixed(1)
}

export function Sparkline({
  data,
  width = 60,
  height = 78,
  label,
  xLabel,
  yLabel,
  showAxes = true,
  formatY = formatNumber,
  formatX = formatNumber,
}: SparklineProps) {
  const chartData = useMemo(() => {
    const range = buildSparklineChart(data, width)
    const chartWidth = Math.max(width * 6, 240)
    const horizontalPadding = 10
    const verticalPadding = 8
    const sorted = [...data].sort((a, b) => a.x - b.x)

    const points: ChartPoint[] = sorted.map((point) => {
      const cx = range.maxX === range.minX
        ? chartWidth / 2
        : horizontalPadding + ((point.x - range.minX) / (range.maxX - range.minX)) * (chartWidth - horizontalPadding * 2)
      const cy = range.maxY === range.minY
        ? height / 2
        : verticalPadding + ((range.maxY - point.y) / (range.maxY - range.minY)) * (height - verticalPadding * 2)

      return {
        ...point,
        cx,
        cy,
        leftPercent: (cx / chartWidth) * 100,
        topPercent: (cy / height) * 100,
      }
    })

    const path = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.cx.toFixed(1)} ${point.cy.toFixed(1)}`)
      .join(' ')

    const yTicks = [range.maxY, (range.maxY + range.minY) / 2, range.minY]
    const gridLines = yTicks.map((tick) => ({
      value: tick,
      y: range.maxY === range.minY
        ? height / 2
        : verticalPadding + ((range.maxY - tick) / (range.maxY - range.minY)) * (height - verticalPadding * 2),
    }))

    return {
      ...range,
      chartWidth,
      points,
      path,
      gridLines,
    }
  }, [data, height, width])

  if (data.length === 0) {
    return (
      <div className="font-mono text-text-muted text-xs">
        {label && <div className="mb-1">{label}</div>}
        <div>No data</div>
      </div>
    )
  }

  return (
    <div className="font-mono text-xs">
      {label && (
        <div className="text-text-secondary mb-2">{label}</div>
      )}

      <div className="flex gap-3">
        {showAxes && (
          <div className="w-12 h-[78px] flex flex-col justify-between text-right text-text-muted">
            {chartData.gridLines.map((line) => (
              <span key={`${line.value}-${line.y}`}>{formatY(line.value)}</span>
            ))}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="relative h-[78px]">
            <svg
              viewBox={`0 0 ${chartData.chartWidth} ${height}`}
              className="w-full h-[78px] overflow-visible"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {chartData.gridLines.map((line) => (
                <line
                  key={`grid-${line.y}`}
                  x1="0"
                  x2={chartData.chartWidth}
                  y1={line.y}
                  y2={line.y}
                  stroke="currentColor"
                  strokeDasharray="3 4"
                  className="text-border/60"
                />
              ))}

              {chartData.points.map((point) => (
                <line
                  key={`guide-${point.cx}-${point.cy}`}
                  x1={point.cx}
                  x2={point.cx}
                  y1={height - 4}
                  y2={point.cy}
                  stroke="currentColor"
                  className="text-border/40"
                />
              ))}

              {chartData.points.length > 1 && (
                <path
                  d={chartData.path}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-accent-primary/45"
                />
              )}
            </svg>

            {chartData.points.map((point) => (
              <div
                key={`point-${point.x}-${point.y}`}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${point.leftPercent}%`, top: `${point.topPercent}%` }}
                title={`${formatX(point.x)} -> ${formatY(point.y)}`}
              >
                <div className="w-2.5 h-2.5 rounded-full bg-accent-primary/20 flex items-center justify-center">
                  <div className="w-1.5 h-1.5 rounded-full bg-accent-primary" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showAxes && (
        <div className="flex items-start gap-3 text-text-muted mt-1">
          <span className="w-12" />
          <span className="flex-1 flex justify-between">
            <span>{formatX(chartData.minX)}</span>
            <span>{xLabel}</span>
            <span>{formatX(chartData.maxX)}</span>
          </span>
        </div>
      )}

      {yLabel && showAxes && (
        <div className="text-text-muted mt-1 text-center">{yLabel}</div>
      )}
    </div>
  )
}

interface DualSparklineProps {
  data: Array<{ x: number; ppSpeed: number; tgSpeed: number }>
  prefillLabel?: string
  generationLabel?: string
  xLabel?: string
  width?: number
}

export function DualSparkline({
  data,
  prefillLabel = 'Prefill Speed (tok/s) by Response',
  generationLabel = 'Generation Speed (tok/s) by Response',
  xLabel = 'response',
  width = 60,
}: DualSparklineProps) {
  const ppData = data.map((point) => ({ x: point.x, y: point.ppSpeed }))
  const tgData = data.map((point) => ({ x: point.x, y: point.tgSpeed }))

  return (
    <div className="space-y-5">
      <Sparkline
        data={ppData}
        width={width}
        label={prefillLabel}
        xLabel={xLabel}
      />
      <Sparkline
        data={tgData}
        width={width}
        label={generationLabel}
        xLabel={xLabel}
      />
    </div>
  )
}
