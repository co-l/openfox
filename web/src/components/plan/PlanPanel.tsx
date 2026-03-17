import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useSessionStore, useIsRunning } from '../../stores/session'
import type { Message, ToolCall } from '../../../src/shared/types.js'
import { SessionLayout } from '../layout/SessionLayout'
import { SessionHeader } from './SessionHeader'
import { ChatMessage } from './ChatMessage'
import { AssistantMessage } from './AssistantMessage'
import { SubAgentContainer } from './SubAgentContainer'
import { ModeSwitch } from './ModeSwitch'
import { Button } from '../shared/Button'
import { PathConfirmationDialog } from '../shared/PathConfirmationDialog'
import { RunningIndicator } from '../shared/RunningIndicator'
import { CriteriaGroupDisplay, isCriterionTool } from '../shared/CriteriaGroupDisplay'

// Display item: either a single message, a grouped sub-agent run, criteria batch, or a context window divider
type DisplayItem = 
  | { type: 'message'; message: Message }
  | { type: 'subagent'; subAgentId: string; subAgentType: 'verifier'; messages: Message[] }
  | { type: 'criteria-batch'; toolCalls: ToolCall[] }
  | { type: 'context-divider'; windowSequence: number }

// Check if a message contains only criterion tool calls (no text content)
function isCriteriaOnlyMessage(msg: Message): boolean {
  if (msg.role !== 'assistant') return false
  if (msg.content?.trim()) return false  // Has text content
  if (msg.thinkingContent?.trim()) return false  // Has thinking content
  if (!msg.toolCalls || msg.toolCalls.length === 0) return false  // No tool calls
  return msg.toolCalls.every(tc => isCriterionTool(tc.name))
}

// Group messages into display items, collapsing consecutive sub-agent messages,
// consecutive criteria-only messages, and inserting context window dividers
function groupMessages(messages: Message[]): DisplayItem[] {
  const items: DisplayItem[] = []
  let currentSubAgentGroup: { subAgentId: string; subAgentType: 'verifier'; messages: Message[] } | null = null
  let criteriaBuffer: ToolCall[] = []
  let lastContextWindowId: string | undefined
  let windowSequence = 1
  
  const flushCriteriaBuffer = () => {
    if (criteriaBuffer.length > 0) {
      items.push({ type: 'criteria-batch', toolCalls: [...criteriaBuffer] })
      criteriaBuffer = []
    }
  }
  
  const flushSubAgentGroup = () => {
    if (currentSubAgentGroup) {
      items.push({ type: 'subagent', ...currentSubAgentGroup })
      currentSubAgentGroup = null
    }
  }
  
  for (const msg of messages) {
    // Skip tool messages - they're displayed within assistant messages
    if (msg.role === 'tool') continue
    
    // Detect context window boundary - insert divider when window changes
    // Only insert if we've seen a previous window (not for the first window)
    if (msg.contextWindowId && lastContextWindowId && msg.contextWindowId !== lastContextWindowId) {
      // Flush any pending groups before the divider
      flushCriteriaBuffer()
      flushSubAgentGroup()
      windowSequence++
      items.push({ type: 'context-divider', windowSequence })
    }
    lastContextWindowId = msg.contextWindowId
    
    // Check if this is a criteria-only message
    if (isCriteriaOnlyMessage(msg)) {
      // Flush sub-agent group first (criteria can't be part of sub-agent)
      flushSubAgentGroup()
      // Add all tool calls from this message to the buffer
      for (const tc of msg.toolCalls!) {
        criteriaBuffer.push(tc)
      }
      continue
    }
    
    // Not a criteria-only message - flush criteria buffer
    flushCriteriaBuffer()
    
    if (msg.subAgentId && msg.subAgentType) {
      // Part of a sub-agent run
      if (currentSubAgentGroup && currentSubAgentGroup.subAgentId === msg.subAgentId) {
        // Add to existing group
        currentSubAgentGroup.messages.push(msg)
      } else {
        // Start new group
        flushSubAgentGroup()
        currentSubAgentGroup = { subAgentId: msg.subAgentId, subAgentType: msg.subAgentType, messages: [msg] }
      }
    } else {
      // Regular message - flush any pending group
      flushSubAgentGroup()
      items.push({ type: 'message', message: msg })
    }
  }
  
  // Flush final groups
  flushCriteriaBuffer()
  flushSubAgentGroup()
  
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
  
  const isRunning = useIsRunning()
  
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
      if (e.key === 'Escape' && isRunning) {
        stopGeneration()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isRunning, stopGeneration])
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isRunning) return

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
  const showStartBuilding = isPlanning && hasCriteria && !isRunning && hasAssistantResponse && !isDone
  
  // Show Launch button in builder mode when there are pending criteria
  const showLaunchButton = isBuilding && hasPendingCriteria && !isRunning && !isDone
  
  return (
    <SessionLayout>
      {pendingPathConfirmation && (
        <PathConfirmationDialog confirmation={pendingPathConfirmation} />
      )}
      <SessionHeader />
      
      <div 
        ref={scrollContainerRef}
        onWheel={handleWheel}
        className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden px-4 pt-4"
      >
        {displayItems.map((item) => {
          if (item.type === 'context-divider') {
            return (
              <div 
                key={`divider-${item.windowSequence}`}
                className="flex items-center gap-2 feed-item px-2"
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
          
          if (item.type === 'criteria-batch') {
            return (
              <div key={`criteria-${item.toolCalls[0]?.id ?? 'batch'}`} className="feed-item">
                <CriteriaGroupDisplay toolCalls={item.toolCalls} criteria={session?.criteria} />
              </div>
            )
          }
          
          const message = item.message
          if (message.role === 'assistant') {
            return (
              <AssistantMessage 
                key={message.id}
                message={message}
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
          <div className="feed-item bg-red-500/10 border border-red-500/50 rounded p-2">
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
          <div className="flex justify-center feed-item">
            <Button
              variant="primary"
              onClick={acceptAndBuild}
              className="bg-blue-600 hover:bg-blue-700 px-4 py-1 text-sm"
            >
              ▶ Start
            </Button>
          </div>
        )}
        
        {isRunning && <RunningIndicator />}
        
        <div ref={messagesEndRef} />
      </div>
      
      <form onSubmit={handleSubmit} className="p-4 border-t border-border bg-gradient-to-t from-bg-secondary/50 to-transparent">
        <div className={`flex items-end gap-3 p-3 rounded border ${isRunning ? 'border-accent-warning/30 bg-accent-warning/5' : 'border-border bg-bg-tertiary/50'} transition-colors`}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isPlanning 
                ? "What would you like to build?" 
                : "Send a message..."
            }
            className="flex-1 bg-transparent text-sm placeholder:text-text-muted resize-none overflow-y-auto focus:outline-none"
            style={{ minHeight: '24px', maxHeight: '200px' }}
          />
          {!isRunning ? (
            <div className="flex items-center gap-2">
              {showLaunchButton && (
                <button
                  type="button"
                  onClick={launchRunner}
                  className="px-4 py-1.5 rounded bg-accent-success/20 text-sm text-accent-success font-medium hover:bg-accent-success/30 transition-colors"
                >
                  Launch
                </button>
              )}
              <button
                type="submit"
                disabled={!input.trim()}
                className="px-4 py-1.5 rounded bg-accent-primary/20 text-sm text-accent-primary font-medium hover:bg-accent-primary/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Send
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={stopGeneration}
              className="px-4 py-1.5 rounded bg-accent-error/20 text-sm text-accent-error font-medium hover:bg-accent-error/30 transition-colors animate-pulse"
            >
              Stop
            </button>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <ModeSwitch />
          <span className="text-sm text-text-muted">Ctrl+Enter to send</span>
        </div>
      </form>
    </SessionLayout>
  )
}
