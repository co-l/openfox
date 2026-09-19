/**
 * Pure projection of the compaction history digest.
 *
 * Builds (or declines) the digest message content for a new context window
 * from the session's stored events. The digest is a deterministic function of
 * the message set + the digestRound decision — no rolling state, no read-back
 * of previous digests. See docs/DESIGN-CUMULATIVE-COMPACTION-SUMMARIES.md.
 */

import type { StoredEvent, SessionSnapshot, SnapshotMessage } from '../events/types.js'
import { applyTurnEventsToSnapshotMessages, foldTurnEventsToSnapshotMessages } from '../events/fold-messages.js'
import type { DigestEntry } from '../../shared/types.js'

export interface CompactionDigest {
  content: string
  entries: DigestEntry[]
}

interface SeedRound {
  round: number
  windowId: string
  messageId: string
  summarizedAt: string
  summary: string
}

function findInitialWindowId(events: StoredEvent[]): string {
  for (const event of events) {
    if (event.type === 'session.initialized') {
      return (event.data as { contextWindowId: string }).contextWindowId
    }
  }
  const snapshotEvent = [...events].reverse().find((event) => event.type === 'turn.snapshot')
  const sessionInit = (snapshotEvent?.data as { sessionInit?: { contextWindowId?: string } } | undefined)?.sessionInit
  return sessionInit?.contextWindowId ?? 'legacy-window-1'
}

/**
 * Rebuild the full cross-window message list the same way the snapshot
 * builder does (latest snapshot's messages + events after it), so the
 * projection is identical on the raw-event and snapshot-replay paths.
 */
function foldMessages(events: StoredEvent[]): SnapshotMessage[] {
  const snapshotEvent = [...events].reverse().find((event) => event.type === 'turn.snapshot')
  if (!snapshotEvent) {
    return foldTurnEventsToSnapshotMessages(events)
  }
  const snapshot = snapshotEvent.data as SessionSnapshot
  const laterEvents = events.filter((event) => event.seq > snapshotEvent.seq)
  return applyTurnEventsToSnapshotMessages(snapshot.messages, laterEvents)
}

/**
 * Build the digest for the window about to open.
 *
 * @param events all retained events for the session (pre-compaction)
 * @param digestRound 0 = off (no digest), -1 = all prior rounds, k >= 1 = most recent k
 * @param closedWindowId the window being closed by this compaction
 * @returns the digest, or null when nothing should be emitted (round 0, or no prior rounds)
 */
export function buildCompactionDigest(
  events: StoredEvent[],
  digestRound: number,
  closedWindowId: string,
): CompactionDigest | null {
  if (digestRound === 0) return null

  const initialWindowId = findInitialWindowId(events)
  const messages = foldMessages(events)

  const roundOf = new Map<string, number>([[initialWindowId, 1]])
  const windowOfRound = new Map<number, string>([[1, initialWindowId]])
  for (const m of messages) {
    if (m.subAgentId) continue
    const wid = m.contextWindowId ?? initialWindowId
    if (!roundOf.has(wid)) {
      roundOf.set(wid, roundOf.size + 1)
      windowOfRound.set(roundOf.size, wid)
    }
  }

  const seeds: SeedRound[] = []
  for (const m of messages) {
    if (!m.isCompactionSummary || m.subAgentId) continue
    const wid = m.contextWindowId ?? initialWindowId
    const round = (roundOf.get(wid) ?? 1) - 1
    if (round < 1) continue
    seeds.push({
      round,
      windowId: wid,
      messageId: m.id,
      summarizedAt: new Date(m.timestamp).toISOString(),
      summary: m.content,
    })
  }
  seeds.sort((a, b) => a.round - b.round)
  if (seeds.length === 0) return null

  const selected = digestRound === -1 ? seeds : seeds.slice(-digestRound)
  const truncated = digestRound !== -1 && seeds.length > selected.length
  const justCompacted = roundOf.get(closedWindowId) ?? seeds[seeds.length - 1]!.round + 1
  const roundWindowOf = (s: SeedRound): string => windowOfRound.get(s.round) ?? s.windowId

  const lines: string[] = ['Earlier parts of this conversation were compacted to save context.']
  if (truncated) {
    lines.push(
      `Note: only the most recent ${digestRound} round summaries are included below; earlier rounds were omitted.`,
    )
  } else {
    lines.push('Below are the compaction summaries of the previous rounds, oldest first.')
  }
  lines.push('')
  for (const s of selected) {
    lines.push(`## Round ${s.round} — summarized ${s.summarizedAt}`)
    lines.push(s.summary)
    lines.push('')
  }
  lines.push(
    `The message immediately after this one is the compaction summary of Round ${justCompacted} (the round that was just compacted). Continue from there.`,
  )

  return {
    content: lines.join('\n'),
    entries: selected.map((s) => ({
      round: s.round,
      windowId: roundWindowOf(s),
      messageId: s.messageId,
      summarizedAt: s.summarizedAt,
    })),
  }
}
