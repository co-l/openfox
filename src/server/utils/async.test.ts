import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter, createDeferred, sleep, withRetry } from './async.js'

describe('async utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sleeps and resolves deferred promises', async () => {
    const sleeper = sleep(50)
    vi.advanceTimersByTime(50)
    await expect(sleeper).resolves.toBeUndefined()

    const deferred = createDeferred<string>()
    deferred.resolve('done')
    await expect(deferred.promise).resolves.toBe('done')
  })

  it('retries operations with backoff and stops when shouldRetry says no', async () => {
    let attempts = 0
    const successPromise = withRetry(async () => {
      attempts++
      if (attempts < 3) {
        throw new Error(`fail-${attempts}`)
      }
      return 'ok'
    }, { maxRetries: 3, backoffMs: [10, 20] })

    await vi.runAllTimersAsync()
    await expect(successPromise).resolves.toBe('ok')
    expect(attempts).toBe(3)

    const stopEarly = withRetry(async () => {
      throw new Error('fatal')
    }, {
      maxRetries: 3,
      backoffMs: [10],
      shouldRetry: () => false,
    })

    await expect(stopEarly).rejects.toThrow('fatal')
  })

  it('rethrows the last error after exhausting retries and supports event subscriptions', async () => {
    const failed = withRetry(async () => {
      throw new Error('still failing')
    }, { maxRetries: 2, backoffMs: [5] })
    const failedAssertion = expect(failed).rejects.toThrow('still failing')

    await vi.runAllTimersAsync()
    await failedAssertion

    const emitter = new EventEmitter<{ event: [string]; other: [number] }>()
    const events: string[] = []
    const unsubscribe = emitter.on('event', (value) => {
      events.push(value)
    })
    emitter.emit('event', 'first')
    unsubscribe()
    emitter.emit('event', 'second')
    emitter.on('other', () => {})
    emitter.removeAllListeners()
    emitter.emit('event', 'third')

    expect(events).toEqual(['first'])
  })
})
