import { memo, useEffect, useState } from 'react'
import { useT } from '../../hooks/useT'
import { formatTime } from '../../lib/format-stats'

interface ThinkingTimingEntry {
  start: number
  end?: number
}

// Client-side thinking timing, keyed by message id. The start is latched when
// the indicator first appears during a live stream; the end is latched when the
// first non-thinking output arrives. This bridges the gap between the live
// "Thinking…" state and the authoritative server-measured duration that lands
// with the message stats at turn end (and survives page reloads). Keeping it at
// module scope lets the timing survive scroll-driven remounts within a session.
const thinkingTiming = new Map<string, ThinkingTimingEntry>()
// Bound the map: entries for messages that never receive a server-measured
// duration (aborted turns, brief thinking, no stats) are never evicted on their
// own, so cap the total to keep memory bounded over long sessions.
const MAX_THINKING_TIMING_ENTRIES = 500

function ensureThinkingStart(messageId: string): number {
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

function latchThinkingEnd(messageId: string): number | undefined {
  const entry = thinkingTiming.get(messageId)
  if (!entry) return undefined
  if (entry.end === undefined) entry.end = Date.now()
  return (entry.end - entry.start) / 1000
}

interface ThinkingSummaryProps {
  messageId: string
  isStreaming: boolean
  thinkingFinished: boolean
  /** Authoritative server-measured thinking duration (seconds), from message.stats. */
  thinkingDuration?: number
}

export const ThinkingSummary = memo(function ThinkingSummary({
  messageId,
  isStreaming,
  thinkingFinished,
  thinkingDuration,
}: ThinkingSummaryProps) {
  const t = useT()
  const [now, setNow] = useState(() => Date.now())
  const [clientDuration, setClientDuration] = useState<number | undefined>()
  const startedAt = thinkingTiming.get(messageId)?.start
  // Sub-10s the timer shows tenths (e.g. "7.8s"), so it needs to tick every
  // 100ms; past 10s whole seconds are enough.
  const fastTicking = now - (startedAt ?? now) < 10_000

  useEffect(() => {
    if (thinkingDuration !== undefined) {
      thinkingTiming.delete(messageId)
      setClientDuration(undefined)
      return
    }
    if (isStreaming && !thinkingFinished) {
      ensureThinkingStart(messageId)
      const timer = setInterval(() => setNow(Date.now()), fastTicking ? 100 : 1000)
      return () => clearInterval(timer)
    }
    setClientDuration(latchThinkingEnd(messageId))
  }, [messageId, isStreaming, thinkingFinished, thinkingDuration, fastTicking])

  const durationSec = thinkingDuration ?? clientDuration
  if (durationSec !== undefined) {
    return (
      <div className="text-text-muted text-sm italic bg-secondary rounded p-1.5 feed-item">
        {t({ en: 'Thought for {{time}}', fr: 'A réfléchi pendant {{time}}' }, { time: formatTime(durationSec) })}
      </div>
    )
  }

  if (!isStreaming || thinkingFinished) return null

  const elapsedSec = (now - (startedAt ?? now)) / 1000
  return (
    <div className="text-text-muted text-sm italic bg-secondary rounded p-1.5 feed-item">
      {t({ en: 'Thinking… ({{time}})', fr: 'Réflexion… ({{time}})' }, { time: formatTime(elapsedSec) })}
    </div>
  )
})
