// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelStreamingFlush,
  getBuffer,
  releaseStreamingBuffer,
  scheduleStreamingFlush,
  setFlushFn,
} from './streamingBuffer'

let hidden = false

function setHidden(value: boolean) {
  hidden = value
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('streaming buffer while the page is hidden', () => {
  const flush = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    hidden = false
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    flush.mockReset()
    setFlushFn(flush)
  })

  afterEach(() => {
    setHidden(false)
    releaseStreamingBuffer('s1')
    setFlushFn(null)
    vi.useRealTimers()
  })

  it('keeps buffering while hidden and flushes once when the page is shown again', () => {
    setHidden(true)
    for (const content of ['a', 'b', 'c']) {
      getBuffer('s1').deltaContent += content
      scheduleStreamingFlush('s1')
    }
    vi.advanceTimersByTime(5000)

    // Nobody sees a hidden page: rendering the stream there is wasted work.
    expect(flush).not.toHaveBeenCalled()
    expect(getBuffer('s1').deltaContent).toBe('abc')

    setHidden(false)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledWith('s1')
  })

  it('still commits immediately on a terminal flush (end of message) while hidden', () => {
    setHidden(true)
    getBuffer('s1').deltaContent += 'done'
    scheduleStreamingFlush('s1')

    cancelStreamingFlush('s1')

    expect(flush).toHaveBeenCalledWith('s1')
  })

  it('flushes on the next frame as before when visible', () => {
    getBuffer('s1').deltaContent += 'x'
    scheduleStreamingFlush('s1')
    vi.advanceTimersByTime(50)
    expect(flush).toHaveBeenCalledWith('s1')
  })
})
