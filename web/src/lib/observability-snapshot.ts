/**
 * Helpers to extract an observability-friendly subset of the session
 * snapshot exposed by the OpenFox client store.
 */

import type { ObservabilitySnapshot, Session } from '@shared/types.js'

/**
 * Returns a minimal ObservabilitySnapshot extracted from the client
 * session. Compaction records are derived from `session.contextWindows`.
 * Pattern retry records are not available client-side today; callers
 * can add them when the snapshot stream exposes format retries.
 */
export function extractSnapshot(session: Session | null | undefined): ObservabilitySnapshot | null {
  if (!session) return null
  const contextWindows = (session.contextWindows ?? []).map((w) => ({
    timestamp: new Date(w.closedAt ?? w.createdAt).getTime(),
    closedWindowId: w.id,
    newWindowId: w.id,
    beforeTokens: w.tokenCountAtClose ?? 0,
    afterTokens: 0,
    reduction: w.tokenCountAtClose ?? 0,
    reductionPercent: 100,
  }))
  return {
    contextWindows,
  }
}
