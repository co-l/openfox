import { useState, useRef, useEffect } from 'react'
import { useSessionStore } from '../../stores/session'
import { SessionLayout } from '../layout/SessionLayout'
import { ChatMessage } from './ChatMessage'
import { AssistantMessage } from './AssistantMessage'
import { Button } from '../shared/Button'

export function PlanPanel() {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  
  const session = useSessionStore(state => state.currentSession)
  const isStreaming = useSessionStore(state => state.isStreaming)
  const chatStreamEvents = useSessionStore(state => state.chatStreamEvents)
  const error = useSessionStore(state => state.error)
  
  const sendMessage = useSessionStore(state => state.sendMessage)
  const clearError = useSessionStore(state => state.clearError)
  
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }
  
  useEffect(() => {
    scrollToBottom()
  }, [session?.messages, chatStreamEvents])
  
  // Auto-focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus()
  }, [session?.id])
  
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
  
  return (
    <SessionLayout criteriaEditable={isPlanning}>
      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4">
        {session?.messages
          .filter(m => m.role !== 'tool' || m.toolResult?.success === false)
          .map(message => (
            <ChatMessage key={message.id} message={message} />
          ))}
        
        {isStreaming && chatStreamEvents.length > 0 && (
          <AssistantMessage events={chatStreamEvents} isStreaming />
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
        
        <div ref={messagesEndRef} />
      </div>
      
      {/* Chat input - always visible, user can send messages in any mode */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-border">
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
          <Button
            type="submit"
            variant="primary"
            disabled={!input.trim() || isStreaming}
            className="self-end"
          >
            Send
          </Button>
        </div>
        <div className="text-xs text-text-muted mt-1">
          Press Cmd+Enter to send
        </div>
      </form>
    </SessionLayout>
  )
}
