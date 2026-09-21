// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prefetchSession, consumePrefetchedSession } from './sessionPrefetch'

describe('sessionPrefetch', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    localStorage.setItem('openfox_token', 'test-token')
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    localStorage.clear()
    // Reset the module-level pending map between tests
    vi.resetModules()
  })

  it('issues a single fetch with the session token and parses the payload', async () => {
    const payload = { session: { id: 's1' }, messages: [] }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => payload,
    } as Response)

    prefetchSession('s1')
    prefetchSession('s1') // duplicate is ignored

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(String(url)).toContain('/api/sessions/s1?history=recent')
    expect((init!.headers as Record<string, string>)['x-session-token']).toBe('test-token')

    const result = await consumePrefetchedSession('s1')
    expect(result).toEqual({ ok: true, data: payload })
  })

  it('consumes the prefetch only once', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response)

    prefetchSession('s1')
    await consumePrefetchedSession('s1')
    expect(consumePrefetchedSession('s1')).toBeUndefined()
  })

  it('fires without a token when auth is not required', async () => {
    localStorage.removeItem('openfox_token')
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response)

    prefetchSession('s1')

    expect(fetch).toHaveBeenCalledTimes(1)
    const [, init] = vi.mocked(fetch).mock.calls[0]!
    expect(init!.headers).toBeUndefined()
    await expect(consumePrefetchedSession('s1')).resolves.toEqual({ ok: true, data: {} })
  })

  it('resolves ok:false on HTTP error so the caller falls back to its own fetch', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 401 } as Response)

    prefetchSession('s1')

    await expect(consumePrefetchedSession('s1')).resolves.toEqual({ ok: false })
  })

  it('resolves ok:false on network failure so the caller falls back to its own fetch', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))

    prefetchSession('s1')

    await expect(consumePrefetchedSession('s1')).resolves.toEqual({ ok: false })
  })

  it('expires unconsumed prefetches after the TTL so the Map does not leak', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response)

      prefetchSession('s1')
      // Consumed within the TTL works normally
      await expect(consumePrefetchedSession('s1')).resolves.toEqual({ ok: true, data: {} })

      prefetchSession('s2')
      // TTL elapses without consumption — the entry is gone
      await vi.advanceTimersByTimeAsync(11_000)
      expect(consumePrefetchedSession('s2')).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('proactively removes expired entries from the Map via setTimeout GC', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response)

      prefetchSession('gc1')
      prefetchSession('gc2')

      await vi.advanceTimersByTimeAsync(11_000)

      expect(consumePrefetchedSession('gc1')).toBeUndefined()
      expect(consumePrefetchedSession('gc2')).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})
