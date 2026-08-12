import { memo, useEffect, useRef, useState } from 'react'
import type { OverlayScrollbarsComponentRef } from 'overlayscrollbars-react'
import type { DisplayItem } from './groupMessages.js'
import { ChatMessage } from './ChatMessage'
import { AssistantMessage } from './AssistantMessage'
import { SubAgentContainer } from './SubAgentContainer'
import { FEED_REVEAL_EVENT } from './feed-window'
import { useDisplaySettings } from '../../stores/settings'

const ITEM_CONTAINMENT_STYLE = { contentVisibility: 'auto', containIntrinsicSize: 'auto 200px' } as const
const PLACEHOLDER_STYLE = { contentVisibility: 'auto', containIntrinsicSize: '160px', minHeight: '160px' } as const

// Bottom-anchored virtualization: only the most recent items are mounted at
// load, older items are revealed in batches as the user scrolls up.
const INITIAL_RENDER_COUNT = 30
const REVEAL_BATCH_SIZE = 20
const REVEAL_MARGIN = 10
const BULK_APPEND_THRESHOLD = 5

interface ChatFeedItemsProps {
  displayItems: DisplayItem[]
  highlightedMessageId?: string | null
  sessionId?: string | null
  scrollContainerRef?: React.RefObject<OverlayScrollbarsComponentRef<'div'> | null>
  showThinking?: boolean
  showVerboseToolOutput?: boolean
  showStats?: boolean
  showAgentDefinitions?: boolean
  showWorkflowBars?: boolean
}

function itemKey(item: DisplayItem): string {
  if (item.type === 'context-divider') return `ctx-${item.windowSequence}`
  if (item.type === 'subagent') return item.messages[0]?.id ?? item.subAgentId
  return item.message.id
}

export const ChatFeedItems = memo(function ChatFeedItems({
  displayItems,
  highlightedMessageId = null,
  sessionId,
  scrollContainerRef,
  showThinking = true,
  showVerboseToolOutput = true,
  showStats = true,
  showAgentDefinitions = true,
  showWorkflowBars = true,
}: ChatFeedItemsProps) {
  const totalItems = displayItems.length
  const { feedVirtualization } = useDisplaySettings()
  // Absolute index of the first mounted item. New items appended at the end
  // (streaming) keep the window stable — only the reveal moves it up.
  const [startIndex, setStartIndex] = useState(() => Math.max(0, totalItems - INITIAL_RENDER_COUNT))
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const prevItemCountRef = useRef(displayItems.length)
  const userScrolledRef = useRef(false)
  // Virtualization is opt-in: off by default, the full feed renders as before.
  const displayStart = feedVirtualization ? startIndex : 0
  // Only virtualized feeds get content-visibility containment. Off-screen it
  // freezes element heights at the last-known intrinsic size, so applying it to
  // dynamically-mutating content (streaming LLM output) leaves stale phantom
  // gaps below messages. Non-virtualized feeds render at natural height.
  const itemContainmentStyle = feedVirtualization ? ITEM_CONTAINMENT_STYLE : undefined

  // Reset the virtual window when switching sessions.
  useEffect(() => {
    if (!feedVirtualization) return
    setStartIndex(Math.max(0, displayItems.length - INITIAL_RENDER_COUNT))
    userScrolledRef.current = false
  }, [sessionId])

  // Re-anchor the window when a large batch of items arrives at once (initial
  // history load). Single-item streaming appends keep the window stable, and
  // so does a bulk replay after WS reconnect when the user has scrolled into
  // history — jumping back to the bottom would yank the viewport away.
  useEffect(() => {
    const prev = prevItemCountRef.current
    prevItemCountRef.current = displayItems.length
    if (!feedVirtualization) return
    if (displayItems.length - prev >= BULK_APPEND_THRESHOLD && !userScrolledRef.current) {
      setStartIndex(Math.max(0, displayItems.length - INITIAL_RENDER_COUNT))
    }
  }, [displayItems.length, feedVirtualization])

  // Clamp when items are removed (truncation, session switch).
  useEffect(() => {
    if (!feedVirtualization) return
    if (startIndex > 0 && startIndex >= displayItems.length) {
      setStartIndex(Math.max(0, displayItems.length - INITIAL_RENDER_COUNT))
    }
  }, [displayItems.length, startIndex, feedVirtualization])

  // Reveal older items in batches while the sentinel approaches the viewport.
  // The bottom-expanded rootMargin triggers before the user reaches the
  // placeholder region, so scrolling up never exposes gaps.
  useEffect(() => {
    if (!feedVirtualization) return
    if (startIndex <= 0 || typeof IntersectionObserver === 'undefined') return
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setStartIndex((index) => Math.max(0, index - REVEAL_BATCH_SIZE))
        }
      },
      { rootMargin: '0px 0px 300px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [startIndex, feedVirtualization])

  // When the user reaches the very top, keep revealing until everything is
  // mounted — the sentinel can end up below remaining placeholders, out of the
  // observer margin, leaving unmounted gaps at the top of the list. Only runs
  // after the user has scrolled the container (not during the initial
  // bottom-anchor scroll).
  const startIndexRef = useRef(startIndex)
  startIndexRef.current = startIndex

  useEffect(() => {
    if (!feedVirtualization) return
    const container = scrollContainerRef?.current
    if (!container) return
    const viewport = container.osInstance?.()?.elements().viewport
    if (!viewport) return
    const onScroll = () => {
      if (viewport.scrollTop > 4) {
        userScrolledRef.current = true
        return
      }
      if (startIndexRef.current > 0) {
        setStartIndex((index) => Math.max(0, index - REVEAL_BATCH_SIZE))
      }
    }
    viewport.addEventListener('scroll', onScroll, { passive: true })
    return () => viewport.removeEventListener('scroll', onScroll)
  }, [scrollContainerRef, feedVirtualization])

  useEffect(() => {
    if (!feedVirtualization) return
    if (startIndex <= 0 || !userScrolledRef.current) return
    const container = scrollContainerRef?.current
    const viewport = container?.osInstance?.()?.elements().viewport
    if (viewport && viewport.scrollTop <= 4) {
      setStartIndex((index) => Math.max(0, index - REVEAL_BATCH_SIZE))
    }
  }, [startIndex, scrollContainerRef, feedVirtualization])

  // Timeline navigation: reveal up to a target index when asked. This is the
  // only active reveal path — highlightedMessageId (ChatFeedItems) has no
  // non-null caller today, so any future highlight must reveal the target via
  // this event first (see PlanPanel's MessageList usage).
  useEffect(() => {
    if (!feedVirtualization) return
    const onRevealRequest = (event: Event) => {
      const index = (event as CustomEvent<{ index: number }>).detail?.index
      if (typeof index !== 'number') return
      setStartIndex((current) => Math.min(current, Math.max(0, index - REVEAL_MARGIN)))
    }
    window.addEventListener(FEED_REVEAL_EVENT, onRevealRequest)
    return () => window.removeEventListener(FEED_REVEAL_EVENT, onRevealRequest)
  }, [feedVirtualization])

  const visibleItems = displayItems.slice(displayStart)

  return (
    <>
      {displayStart > 0 && (
        <>
          <div
            className="flex items-center justify-center gap-2 py-3 text-xs text-text-muted"
            data-testid="feed-unmounted-hint"
          >
            Scroll up to load {displayStart} older item{displayStart !== 1 ? 's' : ''}
          </div>
          {Array.from({ length: displayStart }, (_, i) => (
            <div key={`ph-${i}`} data-item-index={i} data-placeholder style={PLACEHOLDER_STYLE} />
          ))}
          <div ref={sentinelRef} data-testid="feed-sentinel" style={{ height: 1 }} />
        </>
      )}
      {visibleItems.map((item, index) => {
        const displayIndex = displayStart + index
        if (item.type === 'context-divider') {
          return (
            <div
              key={itemKey(item)}
              data-item-index={displayIndex}
              className="flex items-center gap-2 feed-item px-2 @md:px-4"
            >
              <div className="flex-1 border-t border-border" />
              <span className="text-[10px] text-text-muted font-medium px-2">Earlier context summarized</span>
              <div className="flex-1 border-t border-border" />
            </div>
          )
        }

        if (item.type === 'subagent') {
          const groupIsStreaming = item.messages.some((m) => m.isStreaming)
          return (
            <div
              key={itemKey(item)}
              data-item-index={displayIndex}
              className="px-2 @md:px-4"
              style={itemContainmentStyle}
            >
              <SubAgentContainer
                messages={item.messages}
                subAgentType={item.subAgentType}
                subAgentId={item.subAgentId}
                isStreaming={groupIsStreaming}
              />
            </div>
          )
        }

        const message = item.message
        if (message.role === 'assistant') {
          return (
            <div
              key={itemKey(item)}
              data-item-index={displayIndex}
              className="px-2 @md:px-4"
              style={itemContainmentStyle}
            >
              <AssistantMessage
                message={message}
                showStats={showStats}
                showThinking={showThinking}
                showVerboseToolOutput={showVerboseToolOutput}
                sessionId={sessionId ?? undefined}
              />
            </div>
          )
        }

        const skipAutoPrompt = !showAgentDefinitions && message.messageKind === 'auto-prompt'
        const skipWorkflow =
          !showWorkflowBars && (message.messageKind === 'workflow-started' || message.messageKind === 'task-completed')
        if (skipAutoPrompt || skipWorkflow) {
          return null
        }

        return (
          <div
            key={itemKey(item)}
            data-item-index={displayIndex}
            className="px-2 @md:px-4"
            style={itemContainmentStyle}
          >
            <div
              data-message-id={message.id}
              className={highlightedMessageId === message.id ? 'rounded animate-highlight-fade' : undefined}
            >
              <ChatMessage
                message={message}
                messageId={message.id}
                sessionId={sessionId ?? undefined}
                isLastAssistantMessage={false}
              />
            </div>
          </div>
        )
      })}
    </>
  )
})
