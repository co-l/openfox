import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTaskScheduler } from './scheduler.js'

describe('createTaskScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs immediately on start (boot catch-up) then ticks on the interval', () => {
    const run = vi.fn()
    const scheduler = createTaskScheduler({ run, intervalMs: 30_000 })

    scheduler.start()
    expect(run).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(30_000)
    expect(run).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(30_000)
    expect(run).toHaveBeenCalledTimes(3)

    scheduler.stop()
  })

  it('stop clears the timer so no further ticks fire', () => {
    const run = vi.fn()
    const scheduler = createTaskScheduler({ run, intervalMs: 30_000 })

    scheduler.start()
    scheduler.stop()
    vi.advanceTimersByTime(120_000)

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('does not tick before start', () => {
    const run = vi.fn()
    const scheduler = createTaskScheduler({ run, intervalMs: 30_000 })
    vi.advanceTimersByTime(60_000)
    expect(run).not.toHaveBeenCalled()
    scheduler.start()
    scheduler.stop()
  })

  it('start is idempotent (does not double-run or double-tick)', () => {
    const run = vi.fn()
    const scheduler = createTaskScheduler({ run, intervalMs: 30_000 })

    scheduler.start()
    scheduler.start()
    expect(run).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(30_000)
    expect(run).toHaveBeenCalledTimes(2)

    scheduler.stop()
  })
})
