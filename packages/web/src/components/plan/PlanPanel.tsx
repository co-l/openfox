import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useSessionStore, useIsStreaming } from '../../stores/session'
import type { Message } from '@openfox/shared'
import { SessionLayout } from '../layout/SessionLayout'
import { ContextHeader } from './ContextHeader'
import { ChatMessage } from './ChatMessage'
import { AssistantMessage } from './AssistantMessage'
import { SubAgentContainer } from './SubAgentContainer'
import { ModeSwitch } from './ModeSwitch'
import { Button } from '../shared/Button'
import { PathConfirmationDialog } from '../shared/PathConfirmationDialog'

// Display item: either a single message, a grouped sub-agent run, or a context window divider
type DisplayItem = 
  | { type: 'message'; message: Message }
  | { type: 'subagent'; subAgentId: string; subAgentType: 'verifier'; messages: Message[] }
  | { type: 'context-divider'; windowSequence: number }

// Group messages into display items, collapsing consecutive sub-agent messages
// and inserting context window dividers when contextWindowId changes
function groupMessages(messages: Message[]): DisplayItem[] {
  const items: DisplayItem[] = []
  let currentGroup: { subAgentId: string; subAgentType: 'verifier'; messages: Message[] } | null = null
  let lastContextWindowId: string | undefined
  let windowSequence = 1
  
  for (const msg of messages) {
    // Skip tool messages - they're displayed within assistant messages
    if (msg.role === 'tool') continue
    
    // Detect context window boundary - insert divider when window changes
    // Only insert if we've seen a previous window (not for the first window)
    if (msg.contextWindowId && lastContextWindowId && msg.contextWindowId !== lastContextWindowId) {
      // Flush any pending sub-agent group before the divider
      if (currentGroup) {
        items.push({ type: 'subagent', ...currentGroup })
        currentGroup = null
      }
      windowSequence++
      items.push({ type: 'context-divider', windowSequence })
    }
    lastContextWindowId = msg.contextWindowId
    
    if (msg.subAgentId && msg.subAgentType) {
      // Part of a sub-agent run
      if (currentGroup && currentGroup.subAgentId === msg.subAgentId) {
        // Add to existing group
        currentGroup.messages.push(msg)
      } else {
        // Start new group
        if (currentGroup) {
          items.push({ type: 'subagent', ...currentGroup })
        }
        currentGroup = { subAgentId: msg.subAgentId, subAgentType: msg.subAgentType, messages: [msg] }
      }
    } else {
      // Regular message - flush any pending group
      if (currentGroup) {
        items.push({ type: 'subagent', ...currentGroup })
        currentGroup = null
      }
      items.push({ type: 'message', message: msg })
    }
  }
  
  // Flush final group
  if (currentGroup) {
    items.push({ type: 'subagent', ...currentGroup })
  }
  
  return items
}

export function PlanPanel() {
  const [input, setInput] = useState('')
  const [userScrolledUp, setUserScrolledUp] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  
  const session = useSessionStore(state => state.currentSession)
  const messages = useSessionStore(state => state.messages)
  const error = useSessionStore(state => state.error)
  const pendingPathConfirmation = useSessionStore(state => state.pendingPathConfirmation)
  
  const isStreaming = useIsStreaming()
  
  const sendMessage = useSessionStore(state => state.sendMessage)
  const clearError = useSessionStore(state => state.clearError)
  const acceptAndBuild = useSessionStore(state => state.acceptAndBuild)
  const stopGeneration = useSessionStore(state => state.stopGeneration)
  const launchRunner = useSessionStore(state => state.launchRunner)
  
  // Group messages for display, collapsing sub-agent messages into containers
  const displayItems = useMemo((): DisplayItem[] => {
    return groupMessages(messages)
  }, [messages])
  
  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [])
  
  // Detect user scrolling via wheel event
  const handleWheel = useCallback((e: React.WheelEvent) => {
    const container = scrollContainerRef.current
    if (!container) return
    
    if (e.deltaY < 0) {
      setUserScrolledUp(true)
    } else if (e.deltaY > 0 && userScrolledUp) {
      requestAnimationFrame(() => {
        const threshold = 150
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
        if (distanceFromBottom < threshold) {
          setUserScrolledUp(false)
        }
      })
    }
  }, [userScrolledUp])
  
  // Auto-scroll only if user hasn't scrolled up
  useEffect(() => {
    if (!userScrolledUp) {
      scrollToBottom()
    }
  }, [displayItems, userScrolledUp, scrollToBottom])
  
  // Reset scroll state when streaming stops
  useEffect(() => {
    if (!isStreaming) {
      setUserScrolledUp(false)
    }
  }, [isStreaming])
  
  // Auto-resize textarea based on content, up to 200px max
  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    
    // Reset height to auto to get correct scrollHeight
    textarea.style.height = 'auto'
    // Calculate new height based on content
    const newHeight = Math.min(200, textarea.scrollHeight)
    textarea.style.height = `${newHeight}px`
  }, [])

  // Auto-focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus()
    resizeTextarea()
  }, [session?.id, resizeTextarea])

  // Resize textarea when input changes
  useEffect(() => {
    resizeTextarea()
  }, [input, resizeTextarea])
  
  // Escape key to stop generation
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isStreaming) {
        stopGeneration()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isStreaming, stopGeneration])
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isStreaming) return

    setUserScrolledUp(false)
    
    sendMessage(input)
    setInput('')
  }
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSubmit(e)
    }
  }
  
  const isPlanning = session?.mode === 'planner'
  const isBuilding = session?.mode === 'builder'
  const hasCriteria = (session?.criteria.length ?? 0) > 0
  const isDone = session?.phase === 'done'
  
  // Count pending criteria (not passed)
  const pendingCriteria = session?.criteria.filter(c => c.status.type !== 'passed') ?? []
  const hasPendingCriteria = pendingCriteria.length > 0
  
  // Show "Start Building" when in planner with criteria and assistant has responded
  // Don't show if already done (all criteria verified)
  const hasAssistantResponse = displayItems.some(item => 
    item.type === 'message' && item.message.role === 'assistant'
  )
  const showStartBuilding = isPlanning && hasCriteria && !isStreaming && hasAssistantResponse && !isDone
  
  // Show Launch button in builder mode when there are pending criteria
  const showLaunchButton = isBuilding && hasPendingCriteria && !isStreaming && !isDone
  
  return (
    <SessionLayout>
      {pendingPathConfirmation && (
        <PathConfirmationDialog confirmation={pendingPathConfirmation} />
      )}
      <ContextHeader />
      
      <div 
        ref={scrollContainerRef}
        onWheel={handleWheel}
        className="flex-1 overflow-y-auto p-2"
      >
        {displayItems.map((item) => {
          if (item.type === 'context-divider') {
            return (
              <div 
                key={`divider-${item.windowSequence}`}
                className="flex items-center gap-2 my-3 px-2"
              >
                <div className="flex-1 border-t border-border" />
                <span className="text-[10px] text-text-muted font-medium px-2">
                  Earlier context summarized
                </span>
                <div className="flex-1 border-t border-border" />
              </div>
            )
          }
          
          if (item.type === 'subagent') {
            // Check if any message in the group is streaming
            const groupIsStreaming = item.messages.some(m => m.isStreaming)
            return (
              <SubAgentContainer
                key={item.subAgentId}
                messages={item.messages}
                subAgentType={item.subAgentType}
                isStreaming={groupIsStreaming}
              />
            )
          }
          
          const message = item.message
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
          
          // User or system messages
          return (
            <ChatMessage 
              key={message.id} 
              message={message} 
              isLastAssistantMessage={false}
            />
          )
        })}
        
        {error && (
          <div className="bg-red-500/10 border border-red-500/50 rounded p-2 my-1">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-red-400 text-sm font-medium">{error.code}</div>
                <div className="text-red-300 text-xs mt-0.5">{error.message}</div>
              </div>
              <button
                onClick={clearError}
                className="text-red-400 hover:text-red-300 p-0.5"
                aria-label="Dismiss error"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}
        
        {showStartBuilding && (
          <div className="flex justify-center my-2">
            <Button
              variant="primary"
              onClick={acceptAndBuild}
              className="bg-blue-600 hover:bg-blue-700 px-4 py-1 text-sm"
            >
              ▶ Start
            </Button>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>
      
      <form onSubmit={handleSubmit} className="p-2 border-t border-border">
        <div className="mb-1">
          <ModeSwitch />
        </div>
        <div className="flex gap-1.5">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isPlanning 
                ? "Describe what to build..." 
                : "Send a message..."
            }
            className="flex-1 bg-bg-tertiary border border-border rounded-lg p-2 text-sm placeholder:text-xs resize-y overflow-y-auto focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
            style={{ minHeight: '60px', maxHeight: '200px' }}
          />
          <div className="flex flex-col gap-1.5 self-end">
            {!isStreaming ? (
              <>
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-primary text-sm text-white font-medium hover:bg-accent-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                  Send
                </button>
                {showLaunchButton && (
                  <button
                    type="button"
                    onClick={launchRunner}
                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-success text-sm text-white font-medium hover:bg-accent-success/80 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Launch
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={stopGeneration}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-error text-sm text-white font-medium hover:bg-accent-error/80 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
                Stop
              </button>
            )}
          </div>
        </div>
        <div className="text-[10px] text-text-muted mt-0.5">
          {isStreaming ? 'Press Escape to stop' : 'Cmd+Enter to send'}
        </div>
      </form>
    </SessionLayout>
  )
}
