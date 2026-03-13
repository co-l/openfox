import { useState, useRef, useEffect } from 'react'
import { useSessionStore } from '../../stores/session'
import { ChatMessage, StreamingMessage } from './ChatMessage'
import { CriteriaEditor } from './CriteriaEditor'
import { Button } from '../shared/Button'
import { PlanToolCalls } from './PlanToolCalls'

export function PlanPanel() {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  const session = useSessionStore(state => state.currentSession)
  const streamingText = useSessionStore(state => state.streamingText)
  const streamingThinking = useSessionStore(state => state.streamingThinking)
  const isStreaming = useSessionStore(state => state.isStreaming)
  const planToolEvents = useSessionStore(state => state.planToolEvents)
  
  const sendMessage = useSessionStore(state => state.sendPlanMessage)
  const editCriteria = useSessionStore(state => state.editCriteria)
  const acceptCriteria = useSessionStore(state => state.acceptCriteria)
  
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }
  
  useEffect(() => {
    scrollToBottom()
  }, [session?.messages, streamingText])
  
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
  
  const isPlanning = session?.phase === 'planning' || session?.phase === 'idle'
  
  return (
    <div className="flex h-full">
      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto p-4">
          {session?.messages
            .filter(m => m.role !== 'tool' || m.toolResult?.success === false)
            .map(message => (
              <ChatMessage key={message.id} message={message} />
            ))}
          
          {isStreaming && (
            <>
              {planToolEvents.length > 0 && (
                <PlanToolCalls events={planToolEvents} />
              )}
              <StreamingMessage content={streamingText} thinking={streamingThinking} />
            </>
          )}
          
          <div ref={messagesEndRef} />
        </div>
        
        {isPlanning && (
          <form onSubmit={handleSubmit} className="p-4 border-t border-border">
            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe what you want to build..."
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
        )}
      </div>
      
      {/* Criteria Panel */}
      <div className="w-80 border-l border-border p-4">
        <CriteriaEditor
          criteria={session?.criteria ?? []}
          editable={isPlanning}
          onUpdate={editCriteria}
          onAccept={acceptCriteria}
        />
      </div>
    </div>
  )
}
