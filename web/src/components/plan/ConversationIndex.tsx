import { memo, useRef, useCallback, useEffect } from 'react'
import type { DisplayItem } from './groupMessages'

interface ConversationIndexProps {
  displayItems: DisplayItem[]
  activeIndex?: number
  onNavigate?: (index: number) => void
}

// Format timestamp to relative time string
function formatTime(timestamp: string): string {
  const now = Date.now()
  const then = new Date(timestamp).getTime()
  const diffMs = now - then
  const diffHours = diffMs / (1000 * 60 * 60)
  const diffDays = diffHours / 24

  if (diffHours < 24) {
    // Less than 24 hours: show time
    const date = new Date(timestamp)
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  } else if (diffDays < 5) {
    // 1-5 days: show hours/days ago
    if (diffHours < 48) {
      return `${Math.floor(diffHours)}h ago`
    }
    return `${Math.floor(diffDays)}d ago`
  } else {
    // 5+ days: show date
    const date = new Date(timestamp)
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
}

export function ConversationIndex({ displayItems, activeIndex, onNavigate }: ConversationIndexProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  // Track if user is interacting with the index to prevent auto-scroll conflicts
  const isUserInteractingRef = useRef(false)

  const scrollToIndex = useCallback(
    (index: number, behavior: 'smooth' | 'auto' = 'auto') => {
      // Skip if user is actively interacting
      if (isUserInteractingRef.current) return

      let element = itemRefs.current.get(index)
      const container = containerRef.current

      // If element not found (skipped item), try to find the next rendered item
      if (!element && container) {
        for (let i = index + 1; i < displayItems.length; i++) {
          element = itemRefs.current.get(i)
          if (element) break
        }
      }

      if (element && container) {
        // Calculate element position relative to the container
        // Use getBoundingClientRect for accurate viewport positions
        const elementRect = element.getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()

        // Skip if element or container has no valid dimensions
        if (elementRect.height === 0 || containerRect.height === 0) {
          return
        }

        // Element position within the container (accounting for current scroll)
        const elementTopInContainer = elementRect.top - containerRect.top + container.scrollTop

        const elementHeight = element.clientHeight
        const containerHeight = container.clientHeight

        // Calculate target scroll position to center the element
        const targetScrollTop = elementTopInContainer - containerHeight / 2 + elementHeight / 2

        // Clamp to valid range [0, maxScroll]
        const maxScroll = container.scrollHeight - containerHeight
        const clampedScrollTop = Math.max(0, Math.min(targetScrollTop, maxScroll))

        container.scrollTo({ top: clampedScrollTop, behavior })
      }
    },
    [displayItems.length],
  )

  const handleScrollToIndex = useCallback(
    (index: number) => {
      if (index >= 0 && index < displayItems.length) {
        // Set lock to prevent auto-scroll feedback
        isUserInteractingRef.current = true

        // Notify parent to scroll the main chat to this item
        onNavigate?.(index)

        // After scroll animation completes, re-trigger activeIndex to ensure correct highlight
        // This fixes mobile where the highlight may be off by 1-2 items during/after scroll
        setTimeout(() => {
          isUserInteractingRef.current = false
          // Force a re-evaluation of the active index by triggering a scroll event
          // This allows the chat's scroll handler to recalculate the closest item
          const container = document.querySelector('[data-scroll-container]') as HTMLElement
          if (container) {
            container.dispatchEvent(new Event('scroll'))
          }
        }, 600)
      }
    },
    [onNavigate],
  )

  // Auto-scroll conversation index when user clicks an item (not when chat scrolls)
  const prevActiveIndexRef = useRef<number | undefined>(undefined)
  const lastScrollTimeRef = useRef<number>(0)
  const scrollDebounceMs = 150 // Debounce scroll updates for smoother mobile experience
  const isScrollingRef = useRef(false) // Track if a scroll animation is in progress

  useEffect(() => {
    if (activeIndex === undefined || activeIndex < 0 || activeIndex >= displayItems.length) {
      return
    }

    // Only auto-scroll if this is a new click interaction (not from chat scrolling)
    // If the index was already scrolled by user, don't force it back
    if (isUserInteractingRef.current) {
      // User is actively interacting - let them scroll freely
      return
    }

    // Skip if a scroll animation is already in progress
    if (isScrollingRef.current) {
      return
    }

    const element = itemRefs.current.get(activeIndex)
    const container = containerRef.current

    if (element && container) {
      const containerHeight = container.clientHeight
      const containerTop = container.getBoundingClientRect().top

      // Calculate element's position relative to the viewport
      const elementTop = element.getBoundingClientRect().top
      const elementBottom = elementTop + element.clientHeight

      // Check if element is already visible within the container
      const containerTopInViewport = containerTop
      const containerBottomInViewport = containerTop + containerHeight

      // Element is visible if it's within the container bounds (with buffer)
      const isVisible = elementTop >= containerTopInViewport - 50 && elementBottom <= containerBottomInViewport + 50

      // Check if element is getting close to the container edges (within 30px)
      // This triggers scroll BEFORE the element leaves the container
      const distanceFromTop = elementTop - containerTopInViewport
      const distanceFromBottom = containerBottomInViewport - elementBottom
      const isNearEdge = distanceFromTop < 30 || distanceFromBottom < 30

      // Only scroll if element is getting near the edge AND this is a new item (not just chat scrolling)
      const isNewItem = prevActiveIndexRef.current !== activeIndex

      // Debounce scroll updates to prevent rapid-fire scrolling on mobile
      const now = Date.now()
      const shouldDebounce = now - lastScrollTimeRef.current < scrollDebounceMs

      // Scroll when element is near edge or not visible, and it's a new item
      const shouldScroll = (isNearEdge || !isVisible) && isNewItem && !shouldDebounce

      if (shouldScroll) {
        // Use smooth scrolling to match the chat behavior
        isScrollingRef.current = true
        scrollToIndex(activeIndex, 'smooth')
        lastScrollTimeRef.current = now

        // Release scroll lock after animation completes (200ms for smooth scroll)
        setTimeout(() => {
          isScrollingRef.current = false
        }, 200)
      }

      // Update previous index
      prevActiveIndexRef.current = activeIndex
    }
  }, [activeIndex, displayItems.length, scrollToIndex])

  const isItemActive = (index: number): boolean => {
    return activeIndex === index
  }

  const getItemLabel = (item: DisplayItem, index: number): string => {
    if (item.type === 'message') {
      const msg = item.message
      // Strip all HTML tags and normalize whitespace for all messages
      const rawContent = msg.content || ''
      const cleanContent = rawContent
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      const lowerContent = cleanContent.toLowerCase()

      // Check for specific patterns first (before role-based handling)
      if (lowerContent.startsWith('# build mode') || lowerContent.startsWith('build mode')) {
        return 'Builder'
      }
      if (lowerContent.startsWith('# plan mode') || lowerContent.startsWith('plan mode')) {
        return 'Planner'
      }
      if (
        lowerContent.includes('compaction') ||
        lowerContent.includes('compacted') ||
        lowerContent.includes('context window')
      ) {
        return 'Compaction'
      }

      // Check for special message kinds BEFORE role-based handling
      if (msg.messageKind) {
        if (msg.messageKind === 'workflow-started') {
          try {
            const data = JSON.parse(msg.content) as { workflowName: string }
            return `Workflow: ${data.workflowName}`
          } catch {
            return 'Workflow started'
          }
        }
        if (msg.messageKind === 'task-completed') {
          return 'Task completed'
        }
        if (msg.messageKind === 'auto-prompt') {
          return 'Auto-prompt'
        }
        if (msg.messageKind === 'correction') {
          return 'Correction'
        }
        if (msg.messageKind === 'context-reset') {
          return 'Context reset'
        }
        if (msg.messageKind === 'command') {
          return 'Command executed'
        }
      }

      if (msg.role === 'user') {
        const preview = cleanContent.slice(0, 200)
        return preview.length < cleanContent.length ? `${preview}...` : preview
      }
      if (msg.role === 'assistant') {
        // Show regular content if available, otherwise show thinking content
        if (cleanContent) {
          // Check if content is JSON (workflow/task data)
          if (cleanContent.trim().startsWith('{')) {
            try {
              const data = JSON.parse(cleanContent) as { workflowName?: string; summary?: string }
              if (data.workflowName) {
                return `Workflow: ${data.workflowName}`
              }
              if (data.summary !== undefined) {
                return 'Task completed'
              }
            } catch {
              // Not valid JSON, continue with normal text
            }
          }
          const text = cleanContent.slice(0, 200)
          return text.length < cleanContent.length ? `${text}...` : text
        }
        // Fall back to thinking content if no regular content
        if (msg.thinkingContent?.trim()) {
          const preview = msg.thinkingContent.slice(0, 200)
          return preview.length < msg.thinkingContent.length ? `${preview}...` : preview
        }
        return ''
      }
      return `Message ${index + 1}`
    }
    if (item.type === 'context-divider') {
      return `Earlier context (${item.windowSequence})`
    }
    if (item.type === 'subagent') {
      return `Sub-agent: ${item.subAgentType}`
    }
    if (item.type === 'criteria-batch') {
      return 'Acceptance Criteria'
    }
    return `Item ${index + 1}`
  }

  return (
    <div ref={containerRef} className="h-full overflow-y-auto">
      {displayItems.map((item, index) => {
        const isActive = isItemActive(index)
        const isCriteria = item.type === 'criteria-batch'
        const isAssistant = item.type === 'message' && item.message.role === 'assistant'
        const hasThinking = isAssistant && item.message.thinkingContent?.trim()
        const hasContent = isAssistant && item.message.content?.trim()
        // Thinking messages: have thinking content but NO regular content
        const isThinking = isAssistant && hasThinking && !hasContent
        const isSystemReminder = item.type === 'message' && item.message.content?.includes('<system-reminder>')
        const isBuildMode = isSystemReminder && item.message.content?.includes('# Build Mode')
        const isPlanMode = isSystemReminder && item.message.content?.includes('# Plan Mode')
        const isCompaction =
          item.type === 'message' &&
          (item.message.content?.toLowerCase().includes('compacted') ||
            item.message.content?.toLowerCase().includes('compaction') ||
            item.message.content?.toLowerCase().includes('context window'))
        const isEmptyAssistant = isAssistant && !hasContent && !hasThinking
        // Check for special message kinds
        const isWorkflowStarted =
          item.type === 'message' &&
          (item.message.messageKind === 'workflow-started' ||
            (item.message.content?.trim().startsWith('{') && item.message.content?.includes('"workflowName"')))
        const isTaskCompleted =
          item.type === 'message' &&
          (item.message.messageKind === 'task-completed' ||
            (item.message.content?.trim().startsWith('{') && item.message.content?.includes('"summary"')))
        const isAutoPrompt = item.type === 'message' && item.message.messageKind === 'auto-prompt'
        const isCorrection = item.type === 'message' && item.message.messageKind === 'correction'
        const isContextReset = item.type === 'message' && item.message.messageKind === 'context-reset'
        const isCommand = item.type === 'message' && item.message.messageKind === 'command'

        // Skip rendering empty assistant messages and context dividers
        if (isEmptyAssistant || item.type === 'context-divider') {
          return null
        }

        // Get timestamp for datetime display
        let timestamp: string | undefined
        if (item.type === 'message') {
          timestamp = item.message.timestamp
        } else if (item.type === 'subagent') {
          // Use the first message's timestamp for subagent groups
          timestamp = item.messages[0]?.timestamp
        } else if (item.type === 'criteria-batch') {
          // Use the timestamp from the criteria batch
          timestamp = item.timestamp
        }

        // Determine text color based on item type - using distinctly different colors
        let textColorClass = 'text-text-muted'
        if (isCompaction) {
          textColorClass = 'text-gray-400'
        } else if (item.type === 'message' && item.message.role === 'user' && !isSystemReminder) {
          textColorClass = 'text-orange-400'
        } else if (isThinking) {
          textColorClass = 'text-cyan-300'
        } else if (
          isAssistant &&
          !isSystemReminder &&
          !isWorkflowStarted &&
          !isTaskCompleted &&
          !isAutoPrompt &&
          !isCorrection &&
          !isContextReset &&
          !isCommand
        ) {
          textColorClass = 'text-lime-300'
        } else if (isBuildMode) {
          textColorClass = 'text-sky-400'
        } else if (isPlanMode) {
          textColorClass = 'text-violet-400'
        } else if (isSystemReminder) {
          textColorClass = 'text-yellow-400'
        } else if (isWorkflowStarted) {
          textColorClass = 'text-sky-400'
        } else if (isTaskCompleted) {
          textColorClass = 'text-green-400'
        } else if (isAutoPrompt) {
          textColorClass = 'text-violet-400'
        } else if (isCorrection) {
          textColorClass = 'text-yellow-400'
        } else if (isContextReset) {
          textColorClass = 'text-gray-400'
        } else if (isCommand) {
          textColorClass = 'text-lime-400'
        } else if (item.type === 'subagent') {
          textColorClass = 'text-amber-500'
        } else if (isCriteria) {
          textColorClass = 'text-green-400'
        }

        return (
          <div
            key={index}
            ref={(el) => {
              if (el) {
                itemRefs.current.set(index, el)
              }
            }}
            data-item-index={index}
            onClick={() => handleScrollToIndex(index)}
            className={`
              px-1 py-1 rounded-lg cursor-pointer text-xs transition-all duration-200 hover:bg-bg-tertiary mb-0.5
              ${
                isActive
                  ? 'bg-gradient-to-r from-accent-primary/15 to-accent-primary/0 border-l-2 border-accent-primary/50'
                  : 'bg-gradient-to-r from-bg-tertiary/30 to-bg-tertiary/0 border-l-2 border-border/30'
              }
              ${isCompaction ? 'text-gray-400' : textColorClass}
            `}
            title={getItemLabel(item, index)}
          >
            <div className="flex items-center gap-1">
              <div className="flex items-center gap-1 min-w-0 flex-1">
                {/* Only show ONE emoji based on strict priority order */}
                {!isWorkflowStarted &&
                  !isTaskCompleted &&
                  !isAutoPrompt &&
                  !isCorrection &&
                  !isContextReset &&
                  !isCommand &&
                  isBuildMode && <span className="text-sky-400 w-4 text-center flex-shrink-0">🔨</span>}
                {!isWorkflowStarted &&
                  !isTaskCompleted &&
                  !isAutoPrompt &&
                  !isCorrection &&
                  !isContextReset &&
                  !isCommand &&
                  !isBuildMode &&
                  isPlanMode && <span className="text-violet-400 w-4 text-center flex-shrink-0">📋</span>}
                {!isWorkflowStarted &&
                  !isTaskCompleted &&
                  !isAutoPrompt &&
                  !isCorrection &&
                  !isContextReset &&
                  !isCommand &&
                  !isBuildMode &&
                  !isPlanMode &&
                  isCompaction && <span className="text-orange-500 w-4 text-center flex-shrink-0">🗜️</span>}
                {!isWorkflowStarted &&
                  !isTaskCompleted &&
                  !isAutoPrompt &&
                  !isCorrection &&
                  !isContextReset &&
                  !isCommand &&
                  !isBuildMode &&
                  !isPlanMode &&
                  !isCompaction &&
                  isSystemReminder && <span className="text-yellow-400 w-4 text-center flex-shrink-0">⚙️</span>}
                {!isWorkflowStarted &&
                  !isTaskCompleted &&
                  !isAutoPrompt &&
                  !isCorrection &&
                  !isContextReset &&
                  !isCommand &&
                  !isBuildMode &&
                  !isPlanMode &&
                  !isCompaction &&
                  !isSystemReminder &&
                  isThinking && <span className="text-cyan-300 w-4 text-center flex-shrink-0">🧠</span>}
                {!isWorkflowStarted &&
                  !isTaskCompleted &&
                  !isAutoPrompt &&
                  !isCorrection &&
                  !isContextReset &&
                  !isCommand &&
                  !isBuildMode &&
                  !isPlanMode &&
                  !isCompaction &&
                  !isSystemReminder &&
                  !isThinking &&
                  item.type === 'message' &&
                  item.message.role === 'user' &&
                  !isCompaction && <span className="text-orange-400 w-4 text-center flex-shrink-0">🤔</span>}
                {!isWorkflowStarted &&
                  !isTaskCompleted &&
                  !isAutoPrompt &&
                  !isCorrection &&
                  !isContextReset &&
                  !isCommand &&
                  !isBuildMode &&
                  !isPlanMode &&
                  !isCompaction &&
                  !isSystemReminder &&
                  !isThinking &&
                  item.type === 'message' &&
                  item.message.role === 'assistant' && (
                    <span className="text-lime-300 w-4 text-center flex-shrink-0">🤖</span>
                  )}
                {!isWorkflowStarted &&
                  !isTaskCompleted &&
                  !isAutoPrompt &&
                  !isCorrection &&
                  !isContextReset &&
                  !isCommand &&
                  !isBuildMode &&
                  !isPlanMode &&
                  !isCompaction &&
                  !isSystemReminder &&
                  !isThinking &&
                  item.type === 'subagent' && <span className="text-amber-500 w-4 text-center flex-shrink-0">◈</span>}
                {!isWorkflowStarted &&
                  !isTaskCompleted &&
                  !isAutoPrompt &&
                  !isCorrection &&
                  !isContextReset &&
                  !isCommand &&
                  !isBuildMode &&
                  !isPlanMode &&
                  !isCompaction &&
                  !isSystemReminder &&
                  !isThinking &&
                  item.type === 'criteria-batch' && (
                    <span className="text-green-400 w-4 text-center flex-shrink-0">✅</span>
                  )}
                {isWorkflowStarted && <span className="text-sky-400 w-4 text-center flex-shrink-0">⚡</span>}
                {isTaskCompleted && <span className="text-green-400 w-4 text-center flex-shrink-0">✓</span>}
                {isAutoPrompt && <span className="text-violet-400 w-4 text-center flex-shrink-0">📝</span>}
                {isCorrection && <span className="text-yellow-400 w-4 text-center flex-shrink-0">⚠️</span>}
                {isContextReset && <span className="text-gray-400 w-4 text-center flex-shrink-0">⟳</span>}
                {isCommand && <span className="text-lime-400 w-4 text-center flex-shrink-0">📜</span>}
                <span className={`flex-1 ${textColorClass} line-clamp-2`}>{getItemLabel(item, index)}</span>
              </div>
              {timestamp && (
                <span
                  className={`text-[9px] flex-shrink-0 font-medium px-1 ${isActive ? 'text-accent-primary' : 'text-text-muted'}`}
                >
                  {formatTime(timestamp)}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export const MemoizedConversationIndex = memo(ConversationIndex)
