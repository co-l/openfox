import { useState, useRef, useEffect, useCallback } from 'react'
import { useSessionStore } from '../../stores/session'
import { SessionLayout } from '../layout/SessionLayout'
import { ChatMessage } from './ChatMessage'
import { AssistantMessage } from './AssistantMessage'
import { ModeSwitch } from './ModeSwitch'
import { Button } from '../shared/Button'

export function PlanPanel() {
  const [input, setInput] = useState('')
  const [userScrolledUp, setUserScrolledUp] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  
  const session = useSessionStore(state => state.currentSession)
  const isStreaming = useSessionStore(state => state.isStreaming)
  const chatStreamEvents = useSessionStore(state => state.chatStreamEvents)
  const error = useSessionStore(state => state.error)
  
  const sendMessage = useSessionStore(state => state.sendMessage)
  const clearError = useSessionStore(state => state.clearError)
  const acceptAndBuild = useSessionStore(state => state.acceptAndBuild)
  const stopGeneration = useSessionStore(state => state.stopGeneration)
  
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
      // User scrolled up - detach
      setUserScrolledUp(true)
    } else if (e.deltaY > 0 && userScrolledUp) {
      // User scrolled down while detached - check if near bottom after scroll completes
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
  }, [session?.messages, chatStreamEvents, userScrolledUp, scrollToBottom])
  
  // Reset scroll state when streaming stops
  useEffect(() => {
    if (!isStreaming) {
      setUserScrolledUp(false)
    }
  }, [isStreaming])
  
  // Auto-focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus()
  }, [session?.id])
  
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
    
    sendMessage(input)
    setInput('')
  }
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSubmit(e)
    }
  }
  
  const isPlanning = session?.mode === 'planner'
  const hasCriteria = (session?.criteria.length ?? 0) > 0
  const lastMessage = session?.messages[session.messages.length - 1]
  const lastMessageIsAssistant = lastMessage?.role === 'assistant'
  
  // Show "Start Building" button when:
  // - In planner mode
  // - Has criteria
  // - Not streaming
  // - Last message is from assistant (hides when user sends new message)
  const showStartBuilding = isPlanning && hasCriteria && !isStreaming && lastMessageIsAssistant
  
  // Filter messages for display
  const displayMessages = session?.messages
    .filter(m => m.role !== 'tool' || m.toolResult?.success === false) ?? []
  
  // Determine which assistant messages should show stats
  // (only the last assistant message before a user message or end of conversation)
  const isLastAssistantBeforeUser = (index: number) => {
    const msg = displayMessages[index]
    if (msg?.role !== 'assistant') return false
    
    // Check if next message is user or this is the last message
    const nextMsg = displayMessages[index + 1]
    return !nextMsg || nextMsg.role === 'user'
  }
  
  return (
    <SessionLayout>
      {/* Chat Area */}
      <div 
        ref={scrollContainerRef}
        onWheel={handleWheel}
        className="flex-1 overflow-y-auto p-4"
      >
        {displayMessages.map((message, index) => (
          <ChatMessage 
            key={message.id} 
            message={message} 
            isLastAssistantMessage={isLastAssistantBeforeUser(index)}
          />
        ))}
        
        {chatStreamEvents.length > 0 && (
          <AssistantMessage events={chatStreamEvents} isStreaming={isStreaming} />
        )}
        
        {error && (
          <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 my-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-red-400 font-medium">{error.code}</div>
                <div className="text-red-300 text-sm mt-1">{error.message}</div>
              </div>
              <button
                onClick={clearError}
                className="text-red-400 hover:text-red-300 p-1"
                aria-label="Dismiss error"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}
        
        {showStartBuilding && (
          <div className="flex justify-center my-6">
            <Button
              variant="primary"
              onClick={acceptAndBuild}
              className="bg-blue-600 hover:bg-blue-700 px-6"
            >
              ▶ Start Building
            </Button>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>
      
      {/* Chat input - always visible, user can send messages in any mode */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-border">
        <div className="mb-3">
          <ModeSwitch />
        </div>
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isPlanning 
                ? "Describe what you want to build..." 
                : "Send a message to intervene..."
            }
            className="flex-1 bg-bg-tertiary border border-border rounded-lg p-3 text-text-primary placeholder-text-muted resize-none focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
            rows={3}
            disabled={isStreaming}
          />
          <div className="flex flex-col gap-2 self-end">
            {!isStreaming ? (
              <button
                type="submit"
                disabled={!input.trim()}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white font-medium hover:bg-accent-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                Send
              </button>
            ) : (
              <button
                type="button"
                onClick={stopGeneration}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-accent-error text-white font-medium hover:bg-accent-error/80 transition-colors"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
                Stop
              </button>
            )}
          </div>
        </div>
        <div className="text-xs text-text-muted mt-1">
          {isStreaming ? 'Press Escape to stop' : 'Press Cmd+Enter to send'}
        </div>
      </form>
    </SessionLayout>
  )
}
