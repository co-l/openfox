/**
 * Cumulative compaction summaries.
 *
 * When `context.allCompactionSummaries` is on, each compaction stores the new
 * window's seed summary as the previous window's stored seed plus a dated
 * marker and the fresh LLM summary (oldest first). The stored seed is exactly
 * what the LLM receives — no runtime projection.
 */

import type { SnapshotMessage } from '../events/types.js'

/** Local timestamp like `2026-09-25 13:22:49` (machine-local time, no zone). */
function localTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

/**
 * Build the stored seed summary for a new context window.
 *
 * @param llmSummary the fresh summary produced by this compaction
 * @param previousMerged the closed window's stored seed summary (null/empty on
 * the first compaction)
 * @param timestamp date of this compaction (defaults to the local time, e.g.
 * `2026-09-25 13:22:49`)
 */
export function mergeSummaryInto(llmSummary: string, previousMerged?: string | null, timestamp?: string): string {
  const ts = timestamp ?? localTimestamp()
  const marker = `## Compacted ${ts}`
  if (!previousMerged) return `${marker}\n${llmSummary}`
  return `${previousMerged}\n\n${marker}\n${llmSummary}`
}

/**
 * Find the most recent top-level compaction summary in a chronological message
 * list by scanning backwards. Because summaries are cumulative (each one
 * already contains all prior rounds), the latest one is by construction the
 * closed window's stored seed — no window-id matching needed.
 *
 * @returns the summary content, or null when none exists (first compaction)
 */
export function findLatestCompactionSummary(messages: SnapshotMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.isCompactionSummary && !message.subAgentId) {
      return message.content ?? null
    }
  }
  return null
}
