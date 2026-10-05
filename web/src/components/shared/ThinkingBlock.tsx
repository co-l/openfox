import { OptionalScrollArea } from './OptionalScrollArea'
import { memo } from 'react'
import { Markdown } from './Markdown'
import { useT } from '../../hooks/useT'
import { formatClockTime } from '../../lib/format-date'

interface ThinkingBlockProps {
  content: string
  /** End of the thinking phase (unix ms), shown at the bottom of the block. */
  endedAt?: number
  variant?: 'default' | 'labeled'
}

export const ThinkingBlock = memo(function ThinkingBlock({
  content,
  endedAt,
  variant = 'default',
}: ThinkingBlockProps) {
  const t = useT()
  if (variant === 'labeled') {
    return (
      <div className="text-text-muted text-sm italic feed-item">
        <span className="text-text-thinking">{t({ en: 'thinking:', fr: 'réflexion :' })}</span>
        <OptionalScrollArea horizontal className="ml-1.5 mt-0.5">
          <Markdown content={content} />
        </OptionalScrollArea>
      </div>
    )
  }

  return (
    <div className="feed-item">
      <OptionalScrollArea horizontal className="text-text-muted text-sm italic bg-secondary rounded p-1.5">
        <Markdown content={content} muted />
      </OptionalScrollArea>
      {endedAt !== undefined && (
        <div className="text-right text-[10px] text-text-muted">{formatClockTime(endedAt)}</div>
      )}
    </div>
  )
})
