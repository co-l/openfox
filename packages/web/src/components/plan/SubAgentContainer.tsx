import { useRef, useEffect, useState, useCallback } from 'react'
import type { Message } from '@openfox/shared'
import { AssistantMessage } from './AssistantMessage'
import { ChatMessage } from './ChatMessage'

interface SubAgentContainerProps {
  messages: Message[]
  subAgentType: 'verifier'
  isStreaming: boolean
}

const LABELS: Record<string, string> = {
  verifier: 'Verification',
}

const HEADER_COLORS: Record<string, string> = {
  verifier: 'bg-green-500/20 text-green-400 border-green-500/30',
}

/**
 * Container for sub-agent messages with scrollable area and auto-scroll.
 * Groups consecutive messages from the same subAgentId into a single card.
 * Uses the same AssistantMessage and ChatMessage components as the main chat.
 */
export function SubAgentContainer({ messages, subAgentType, isStreaming }: SubAgentContainerProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [userScrolledUp, setUserScrolledUp] = useState(false)
  const [expanded, setExpanded] = useState(false)
  
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
    <div className="my-2 border border-border rounded overflow-hidden bg-bg-secondary">
      <div className={`px-2 py-1 text-xs font-medium border-b ${headerColor}`}>
        {label}
      </div>
      
      <div 
        ref={scrollContainerRef}
        onWheel={handleWheel}
        className="max-h-32 overflow-y-auto p-2"
      >
        {displayMessages.map((message) => {
          if (message.role === 'assistant') {
            return (
              <AssistantMessage 
                key={message.id}
                message={message}
                isStreaming={message.isStreaming ?? false}
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
}
