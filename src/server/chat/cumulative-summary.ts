/**
 * Cumulative compaction summaries.
 *
 * When `context.allCompactionSummaries` is on, each compaction stores the new
 * window's seed summary as the previous window's stored seed plus a dated
 * marker and the fresh LLM summary (oldest first). The stored seed is exactly
 * what the LLM receives — no runtime projection.
 */

import type { SnapshotMessage } from '../events/types.js'

/**
 * Build the stored seed summary for a new context window.
 *
 * @param llmSummary the fresh summary produced by this compaction
 * @param previousMerged the closed window's stored seed summary (null/empty on
 * the first compaction)
 * @param timestamp ISO date of this compaction (defaults to now)
 */
export function mergeSummaryInto(llmSummary: string, previousMerged?: string | null, timestamp?: string): string {
  const ts = timestamp ?? new Date().toISOString()
  const marker = `## Compacted ${ts}`
  if (!previousMerged) return `${marker}\n${llmSummary}`
  return `${previousMerged}\n\n${marker}\n${llmSummary}`
}

/**
 * Find the stored compaction summary of a context window in a folded message
 * list (snapshot-aware, so it survives event GC).
 *
 * @returns the summary content, or null when the window has none (first window)
 */
export function findWindowSummary(messages: SnapshotMessage[], windowId: string): string | null {
  for (const m of messages) {
    if (m.isCompactionSummary && !m.subAgentId && m.contextWindowId === windowId) {
      return m.content ?? null
    }
  }
  return null
}
