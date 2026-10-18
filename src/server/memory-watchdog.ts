import * as v8 from 'node:v8'
import { logger } from './utils/logger.js'

const SAMPLE_INTERVAL_MS = 60_000
const RETENTION_MS = 24 * 60 * SAMPLE_INTERVAL_MS
const GROWTH_WINDOW_MS = 30 * SAMPLE_INTERVAL_MS
const GROWTH_THRESHOLD_BYTES = 100 * 1024 * 1024
const WARNING_COOLDOWN_MS = 30 * SAMPLE_INTERVAL_MS
const HEAP_WARNING_RATIO = 0.75

export interface MemorySample {
  timestamp: number
  heapUsed: number
  heapTotal: number
  rss: number
}

const samples: MemorySample[] = []
let timer: NodeJS.Timeout | null = null
let lastGrowthWarningAt: number | null = null
let lastHeapWarningAt: number | null = null

export function recordSample(timestamp: number = Date.now()): MemorySample {
  const mem = process.memoryUsage()
  const sample: MemorySample = {
    timestamp,
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    rss: mem.rss,
  }

  samples.push(sample)
  const cutoff = timestamp - RETENTION_MS
  while (samples.length > 0 && samples[0]!.timestamp < cutoff) {
    samples.shift()
  }

  evaluate(sample)
  return sample
}

function findWindowBaseline(sample: MemorySample): MemorySample | undefined {
  const windowStart = sample.timestamp - GROWTH_WINDOW_MS
  for (const s of samples) {
    if (s.timestamp >= windowStart && s.timestamp < sample.timestamp) {
      return s
    }
  }
  return undefined
}

function evaluate(sample: MemorySample): void {
  const heapLimit = v8.getHeapStatistics().heap_size_limit

  if (
    heapLimit > 0 &&
    sample.heapUsed > HEAP_WARNING_RATIO * heapLimit &&
    (lastHeapWarningAt === null || sample.timestamp - lastHeapWarningAt >= WARNING_COOLDOWN_MS)
  ) {
    lastHeapWarningAt = sample.timestamp
    logger.warn('Memory watchdog: heap usage above threshold', {
      heapUsed: sample.heapUsed,
      heapLimit,
      percent: Math.round((sample.heapUsed / heapLimit) * 100),
    })
  }

  const baseline = findWindowBaseline(sample)
  if (
    baseline &&
    sample.heapUsed - baseline.heapUsed >= GROWTH_THRESHOLD_BYTES &&
    (lastGrowthWarningAt === null || sample.timestamp - lastGrowthWarningAt >= WARNING_COOLDOWN_MS)
  ) {
    lastGrowthWarningAt = sample.timestamp
    logger.warn('Memory watchdog: sustained heap growth', {
      growthBytes: sample.heapUsed - baseline.heapUsed,
      windowMs: GROWTH_WINDOW_MS,
      heapUsed: sample.heapUsed,
      baselineHeapUsed: baseline.heapUsed,
    })
  }

  logger.debug('Memory watchdog sample', {
    heapUsed: sample.heapUsed,
    heapTotal: sample.heapTotal,
    rss: sample.rss,
  })
}

export function startMemoryWatchdog(intervalMs: number = SAMPLE_INTERVAL_MS): void {
  if (timer) return

  recordSample()
  timer = setInterval(() => {
    recordSample()
  }, intervalMs)
  timer.unref()
}

export function stopMemoryWatchdog(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  samples.length = 0
  lastGrowthWarningAt = null
  lastHeapWarningAt = null
}
