/**
 * Typed, keyed, single-flight request/response data cache. Pure module — no
 * React — so any consumer (hooks, event handlers, stores) shares one source of
 * truth per key.
 *
 * Snapshot contract: `snapshot(key)` returns a referentially-stable object that
 * is only rebuilt when the module `version` counter bumps on emit. This is what
 * makes the cache safe to hand to `useSyncExternalStore` — a freshly allocated
 * object on every call would loop renders forever.
 */

export interface Entry<Data> {
  data: Data | undefined
  loading: boolean
  error: unknown
  fetchedAt: number | null
  promise: Promise<Data | undefined> | null
  refs: number
}

export interface Snapshot<Data> {
  data: Data | undefined
  loading: boolean
  error: unknown
}

export interface Resource<Data, Args extends unknown[]> {
  keyOf: (...args: Args) => string
  fetch: (...args: Args) => Promise<Data>
  refresh: (...args: Args) => Promise<Data | undefined>
  invalidate: (...args: Args) => void
  write: (data: Data, ...args: Args) => void
  maxAgeMs: number
}

export interface ResourceOptions<Data, Args extends unknown[]> {
  key: (...args: Args) => string
  fetch: (...args: Args) => Promise<Data>
  maxAgeMs?: number
}

type Listener = () => void

/** How long a zero-ref entry lingers after the last release before eviction. */
export const GRACE_MS = 30_000

const entries = new Map<string, Entry<unknown>>()
const listeners = new Set<Listener>()
let version = 0
let lastSnapshotVersion = -1
let snapshotCache = new Map<string, unknown>()
let evictionTimer: ReturnType<typeof setTimeout> | null = null

function emit(): void {
  version++
  for (const listener of listeners) listener()
}

function entry<Data>(key: string): Entry<Data> {
  let e = entries.get(key) as Entry<Data> | undefined
  if (!e) {
    e = { data: undefined, loading: false, error: undefined, fetchedAt: null, promise: null, refs: 0 }
    entries.set(key, e as Entry<unknown>)
  }
  return e
}

function settle<Data>(key: string, result: { data?: Data; error?: unknown }): void {
  const e = entries.get(key) as Entry<Data> | undefined
  if (!e) return
  if (result.error !== undefined) {
    e.error = result.error
  } else {
    e.data = result.data
    e.error = undefined
    e.fetchedAt = Date.now()
  }
  e.loading = false
  e.promise = null
  emit()
}

function startFetch<Data>(key: string, fetcher: () => Promise<Data>): Promise<Data | undefined> {
  const e = entry<Data>(key)
  e.loading = true
  e.error = undefined
  emit()
  const p = Promise.resolve()
    .then(fetcher)
    .then(
      (data) => {
        settle(key, { data })
        return data
      },
      (error: unknown) => {
        settle(key, { error })
        return undefined
      },
    )
  e.promise = p
  return p
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function snapshot<Data>(key: string): Snapshot<Data> {
  if (lastSnapshotVersion !== version) {
    snapshotCache = new Map()
    lastSnapshotVersion = version
  }
  let snap = snapshotCache.get(key) as Snapshot<Data> | undefined
  if (!snap) {
    const e = entries.get(key) as Entry<Data> | undefined
    snap = {
      data: e?.data,
      loading: e?.loading ?? false,
      error: e?.error,
    }
    snapshotCache.set(key, snap)
  }
  return snap
}

/**
 * Fire-and-forget load: single-flight (skips when in-flight) and freshness-aware
 * (skips when unexpired data exists; refetches stale data while keeping the old
 * data visible). Never throws — errors land in the snapshot.
 */
export function load<Data>(key: string, fetcher: () => Promise<Data>, maxAgeMs = 0): void {
  const e = entry<Data>(key)
  if (e.promise) return
  if (maxAgeMs > 0 && e.data !== undefined && e.fetchedAt !== null && Date.now() - e.fetchedAt < maxAgeMs) return
  startFetch(key, fetcher)
}

/**
 * Explicit refetch with stale-while-revalidate: old data stays visible while
 * loading flips true. Returns a promise that never rejects (errors land in the
 * snapshot).
 */
export function refresh<Data>(key: string, fetcher: () => Promise<Data>): Promise<Data | undefined> {
  const e = entry<Data>(key)
  if (e.promise) return e.promise
  return startFetch(key, fetcher)
}

export function retain(key: string): void {
  entry<unknown>(key).refs++
}

export function release(key: string): void {
  const e = entries.get(key)
  if (!e) return
  e.refs = Math.max(0, e.refs - 1)
  if (e.refs === 0) scheduleEviction()
}

function scheduleEviction(): void {
  if (evictionTimer !== null) return
  evictionTimer = setTimeout(() => {
    evictionTimer = null
    let changed = false
    for (const [k, e] of entries) {
      if (e.refs === 0) {
        entries.delete(k)
        changed = true
      }
    }
    if (changed) emit()
  }, GRACE_MS)
}

/** Drop the entry + cached snapshot and notify listeners (mutation invalidation). */
export function invalidate(key: string): void {
  entries.delete(key)
  emit()
}

/**
 * Write-through for WS-pushed payloads (or optimistic updates): replace the
 * entry data and bump the version so subscribers re-render, WITHOUT issuing a
 * fetch. Fetch fills the cache, push updates it — both pipelines converge on
 * the same key with no refetch storm.
 */
export function write<Data>(key: string, data: Data): void {
  const e = entry<Data>(key)
  e.data = data
  e.error = undefined
  e.fetchedAt = Date.now()
  e.loading = false
  e.promise = null
  emit()
}

/** Build a resource descriptor so a resolver and its invalidation stay colocated. */
export function resource<Data, Args extends unknown[]>(opts: ResourceOptions<Data, Args>): Resource<Data, Args> {
  const { key, fetch, maxAgeMs = 0 } = opts
  return {
    keyOf: (...args: Args) => key(...args),
    fetch,
    refresh: (...args: Args) => refresh(key(...args), () => fetch(...args)),
    invalidate: (...args: Args) => invalidate(key(...args)),
    write: (data: Data, ...args: Args) => write(key(...args), data),
    maxAgeMs,
  }
}

/** Test-only: wipe the module-level cache, pending timers, and snapshot cache. */
export function clearCache(): void {
  entries.clear()
  snapshotCache = new Map()
  lastSnapshotVersion = -1
  if (evictionTimer !== null) {
    clearTimeout(evictionTimer)
    evictionTimer = null
  }
  emit()
}
