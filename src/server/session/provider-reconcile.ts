/**
 * Session Provider Reconciliation
 *
 * A session pins the provider it runs on by id. Nothing used to clear that pin when the
 * provider was deleted, so the session kept an id that no longer resolves: the context
 * window silently fell back to the global default (wrong denominator in the UI, which can
 * trip auto-compaction) and the provider badge rendered as remote for a local provider.
 *
 * Clearing the pin puts the session back on the global provider, which is what an unpinned
 * session already does.
 */

import { listSessions, updateSessionProvider } from '../db/sessions.js'

function clearSessionProviderWhere(isDangling: (providerId: string) => boolean): number {
  let cleared = 0
  for (const session of listSessions()) {
    if (session.providerId && isDangling(session.providerId)) {
      updateSessionProvider(session.id, null, null)
      cleared++
    }
  }
  return cleared
}

/**
 * Clear the provider pin of every session that referenced a provider being deleted.
 * Returns how many sessions were cleared.
 */
export function clearSessionsForDeletedProvider(providerId: string): number {
  return clearSessionProviderWhere((pinned) => pinned === providerId)
}

/**
 * Clear provider pins that no longer match a configured provider. Runs at startup to repair
 * sessions orphaned before the delete cascade existed, or by a hand-edited config.
 * Returns how many sessions were repaired.
 */
export function reconcileSessionProviders(configuredProviderIds: readonly string[]): number {
  const configured = new Set(configuredProviderIds)
  return clearSessionProviderWhere((pinned) => !configured.has(pinned))
}
