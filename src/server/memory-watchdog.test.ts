import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getHeapStatistics } from 'node:v8'
import { recordSample, startMemoryWatchdog, stopMemoryWatchdog } from './memory-watchdog.js'
import { logger } from './utils/logger.js'

vi.mock('node:v8', () => ({
  getHeapStatistics: vi.fn(() => ({ heap_size_limit: 8 * 1024 * 1024 * 1024 })),
}))

const MIN = 60_000
const MB = 1024 * 1024

function mockMemory(heapUsed: number): void {
  vi.spyOn(process, 'memoryUsage').mockReturnValue({
    heapUsed,
    heapTotal: heapUsed * 2,
    rss: heapUsed * 3,
  } as ReturnType<typeof process.memoryUsage>)
}

describe('memory watchdog', () => {
  beforeEach(() => {
    stopMemoryWatchdog()
    vi.mocked(getHeapStatistics).mockReset()
    vi.mocked(getHeapStatistics).mockReturnValue({ heap_size_limit: 8 * 1024 * 1024 * 1024 } as never)
    vi.spyOn(logger, 'warn').mockImplementation(() => {})
    vi.spyOn(logger, 'debug').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    stopMemoryWatchdog()
  })

  it('records a memory sample on demand', () => {
    mockMemory(100)

    const sample = recordSample()

    expect(sample).toMatchObject({ heapUsed: 100, heapTotal: 200, rss: 300 })
  })

  it('warns when heap usage exceeds 75% of the heap limit', () => {
    vi.mocked(getHeapStatistics).mockReturnValue({ heap_size_limit: 1000 } as never)
    mockMemory(800)

    recordSample()

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('heap usage'),
      expect.objectContaining({ heapUsed: 800, heapLimit: 1000 }),
    )
  })

  it('throttles heap-usage warnings to one per 30 minutes', () => {
    vi.mocked(getHeapStatistics).mockReturnValue({ heap_size_limit: 1000 } as never)
    mockMemory(800)
    const t0 = 1_000_000_000_000

    recordSample(t0)
    recordSample(t0 + 2 * MIN)
    recordSample(t0 + 31 * MIN)

    const heapWarnings = vi.mocked(logger.warn).mock.calls.filter(([msg]) => msg.includes('heap usage'))
    expect(heapWarnings).toHaveLength(2)
  })

  it('does not warn below the 75% heap threshold', () => {
    vi.mocked(getHeapStatistics).mockReturnValue({ heap_size_limit: 1000 } as never)
    mockMemory(500)

    recordSample()

    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('warns on sustained heap growth over the 30-minute window', () => {
    mockMemory(100)
    const t0 = 1_000_000_000_000
    recordSample(t0)

    mockMemory(100 + 100 * MB)
    recordSample(t0 + 29 * MIN)

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('sustained heap growth'), expect.anything())
  })

  it('does not warn on growth below the 100MB threshold', () => {
    mockMemory(100)
    const t0 = 1_000_000_000_000
    recordSample(t0)

    mockMemory(100 + 50 * MB)
    recordSample(t0 + 29 * MIN)

    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('throttles growth warnings to one per 30 minutes', () => {
    const t0 = 1_000_000_000_000
    mockMemory(100)
    recordSample(t0)

    mockMemory(200 * MB)
    recordSample(t0 + 29 * MIN)

    mockMemory(210 * MB)
    recordSample(t0 + 30 * MIN)

    mockMemory(300 * MB)
    recordSample(t0 + 59 * MIN)

    const growthWarnings = vi.mocked(logger.warn).mock.calls.filter(([msg]) => msg.includes('sustained heap growth'))
    expect(growthWarnings).toHaveLength(2)
  })

  it('samples on an interval while running and stops cleanly', () => {
    vi.useFakeTimers()
    mockMemory(100)

    startMemoryWatchdog()
    vi.advanceTimersByTime(3 * MIN)
    expect(vi.mocked(logger.debug).mock.calls.length).toBeGreaterThanOrEqual(3)

    stopMemoryWatchdog()
    const count = vi.mocked(logger.debug).mock.calls.length
    vi.advanceTimersByTime(MIN)
    expect(vi.mocked(logger.debug).mock.calls.length).toBe(count)
  })

  it('startMemoryWatchdog is idempotent', () => {
    vi.useFakeTimers()
    mockMemory(100)

    startMemoryWatchdog()
    startMemoryWatchdog()
    vi.advanceTimersByTime(2 * MIN)

    expect(vi.mocked(logger.debug).mock.calls.length).toBe(3)
  })
})
