import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearCache,
  GRACE_MS,
  invalidate,
  load,
  refresh,
  release,
  retain,
  resource,
  snapshot,
  subscribe,
  write,
} from './resourceCache'

describe('resourceCache', () => {
  beforeEach(() => {
    clearCache()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('dedupes concurrent loads for the same key into a single fetch', async () => {
    const fetcher = vi.fn(async () => 'v1')
    load('k', fetcher)
    load('k', fetcher)
    await vi.runAllTimersAsync()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(snapshot('k').data).toBe('v1')
    expect(snapshot('k').loading).toBe(false)
  })

  it('skips the fetch while fresh and refetches (keeping stale data) once past the window', async () => {
    const maxAge = 10_000
    const fetcher = vi.fn(async () => 'v1')
    load('k', fetcher, maxAge)
    await vi.runAllTimersAsync()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(snapshot('k').data).toBe('v1')

    vi.setSystemTime(Date.now() + 5_000)
    load('k', fetcher, maxAge)
    await vi.runAllTimersAsync()
    expect(fetcher).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + 10_000)
    fetcher.mockResolvedValueOnce('v2')
    load('k', fetcher, maxAge)
    expect(snapshot('k').loading).toBe(true)
    expect(snapshot('k').data).toBe('v1')
    await vi.runAllTimersAsync()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(snapshot('k').data).toBe('v2')
    expect(snapshot('k').loading).toBe(false)
  })

  it('refresh keeps old data visible, flips loading, and resolves with new data', async () => {
    const fetcher = vi.fn(async () => 'v1')
    load('k', fetcher)
    await vi.runAllTimersAsync()
    expect(snapshot('k').data).toBe('v1')

    fetcher.mockResolvedValueOnce('v2')
    const p = refresh('k', fetcher)
    expect(snapshot('k').loading).toBe(true)
    expect(snapshot('k').data).toBe('v1')
    await expect(p).resolves.toBe('v2')
    expect(snapshot('k').data).toBe('v2')
    expect(snapshot('k').loading).toBe(false)
  })

  it('load never throws and lands fetch errors in the snapshot', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('boom')
    })
    expect(() => load('k', fetcher)).not.toThrow()
    await vi.runAllTimersAsync()
    expect(snapshot('k').error).toEqual(new Error('boom'))
    expect(snapshot('k').loading).toBe(false)
    expect(snapshot('k').data).toBeUndefined()
  })

  it('refresh never rejects and surfaces the error in the snapshot', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('boom')
    })
    await expect(refresh('k', fetcher)).resolves.toBeUndefined()
    expect(snapshot('k').error).toEqual(new Error('boom'))
    expect(snapshot('k').loading).toBe(false)
  })

  it('evicts zero-ref entries after the grace period but keeps them across a quick remount', async () => {
    const fetcher = vi.fn(async () => 'data')
    load('k', fetcher)
    retain('k')
    await vi.runAllTimersAsync()
    expect(snapshot('k').data).toBe('data')

    release('k')
    vi.advanceTimersByTime(GRACE_MS / 2)
    expect(snapshot('k').data).toBe('data')

    retain('k')
    vi.advanceTimersByTime(GRACE_MS + 1_000)
    expect(snapshot('k').data).toBe('data')

    release('k')
    vi.advanceTimersByTime(GRACE_MS + 1_000)
    expect(snapshot('k').data).toBeUndefined()
  })

  it('invalidate drops the entry and notifies subscribers', async () => {
    const fetcher = vi.fn(async () => 'data')
    load('k', fetcher)
    await vi.runAllTimersAsync()
    expect(snapshot('k').data).toBe('data')

    const listener = vi.fn()
    const unsubscribe = subscribe(listener)
    invalidate('k')
    expect(listener).toHaveBeenCalled()
    expect(snapshot('k').data).toBeUndefined()
    unsubscribe()
  })

  it('returns a referentially stable snapshot for the same key until the next emit', () => {
    load(
      'k',
      vi.fn(async () => 'x'),
    )
    const a = snapshot('k')
    const b = snapshot('k')
    expect(a).toBe(b)

    load(
      'other',
      vi.fn(async () => 'y'),
    )
    const c = snapshot('k')
    expect(c).not.toBe(a)
  })

  it('keeps entries for different keys fully isolated', async () => {
    const fa = vi.fn(async () => 'A')
    const fb = vi.fn(async () => 'B')
    load('agents:/a', fa)
    load('agents:/b', fb)
    await vi.runAllTimersAsync()
    expect(snapshot('agents:/a').data).toBe('A')
    expect(snapshot('agents:/b').data).toBe('B')

    invalidate('agents:/a')
    expect(snapshot('agents:/a').data).toBeUndefined()
    expect(snapshot('agents:/b').data).toBe('B')
  })

  it('resource factory colocates keyOf/refresh/invalidate and honors maxAgeMs', async () => {
    const fetch = vi.fn(async (id: string) => `data-${id}`)
    const res = resource<string, [string]>({ key: (id) => `item:${id}`, fetch, maxAgeMs: 1_000 })
    expect(res.keyOf('x')).toBe('item:x')
    expect(res.maxAgeMs).toBe(1_000)

    await expect(res.refresh('x')).resolves.toBe('data-x')
    expect(fetch).toHaveBeenCalledWith('x')
    expect(snapshot('item:x').data).toBe('data-x')

    res.invalidate('x')
    expect(snapshot('item:x').data).toBeUndefined()
  })

  it('write-through updates the entry data and notifies subscribers without fetching', async () => {
    const fetcher = vi.fn(async () => 'fetched')
    load('k', fetcher)
    await vi.runAllTimersAsync()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(snapshot('k').data).toBe('fetched')

    const listener = vi.fn()
    const unsubscribe = subscribe(listener)
    write('k', 'pushed')
    expect(listener).toHaveBeenCalled()
    expect(snapshot('k').data).toBe('pushed')
    expect(fetcher).toHaveBeenCalledTimes(1)

    // A later fetch still works and wins over the pushed payload.
    fetcher.mockResolvedValueOnce('refetched')
    await refresh('k', fetcher)
    expect(snapshot('k').data).toBe('refetched')
    unsubscribe()
  })

  it('write-through also works on a key that was never fetched', () => {
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)
    write('fresh', 'pushed')
    expect(listener).toHaveBeenCalled()
    expect(snapshot('fresh').data).toBe('pushed')
    unsubscribe()
  })

  it('resource factory exposes a write-through bound to the same key', () => {
    const fetch = vi.fn(async () => 'data')
    const res = resource<string, []>({ key: () => 'ws:key', fetch })
    res.write('pushed')
    expect(snapshot('ws:key').data).toBe('pushed')
    expect(fetch).not.toHaveBeenCalled()
  })
})
