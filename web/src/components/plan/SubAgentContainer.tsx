import { memo, useRef, useEffect, useState, useCallback } from 'react'
import type { Message } from '../../../src/shared/types.js'
import { AssistantMessage } from './AssistantMessage'
import { ChatMessage } from './ChatMessage'

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

const HEADER_COLORS: Record<string, string> = {
  verifier: 'bg-green-500/20 text-green-400 border-green-500/30',
  code_reviewer: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  test_generator: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  debugger: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
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
  
  const label = LABELS[subAgentType] || subAgentType
  const headerColor = HEADER_COLORS[subAgentType] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'
  
  // Filter out tool messages (they're displayed within assistant messages)
  const displayMessages = messages.filter(m => m.role !== 'tool')
  
  return (
    <div ref={containerRef} className="feed-item border border-border rounded overflow-hidden bg-bg-secondary">
      <button
        className={`w-full flex items-center justify-between px-2 py-1 text-xs font-medium border-b ${headerColor} hover:opacity-80 transition-opacity`}
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
