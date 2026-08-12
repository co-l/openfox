import { computeSessionStats } from '@shared/stats.js'
import type { Message } from '@shared/types.js'

export interface GenerationSeriesOptions {
  /** Total window length in minutes (default 30). */
  windowMinutes?: number
  /** Width of each time bucket in minutes (default 3). */
  bucketMinutes?: number
}

export interface GenerationSeriesPoint {
  /** Bucket start time (epoch ms). */
  x: number
  /** Combined generation speed (tok/s) for that bucket across panes. */
  y: number
}

/**
 * Build a combined token-generation series across the given panes. The window
 * is sliced into fixed-width buckets; within a bucket each pane contributes
 * the average generation speed of its responses that fell in that bucket, and
 * the per-pane averages are summed into the bucket's total.
 */
export function buildAggregateGenerationSeries(
  panes: Message[][],
  now: number,
  options: GenerationSeriesOptions = {},
): GenerationSeriesPoint[] {
  const windowMinutes = options.windowMinutes ?? 30
  const bucketMinutes = options.bucketMinutes ?? 3
  const windowMs = windowMinutes * 60_000
  const bucketMs = bucketMinutes * 60_000
  const bucketCount = Math.max(1, Math.floor(windowMs / bucketMs))
  const windowStart = now - windowMs

  const totals = new Array<number>(bucketCount).fill(0)

  for (const messages of panes) {
    const stats = computeSessionStats(messages)
    if (!stats) continue

    const bucketSpeeds = new Map<number, number[]>()
    for (const point of stats.dataPoints) {
      const timestamp = new Date(point.timestamp).getTime()
      if (Number.isNaN(timestamp) || timestamp < windowStart || timestamp > now) continue
      const index = Math.min(bucketCount - 1, Math.max(0, Math.floor((timestamp - windowStart) / bucketMs)))
      const speeds = bucketSpeeds.get(index) ?? []
      bucketSpeeds.set(index, [...speeds, point.generationSpeed])
    }

    for (const [index, speeds] of bucketSpeeds) {
      const average = speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length
      totals[index] = (totals[index] ?? 0) + average
    }
  }

  return totals.map((y, index) => ({ x: windowStart + index * bucketMs, y }))
}
