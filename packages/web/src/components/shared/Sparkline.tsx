import { useMemo } from 'react'

// Unicode block characters for 8 height levels (index 0 = lowest)
const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const

interface DataPoint {
  x: number  // X value (e.g., context tokens)
  y: number  // Y value (e.g., speed)
  label?: string  // Optional tooltip/hover label
}

interface SparklineProps {
  data: DataPoint[]
  width?: number  // Number of characters wide (default: 60)
  height?: number  // Number of lines tall (default: 1 for simple sparkline)
  label?: string  // Chart label
  xLabel?: string  // X-axis label (e.g., "Context (tokens)")
  yLabel?: string  // Y-axis label (e.g., "tok/s")
  showAxes?: boolean  // Show axis labels
  formatY?: (value: number) => string  // Format Y values
  formatX?: (value: number) => string  // Format X values
}

/**
 * Normalize a value to 0-7 range for block character selection
 */
function normalizeToBlock(value: number, min: number, max: number): number {
  if (max === min) return 4  // Middle block if no range
  const normalized = (value - min) / (max - min)
  return Math.min(7, Math.max(0, Math.round(normalized * 7)))
}

/**
 * Format number with k/M suffix
 */
function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toFixed(1)
}

/**
 * Bucket data points into fixed-width bins for display
 */
function bucketData(data: DataPoint[], bucketCount: number): DataPoint[] {
  if (data.length === 0) return []
  if (data.length <= bucketCount) return data

  // Sort by x value
  const sorted = [...data].sort((a, b) => a.x - b.x)
  const minX = sorted[0]!.x
  const maxX = sorted[sorted.length - 1]!.x
  const bucketWidth = (maxX - minX) / bucketCount

  const buckets: DataPoint[] = []
  
  for (let i = 0; i < bucketCount; i++) {
    const bucketStart = minX + i * bucketWidth
    const bucketEnd = bucketStart + bucketWidth
    const bucketPoints = sorted.filter(p => p.x >= bucketStart && p.x < bucketEnd)
    
    if (bucketPoints.length > 0) {
      // Average the y values in this bucket
      const avgY = bucketPoints.reduce((sum, p) => sum + p.y, 0) / bucketPoints.length
      const avgX = bucketPoints.reduce((sum, p) => sum + p.x, 0) / bucketPoints.length
      buckets.push({ x: avgX, y: avgY })
    }
  }

  return buckets
}

/**
 * ASCII sparkline chart component
 * Renders data as Unicode block characters for terminal aesthetic
 */
export function Sparkline({
  data,
  width = 60,
  label,
  xLabel,
  yLabel,
  showAxes = true,
  formatY = formatNumber,
  formatX = formatNumber,
}: SparklineProps) {
  const chartData = useMemo(() => {
    if (data.length === 0) return { blocks: '', minY: 0, maxY: 0, minX: 0, maxX: 0 }

    // Bucket data to fit width
    const bucketed = bucketData(data, width)
    if (bucketed.length === 0) return { blocks: '', minY: 0, maxY: 0, minX: 0, maxX: 0 }

    const yValues = bucketed.map(p => p.y)
    const xValues = bucketed.map(p => p.x)
    const minY = Math.min(...yValues)
    const maxY = Math.max(...yValues)
    const minX = Math.min(...xValues)
    const maxX = Math.max(...xValues)

    // Convert to block characters
    const blocks = bucketed
      .map(p => BLOCKS[normalizeToBlock(p.y, minY, maxY)])
      .join('')

    return { blocks, minY, maxY, minX, maxX }
  }, [data, width])

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
      {/* Label */}
      {label && (
        <div className="text-text-secondary mb-1">{label}</div>
      )}
      
      {/* Y-axis max + chart */}
      {showAxes && (
        <div className="flex items-start gap-1 text-text-muted">
          <span className="w-12 text-right">{formatY(chartData.maxY)}</span>
          <span className="text-text-muted">┤</span>
        </div>
      )}
      
      {/* Sparkline */}
      <div className="flex items-end gap-1">
        {showAxes && <span className="w-12" />}
        <span className="text-accent-primary tracking-tight">{chartData.blocks}</span>
      </div>
      
      {/* Y-axis min */}
      {showAxes && (
        <div className="flex items-end gap-1 text-text-muted">
          <span className="w-12 text-right">{formatY(chartData.minY)}</span>
          <span>┤</span>
        </div>
      )}
      
      {/* X-axis */}
      {showAxes && (
        <div className="flex items-start gap-1 text-text-muted mt-0.5">
          <span className="w-12" />
          <span className="flex justify-between" style={{ width: `${width}ch` }}>
            <span>{formatX(chartData.minX)}</span>
            <span>{xLabel}</span>
            <span>{formatX(chartData.maxX)}</span>
          </span>
        </div>
      )}
      
      {/* Y-axis label */}
      {yLabel && showAxes && (
        <div className="text-text-muted mt-1 text-center">{yLabel}</div>
      )}
    </div>
  )
}

/**
 * Dual sparkline showing two metrics (e.g., PP and TG speed) vs context
 */
interface DualSparklineProps {
  data: Array<{ context: number; ppSpeed: number; tgSpeed: number }>
  width?: number
}

export function DualSparkline({ data, width = 60 }: DualSparklineProps) {
  const ppData = data.map(d => ({ x: d.context, y: d.ppSpeed }))
  const tgData = data.map(d => ({ x: d.context, y: d.tgSpeed }))

  return (
    <div className="space-y-4">
      <Sparkline
        data={ppData}
        width={width}
        label="Prefill Speed (tok/s) vs Context"
        xLabel="context"
      />
      <Sparkline
        data={tgData}
        width={width}
        label="Generation Speed (tok/s) vs Context"
        xLabel="context"
      />
    </div>
  )
}
