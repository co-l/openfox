import { memo, useEffect, useState } from 'react'
import { useT } from '../../hooks/useT'
import { formatTime } from '../../lib/format-stats'
import { formatClockTime } from '../../lib/format-date'
import { getThinkingEnd, getThinkingStart, latchThinkingEnd, latchThinkingStart } from '../../lib/thinking-timing'

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
  const startedAt = getThinkingStart(messageId)
  // Sub-10s the timer shows tenths (e.g. "7.8s"), so it needs to tick every
  // 100ms; past 10s whole seconds are enough.
  const fastTicking = now - (startedAt ?? now) < 10_000

  useEffect(() => {
    if (thinkingDuration !== undefined) {
      setClientDuration(undefined)
      return
    }
    if (isStreaming && !thinkingFinished) {
      latchThinkingStart(messageId)
      const timer = setInterval(() => setNow(Date.now()), fastTicking ? 100 : 1000)
      return () => clearInterval(timer)
    }
    setClientDuration(latchThinkingEnd(messageId))
  }, [messageId, isStreaming, thinkingFinished, thinkingDuration, fastTicking])

  // A collapsed thinking block must always render something: an empty chip
  // would make the block vanish from the feed, with no click target left to
  // expand it again.
  if (isStreaming && !thinkingFinished) {
    const elapsedSec = (now - (startedAt ?? now)) / 1000
    return (
      <div className="text-text-muted text-sm italic bg-secondary rounded p-1.5 feed-item">
        {t({ en: 'Thinking… ({{time}})', fr: 'Réflexion… ({{time}})' }, { time: formatTime(elapsedSec) })}
      </div>
    )
  }

  const durationSec = thinkingDuration ?? clientDuration
  const endAt = getThinkingEnd(messageId)
  const endClock = endAt !== undefined ? formatClockTime(endAt) : undefined
  const label =
    durationSec !== undefined
      ? endClock !== undefined
        ? t(
            { en: 'Thought for {{time}} · {{end}}', fr: 'A réfléchi pendant {{time}} · {{end}}' },
            { time: formatTime(durationSec), end: endClock },
          )
        : t({ en: 'Thought for {{time}}', fr: 'A réfléchi pendant {{time}}' }, { time: formatTime(durationSec) })
      : endClock !== undefined
        ? t({ en: 'Thought · {{end}}', fr: 'A réfléchi · {{end}}' }, { end: endClock })
        : t({ en: 'Thought', fr: 'A réfléchi' })
  return <div className="text-text-muted text-sm italic bg-secondary rounded p-1.5 feed-item">{label}</div>
})
