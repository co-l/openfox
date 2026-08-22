import { appUrl } from './basePath'

/**
 * Session data prefetch, fired from the app entry before React mounts.
 * The session GET is the critical path of a page load (~600ms of React boot
 * happens before the store would normally issue it); starting it at boot
 * overlaps the fetch with boot and rendering. One-shot: loadSession consumes
 * the promise once, then falls back to its own fetch.
 */

type PrefetchResult = { ok: true; data: Record<string, unknown> } | { ok: false }

// Entries are only consumed by loadSession when the boot URL matches the
// loaded session; if the user navigates elsewhere first, the prefetch would
// linger forever. Expire it after a short TTL — loadSession's authFetch
// fallback takes over for any later load.
const PREFETCH_TTL_MS = 10_000

const pending = new Map<string, { promise: Promise<PrefetchResult>; expiresAt: number }>()

function gcPending(): void {
  const now = Date.now()
  for (const [id, entry] of pending) {
    if (entry.expiresAt < now) pending.delete(id)
  }
}

export function prefetchSession(sessionId: string): void {
  if (pending.has(sessionId)) return
  const token = localStorage.getItem('openfox_token')

  const promise: Promise<PrefetchResult> = fetch(appUrl(`/api/sessions/${sessionId}?history=recent`), {
    headers: token ? { 'x-session-token': token } : undefined,
  })
    .then(async (res): Promise<PrefetchResult> => {
      if (!res.ok) return { ok: false }
      return { ok: true, data: (await res.json()) as Record<string, unknown> }
    })
    .catch(() => ({ ok: false }))

  pending.set(sessionId, { promise, expiresAt: Date.now() + PREFETCH_TTL_MS })
  setTimeout(gcPending, PREFETCH_TTL_MS)
}

export function consumePrefetchedSession(sessionId: string): Promise<PrefetchResult> | undefined {
  const entry = pending.get(sessionId)
  if (!entry) return undefined
  pending.delete(sessionId)
  if (entry.expiresAt < Date.now()) {
    return undefined
  }
  return entry.promise
}
