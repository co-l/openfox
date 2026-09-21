interface CacheEntry {
  value?: unknown
  pending?: Promise<unknown>
  ts: number
}

const DEFAULT_TTL_MS = 30_000
const cache = new Map<string, CacheEntry>()

export function readBadgeCache(key: string, ttlMs = DEFAULT_TTL_MS): { hit: boolean; value?: unknown } {
  const entry = cache.get(key)
  if (!entry || entry.value === undefined) return { hit: false }
  if (Date.now() - entry.ts > ttlMs) return { hit: false }
  return { hit: true, value: entry.value }
}

/**
 * Single-flight + TTL cache for badge RPC values. The sidebar renders one badge
 * per session row, so without this a 200-session list would fire 200 identical
 * plugin RPCs on load.
 */
export function fetchBadgeValue(
  key: string,
  fetcher: () => Promise<unknown>,
  ttlMs = DEFAULT_TTL_MS,
): Promise<unknown> {
  const cached = readBadgeCache(key, ttlMs)
  if (cached.hit) return Promise.resolve(cached.value)

  const entry = cache.get(key)
  if (entry?.pending) return entry.pending

  const pending = fetcher()
    .then((value) => {
      cache.set(key, { value, ts: Date.now() })
      return value
    })
    .catch((error: unknown) => {
      cache.delete(key)
      throw error
    })
  cache.set(key, { pending, ts: Date.now() })
  return pending
}

export function clearBadgeCache(): void {
  cache.clear()
}
