import { memo, useRef, useEffect, useState, useCallback } from 'react'
import type { Message } from '@shared/types.js'
import { AssistantMessage } from './AssistantMessage'
import { ChatMessage } from './ChatMessage'
import { useAgentsStore, getAgentColor } from '../../stores/agents'

interface SubAgentContainerProps {
  messages: Message[]
  subAgentType: string
  isStreaming: boolean
}

const LABELS: Record<string, string> = {
  verifier: 'Verification',
  code_reviewer: 'Code Review',
  test_generator: 'Test Generation',
  debugger: 'Debug',
}

/** Build header style from hex color */
function headerStyle(hex: string) {
  return {
    backgroundColor: `${hex}20`,
    color: hex,
    borderColor: `${hex}4d`,
  }
}

/**
 * Container for sub-agent messages with scrollable area and auto-scroll.
 * Groups consecutive messages from the same subAgentId into a single card.
 * Uses the same AssistantMessage and ChatMessage components as the main chat.
 */
export const SubAgentContainer = memo(function SubAgentContainer({ messages, subAgentType, isStreaming }: SubAgentContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [userScrolledUp, setUserScrolledUp] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const agents = useAgentsStore(state => state.agents)

  // Scroll container into view when expanding
  const handleToggleExpand = useCallback(() => {
    const willExpand = !expanded
    setExpanded(willExpand)

    if (willExpand) {
      // Wait for height transition (200ms) to complete, then scroll into view
      setTimeout(() => {
        containerRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      }, 220)
    }
  }, [expanded])

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [])

  // Detect user scrolling
  const handleWheel = useCallback((e: React.WheelEvent) => {
    const container = scrollContainerRef.current
    if (!container) return

    if (e.deltaY < 0) {
      setUserScrolledUp(true)
    } else if (e.deltaY > 0 && userScrolledUp) {
      requestAnimationFrame(() => {
        const threshold = 50
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
        if (distanceFromBottom < threshold) {
          setUserScrolledUp(false)
        }
      })
    }
  }, [userScrolledUp])

  // Auto-scroll when streaming or messages change
  useEffect(() => {
    if (!userScrolledUp) {
      scrollToBottom()
    }
  }, [messages, userScrolledUp, scrollToBottom])

  // Reset scroll state when streaming stops
  useEffect(() => {
    if (!isStreaming) {
      setUserScrolledUp(false)
    }
  }, [isStreaming])

  const agentInfo = agents.find(a => a.id === subAgentType)
  const label = agentInfo?.name ?? LABELS[subAgentType] ?? subAgentType
  const color = getAgentColor(agents, subAgentType)
  const hStyle = headerStyle(color)

  // Filter out tool messages
  const displayMessages = messages.filter(m => m.role !== 'tool')

  return (
    <div ref={containerRef} className="feed-item border border-border rounded overflow-hidden bg-bg-secondary">
      <button
        className="w-full flex items-center justify-between px-2 py-1 text-xs font-medium border-b hover:opacity-80 transition-opacity"
        style={hStyle}
        onClick={handleToggleExpand}
      >
        <span>{label}</span>
        <span className="text-[10px]">{expanded ? '▼' : '▶'}</span>
      </button>

      <div
        ref={scrollContainerRef}
        onWheel={handleWheel}
        className={`${expanded ? 'max-h-[calc(100vh-10rem)]' : 'max-h-80'} overflow-y-auto p-2 transition-[max-height] duration-200`}
      >
        {displayMessages.map((message) => {
          if (message.role === 'assistant') {
            return (
              <AssistantMessage
                key={message.id}
                message={message}
                showStats={true}
              />
            )
          }

          // User or system messages (context-reset, auto-prompt, etc.)
          return (
            <ChatMessage
              key={message.id}
              message={message}
              isLastAssistantMessage={false}
            />
          )
        })}
      </div>
    </div>
  )
})
