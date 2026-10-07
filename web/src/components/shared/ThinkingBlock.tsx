import { OptionalScrollArea } from './OptionalScrollArea'
import { memo } from 'react'
import { Markdown } from './Markdown'
import { useT } from '../../hooks/useT'

interface ThinkingBlockProps {
  content: string
  variant?: 'default' | 'labeled'
  /** The reasoning is still being written: parse it block by block like a streaming answer. */
  isStreaming?: boolean
}

export const ThinkingBlock = memo(function ThinkingBlock({
  content,
  variant = 'default',
  isStreaming = false,
}: ThinkingBlockProps) {
  const t = useT()
  if (variant === 'labeled') {
    return (
      <div className="text-text-muted text-sm italic feed-item">
        <span className="text-text-thinking">{t({ en: 'thinking:', fr: 'réflexion :' })}</span>
        <OptionalScrollArea horizontal className="ml-1.5 mt-0.5">
          <Markdown content={content} isStreaming={isStreaming} />
        </OptionalScrollArea>
      </div>
    )
  }

  return (
    <OptionalScrollArea horizontal className="text-text-muted text-sm italic bg-secondary rounded p-1.5 feed-item">
      <Markdown content={content} muted isStreaming={isStreaming} />
    </OptionalScrollArea>
  )
})
