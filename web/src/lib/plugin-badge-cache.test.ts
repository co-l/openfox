import { describe, expect, it, vi } from 'vitest'
import { clearBadgeCache, fetchBadgeValue, readBadgeCache } from './plugin-badge-cache'

describe('plugin badge cache', () => {
  it('dedupes concurrent fetches for the same key', async () => {
    clearBadgeCache()
    const fetcher = vi.fn().mockResolvedValue(42)
    const [a, b] = await Promise.all([
      fetchBadgeValue('demo:quota:s1', fetcher),
      fetchBadgeValue('demo:quota:s1', fetcher),
    ])
    expect(a).toBe(42)
    expect(b).toBe(42)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('serves cached values within the TTL and refetches after it', async () => {
    clearBadgeCache()
    const fetcher = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second')
    await fetchBadgeValue('demo:quota:s2', fetcher, 50)
    expect(readBadgeCache('demo:quota:s2', 50)).toEqual({ hit: true, value: 'first' })
    await expect(fetchBadgeValue('demo:quota:s2', fetcher, 50)).resolves.toBe('first')
    expect(fetcher).toHaveBeenCalledTimes(1)

    await new Promise((resolve) => setTimeout(resolve, 60))
    await expect(fetchBadgeValue('demo:quota:s2', fetcher, 50)).resolves.toBe('second')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('drops failed fetches so the next call retries', async () => {
    clearBadgeCache()
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok')
    await expect(fetchBadgeValue('demo:quota:s3', fetcher)).rejects.toThrow('boom')
    await expect(fetchBadgeValue('demo:quota:s3', fetcher)).resolves.toBe('ok')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
