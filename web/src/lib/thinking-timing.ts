interface ThinkingTimingEntry {
  start: number
  end?: number
}

// Client-side thinking timing, keyed by message id. The start is latched by
// the session store when the first `chat.thinking` payload arrives for a
// message during a live stream; the end is latched when the first
// non-thinking output (text delta or tool preparing) arrives — and, if that
// was never observed live, when the summary first renders after the thinking
// finished. This bridges the gap between the live "Thinking…" state and the
// authoritative server-measured duration that lands with the message stats at
// turn end (and survives page reloads). Keeping it at module scope lets the
// timing survive scroll-driven remounts and session switches within a page
// session; the latched end additionally feeds the block end-time display, so
// entries are retained (bounded by the cap) rather than cleared when the
// server duration arrives.
const thinkingTiming = new Map<string, ThinkingTimingEntry>()
// Bound the map: entries for messages that never receive a server-measured
// duration (aborted turns, brief thinking, no stats) are never evicted on
// their own, so cap the total to keep memory bounded over long sessions.
const MAX_THINKING_TIMING_ENTRIES = 500

/** Latch the thinking start for a message; idempotent — the first latch wins. */
export function latchThinkingStart(messageId: string): number {
  const existing = thinkingTiming.get(messageId)
  if (existing) return existing.start
  if (thinkingTiming.size >= MAX_THINKING_TIMING_ENTRIES) {
    const oldest = thinkingTiming.keys().next().value
    if (oldest !== undefined) thinkingTiming.delete(oldest)
  }
  const entry: ThinkingTimingEntry = { start: Date.now() }
  thinkingTiming.set(messageId, entry)
  return entry.start
}

export function getThinkingStart(messageId: string): number | undefined {
  return thinkingTiming.get(messageId)?.start
}

/** The latched thinking end (unix ms), or undefined until latched. */
export function getThinkingEnd(messageId: string): number | undefined {
  return thinkingTiming.get(messageId)?.end
}

/** Latch the thinking end; returns the elapsed time in seconds, or undefined if no start was latched. */
export function latchThinkingEnd(messageId: string): number | undefined {
  const entry = thinkingTiming.get(messageId)
  if (!entry) return undefined
  if (entry.end === undefined) entry.end = Date.now()
  return (entry.end - entry.start) / 1000
}
