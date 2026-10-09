import { memo, useEffect, useRef, useState } from 'react'
import type { OverlayScrollbarsComponentRef } from 'overlayscrollbars-react'
import type { DisplayItem } from './groupMessages.js'
import { ChatMessage } from './ChatMessage'
import { AssistantMessage } from './AssistantMessage'
import { SubAgentContainer } from './SubAgentContainer'
import { FeedDivider } from './FeedDivider'
import { FEED_REVEAL_EVENT } from './feed-window'
import { useDisplaySettings } from '../../hooks/useDisplaySettings'
import { useT } from '../../hooks/useT'

const ITEM_CONTAINMENT_STYLE = { contentVisibility: 'auto', containIntrinsicSize: 'auto 200px' } as const
const PLACEHOLDER_STYLE = { contentVisibility: 'auto', containIntrinsicSize: '160px', minHeight: '160px' } as const

// Bottom-anchored virtualization: only the most recent items are mounted at
// load, older items are revealed in batches as the user scrolls up.
const INITIAL_RENDER_COUNT = 30
const REVEAL_BATCH_SIZE = 20
const REVEAL_MARGIN = 10
const BULK_APPEND_THRESHOLD = 5
// How close to the top the feed has to get before older items are revealed.
// A "scrollTop === 0" trigger is useless: the feed is pinned to the bottom, so
// reaching the hard stop means traversing every placeholder first — and the
// unmounted hint is already visible well before that.
const REVEAL_TOP_THRESHOLD_PX = 240

interface ChatFeedItemsProps {
  displayItems: DisplayItem[]
  highlightedMessageId?: string | null
  sessionId?: string | null
  scrollContainerRef?: React.RefObject<OverlayScrollbarsComponentRef<'div'> | null>
  /**
   * Whether auto-scroll is currently pinned to the newest items. This is the
   * authoritative "is the user following the stream?" signal: it is already
   * false whenever the user scrolls into history, and — unlike a scroll
   * position check — it is not tripped by auto-scroll's own programmatic
   * scrolls or by content growing between two animation frames.
   */
  isAutoScrollActive?: boolean
  showThinking?: boolean
  showVerboseToolOutput?: boolean
  showStats?: boolean
  showAgentDefinitions?: boolean
  showWorkflowBars?: boolean
  /**
   * Overrides the feedVirtualization setting for the windowing (hint,
   * placeholders, reveal triggers). Containment still follows the setting.
   */
  virtualization?: boolean
  /**
   * Which end of the feed the initial window is pinned to. 'bottom' (default)
   * mounts the most recent items and reveals older ones while scrolling up —
   * the live feed. 'top' mounts the earliest items and reveals newer ones
   * while scrolling down — top-anchored views (readonly full history) that
   * open at scrollTop 0, where the bottom-anchored reveal can never fire.
   * Top-anchored windowing is independent of the feedVirtualization setting:
   * the readonly view must stay bounded on arbitrarily large sessions.
   */
  anchored?: 'bottom' | 'top'
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
  isAutoScrollActive = true,
  showThinking = true,
  showVerboseToolOutput = true,
  showStats = true,
  showAgentDefinitions = true,
  showWorkflowBars = true,
  virtualization,
  anchored = 'bottom',
}: ChatFeedItemsProps) {
  const t = useT()
  const totalItems = displayItems.length
  const { feedVirtualization } = useDisplaySettings()
  const topAnchored = anchored === 'top'
  const windowing = topAnchored || (virtualization ?? feedVirtualization)
  // Bottom-anchored: absolute index of the first mounted item. New items
  // appended at the end (streaming) keep the window stable — only the reveal
  // moves it up.
  const [startIndex, setStartIndex] = useState(() => Math.max(0, totalItems - INITIAL_RENDER_COUNT))
  // Top-anchored: index of the first unmounted item. The initial window is
  // the earliest items; the reveal moves it down as the reader scrolls.
  const [endIndex, setEndIndex] = useState(() => Math.min(totalItems, INITIAL_RENDER_COUNT))
  const endIndexRef = useRef(endIndex)
  endIndexRef.current = endIndex
  const totalItemsRef = useRef(totalItems)
  totalItemsRef.current = totalItems
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const sentinelNewerRef = useRef<HTMLDivElement | null>(null)
  const prevItemCountRef = useRef(displayItems.length)
  const userScrolledRef = useRef(false)
  const displayStart = windowing && !topAnchored ? startIndex : 0
  const displayEnd = topAnchored ? Math.min(totalItems, endIndex) : totalItems
  // Only virtualized feeds get content-visibility containment. Off-screen it
  // freezes element heights at the last-known intrinsic size, so applying it to
  // dynamically-mutating content (streaming LLM output) leaves stale phantom
  // gaps below messages. The bottom-anchored feed follows the setting (even
  // when windowing is overridden off, per the setting's contract); the
  // top-anchored (readonly) feed is immutable content, so containment always
  // applies there.
  const itemContainmentStyle = topAnchored || feedVirtualization ? ITEM_CONTAINMENT_STYLE : undefined

  // Reset the bottom-anchored window when switching sessions. The dependency
  // list intentionally omits the item count: a mid-session length change must
  // not re-anchor a reader who is scrolled into history.
  useEffect(() => {
    if (!windowing || topAnchored) return
    setStartIndex(Math.max(0, displayItems.length - INITIAL_RENDER_COUNT))
    userScrolledRef.current = false
  }, [sessionId, windowing, topAnchored])

  // Reset the top-anchored window when the session (or its size) changes.
  useEffect(() => {
    if (!topAnchored) return
    setEndIndex(Math.min(displayItems.length, INITIAL_RENDER_COUNT))
  }, [sessionId, windowing, topAnchored, displayItems.length])

  // Re-anchor the window to the newest items. This has to cover three cases:
  // a bulk history load, a session that started empty and grew by single
  // streaming appends (where the initial `totalItems - INITIAL_RENDER_COUNT`
  // was clamped to 0 and would otherwise never establish a window), and a
  // window that drifted past the render count as items accumulated.
  // Only while the feed follows the bottom: re-anchoring under a reader who
  // scrolled into history would yank the viewport away.
  useEffect(() => {
    const prev = prevItemCountRef.current
    prevItemCountRef.current = displayItems.length
    if (!windowing || topAnchored) return
    if (!isAutoScrollActive) return
    const length = displayItems.length
    const bulkAppend = length - prev >= BULK_APPEND_THRESHOLD
    setStartIndex((current) => {
      const drifted = length - current > INITIAL_RENDER_COUNT
      if (!bulkAppend && !drifted) return current
      return Math.max(0, length - INITIAL_RENDER_COUNT)
    })
  }, [displayItems.length, windowing, topAnchored, isAutoScrollActive])

  // Clamp when items are removed (truncation, session switch).
  useEffect(() => {
    if (!windowing || topAnchored) return
    if (startIndex > 0 && startIndex >= displayItems.length) {
      setStartIndex(Math.max(0, displayItems.length - INITIAL_RENDER_COUNT))
    }
  }, [displayItems.length, startIndex, windowing, topAnchored])

  // Top-anchored: clamp when items are removed, and keep the window at least
  // the initial render count once the feed has grown past it.
  useEffect(() => {
    if (!topAnchored) return
    setEndIndex((current) => {
      const clamped = Math.min(current, displayItems.length)
      return Math.max(clamped, Math.min(displayItems.length, INITIAL_RENDER_COUNT))
    })
  }, [displayItems.length, topAnchored])

  // Reveal older items in batches while the sentinel approaches the viewport.
  // The bottom-expanded rootMargin triggers before the user reaches the
  // placeholder region, so scrolling up never exposes gaps.
  useEffect(() => {
    if (!windowing || topAnchored) return
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
  }, [startIndex, windowing, topAnchored])

  // Top-anchored: reveal newer items in batches while the sentinel below the
  // mounted region approaches the viewport.
  useEffect(() => {
    if (!topAnchored || typeof IntersectionObserver === 'undefined') return
    if (endIndex >= totalItems) return
    const sentinel = sentinelNewerRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setEndIndex((index) => Math.min(totalItemsRef.current, index + REVEAL_BATCH_SIZE))
        }
      },
      { rootMargin: '0px 0px 300px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [endIndex, totalItems, topAnchored])

  // When the user reaches the very top, keep revealing until everything is
  // mounted — the sentinel can end up below remaining placeholders, out of the
  // observer margin, leaving unmounted gaps at the top of the list. Only runs
  // after the user has scrolled the container (not during the initial
  // bottom-anchor scroll).
  const startIndexRef = useRef(startIndex)
  startIndexRef.current = startIndex

  useEffect(() => {
    if (!windowing || topAnchored) return
    // Resolve the viewport inside the handler, not while attaching. The
    // OverlayScrollbars instance is created in a passive effect of the feed's
    // ScrollArea, and React runs child effects first — so at attach time
    // `osInstance()` is still undefined and the listener would silently never
    // be added. A capture listener on the document sees every scroll event,
    // including the feed viewport's (scroll events do not bubble).
    const onScroll = (event: Event) => {
      const viewport = scrollContainerRef?.current?.osInstance?.()?.elements().viewport
      if (!viewport || event.target !== viewport) return
      if (viewport.scrollTop > REVEAL_TOP_THRESHOLD_PX) {
        userScrolledRef.current = true
        return
      }
      if (startIndexRef.current > 0) {
        setStartIndex((index) => Math.max(0, index - REVEAL_BATCH_SIZE))
      }
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => document.removeEventListener('scroll', onScroll, { capture: true })
  }, [scrollContainerRef, windowing, topAnchored])

  useEffect(() => {
    if (!windowing || topAnchored) return
    if (startIndex <= 0 || !userScrolledRef.current) return
    const container = scrollContainerRef?.current
    const viewport = container?.osInstance?.()?.elements().viewport
    if (viewport && viewport.scrollTop <= REVEAL_TOP_THRESHOLD_PX) {
      setStartIndex((index) => Math.max(0, index - REVEAL_BATCH_SIZE))
    }
  }, [startIndex, scrollContainerRef, windowing, topAnchored])

  // Top-anchored: keep revealing newer items once the reader gets close to
  // the bottom of the mounted region — the sentinel can end up above the
  // remaining placeholders, out of the observer margin.
  useEffect(() => {
    if (!topAnchored) return
    const onScroll = (event: Event) => {
      const viewport = scrollContainerRef?.current?.osInstance?.()?.elements().viewport
      if (!viewport || event.target !== viewport) return
      const gapToBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      if (gapToBottom > REVEAL_TOP_THRESHOLD_PX) return
      if (endIndexRef.current < totalItemsRef.current) {
        setEndIndex((index) => Math.min(totalItemsRef.current, index + REVEAL_BATCH_SIZE))
      }
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => document.removeEventListener('scroll', onScroll, { capture: true })
  }, [scrollContainerRef, topAnchored])

  // Timeline navigation: reveal up to a target index when asked. This is the
  // only active reveal path — highlightedMessageId (ChatFeedItems) has no
  // non-null caller today, so any future highlight must reveal the target via
  // this event first (see PlanPanel's MessageList usage).
  useEffect(() => {
    if (!windowing) return
    const onRevealRequest = (event: Event) => {
      const index = (event as CustomEvent<{ index: number }>).detail?.index
      if (typeof index !== 'number') return
      if (topAnchored) {
        setEndIndex((current) => Math.max(current, Math.min(totalItemsRef.current, index + REVEAL_MARGIN + 1)))
      } else {
        setStartIndex((current) => Math.min(current, Math.max(0, index - REVEAL_MARGIN)))
      }
    }
    window.addEventListener(FEED_REVEAL_EVENT, onRevealRequest)
    return () => window.removeEventListener(FEED_REVEAL_EVENT, onRevealRequest)
  }, [windowing, topAnchored])

  const visibleItems = displayItems.slice(displayStart, displayEnd)

  return (
    <>
      {displayStart > 0 && (
        <>
          <div
            className="flex items-center justify-center gap-2 py-3 text-xs text-text-muted"
            data-testid="feed-unmounted-hint"
          >
            {t(
              {
                en: { one: 'Scroll up to load {{count}} older item', other: 'Scroll up to load {{count}} older items' },
                fr: {
                  one: 'Faites défiler vers le haut pour charger {{count}} élément plus ancien',
                  other: 'Faites défiler vers le haut pour charger {{count}} éléments plus anciens',
                },
              },
              { count: displayStart },
            )}
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
            <div key={itemKey(item)} data-item-index={displayIndex} className="feed-item px-2 @md:px-4">
              <FeedDivider label={t({ en: 'Earlier context summarized', fr: 'Contexte antérieur résumé' })} />
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
      {displayEnd < totalItems && (
        <>
          <div
            className="flex items-center justify-center gap-2 py-3 text-xs text-text-muted"
            data-testid="feed-unmounted-hint-newer"
          >
            {t(
              {
                en: {
                  one: 'Scroll down to load {{count}} newer item',
                  other: 'Scroll down to load {{count}} newer items',
                },
                fr: {
                  one: 'Faites défiler vers le bas pour charger {{count}} élément plus récent',
                  other: 'Faites défiler vers le bas pour charger {{count}} éléments plus récents',
                },
              },
              { count: totalItems - displayEnd },
            )}
          </div>
          {Array.from({ length: totalItems - displayEnd }, (_, i) => (
            <div key={`ph-newer-${i}`} data-item-index={displayEnd + i} data-placeholder style={PLACEHOLDER_STYLE} />
          ))}
          <div ref={sentinelNewerRef} data-testid="feed-sentinel-newer" style={{ height: 1 }} />
        </>
      )}
    </>
  )
})
