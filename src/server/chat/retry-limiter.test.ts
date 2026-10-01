import { describe, it, expect } from 'vitest'
import { createRetryLimiter } from './retry-limiter.js'

describe('createRetryLimiter', () => {
  it('allows retry when count is under max', () => {
    const limiter = createRetryLimiter(5)
    expect(limiter.canRetry()).toBe(true)
    limiter.increment()
    expect(limiter.canRetry()).toBe(true)
    limiter.increment()
    expect(limiter.canRetry()).toBe(true)
  })

  it('blocks retry when count reaches max', () => {
    const limiter = createRetryLimiter(3)
    limiter.increment()
    limiter.increment()
    limiter.increment()
    expect(limiter.canRetry()).toBe(false)
  })

  it('blocks retry when count exceeds max', () => {
    const limiter = createRetryLimiter(2)
    limiter.increment()
    limiter.increment()
    limiter.increment()
    expect(limiter.canRetry()).toBe(false)
  })

  it('resets count', () => {
    const limiter = createRetryLimiter(3)
    limiter.increment()
    limiter.increment()
    limiter.reset()
    expect(limiter.canRetry()).toBe(true)
  })

  it('returns current count', () => {
    const limiter = createRetryLimiter(5)
    expect(limiter.count()).toBe(0)
    limiter.increment()
    expect(limiter.count()).toBe(1)
    limiter.increment()
    expect(limiter.count()).toBe(2)
  })

  it('returns max retries', () => {
    const limiter = createRetryLimiter(10)
    expect(limiter.maxRetries()).toBe(10)
  })

  it('raises the limit mid-run via setMaxRetries', () => {
    const limiter = createRetryLimiter(1)
    limiter.increment()
    expect(limiter.canRetry()).toBe(false)
    limiter.setMaxRetries(5)
    expect(limiter.maxRetries()).toBe(5)
    expect(limiter.canRetry()).toBe(true)
  })

  it('lowers the limit mid-run via setMaxRetries', () => {
    const limiter = createRetryLimiter(5)
    limiter.increment()
    expect(limiter.canRetry()).toBe(true)
    limiter.setMaxRetries(1)
    expect(limiter.canRetry()).toBe(false)
  })
})
