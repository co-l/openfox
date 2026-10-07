import { memo, useRef, useState } from 'react'
import { useT } from '../../hooks/useT'
import { ThinkingBlock } from './ThinkingBlock'
import { ThinkingSummary } from './ThinkingSummary'

// Per-message expand overrides, keyed by message id, so a manual toggle
// survives scroll-driven remounts within a session. Absent an override, the
// display setting picks the default state.
const expandOverrides = new Map<string, boolean>()
const MAX_EXPAND_OVERRIDES = 500

interface ThinkingBlockToggleProps {
  messageId: string
  content: string
  isStreaming: boolean
  thinkingFinished: boolean
  /** Authoritative server-measured thinking duration (seconds), from message.stats. */
  thinkingDuration?: number
  showThinking: boolean
}

export const ThinkingBlockToggle = memo(function ThinkingBlockToggle({
  messageId,
  content,
  isStreaming,
  thinkingFinished,
  thinkingDuration,
  showThinking,
}: ThinkingBlockToggleProps) {
  const t = useT()
  const containerRef = useRef<HTMLDivElement>(null)
  const [, forceRender] = useState(0)
  const expanded = expandOverrides.get(messageId) ?? showThinking

  // A click that ends a text selection inside the block is a selection
  // gesture, not a collapse gesture — skip the toggle. A selection anchored
  // outside (e.g. from a previous copy) must not block collapsing.
  const handleClick = () => {
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) {
      const anchor = selection.anchorNode
      if (anchor && containerRef.current?.contains(anchor)) return
    }
    toggle()
  }

  const toggle = () => {
    if (!expandOverrides.has(messageId) && expandOverrides.size >= MAX_EXPAND_OVERRIDES) {
      const oldest = expandOverrides.keys().next().value
      if (oldest !== undefined) expandOverrides.delete(oldest)
    }
    expandOverrides.set(messageId, !expanded)
    forceRender((n) => n + 1)
  }

  return (
    <div
      ref={containerRef}
      className="cursor-pointer"
      onClick={handleClick}
      title={t({ en: 'Click to toggle thinking', fr: 'Cliquer pour afficher/masquer la réflexion' })}
      aria-expanded={expanded}
    >
      {expanded ? (
        <ThinkingBlock content={content} isStreaming={isStreaming && !thinkingFinished} />
      ) : (
        <ThinkingSummary
          messageId={messageId}
          isStreaming={isStreaming}
          thinkingFinished={thinkingFinished}
          thinkingDuration={thinkingDuration}
        />
      )}
    </div>
  )
})
