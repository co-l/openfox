import { useState, useRef, useEffect } from 'react'
import type { Message } from '@openfox/shared'
import { Markdown } from '../shared/Markdown'
import { AssistantMessage } from './AssistantMessage'
import { PromptInspector } from '../shared/PromptInspector'

interface ChatMessageProps {
  message: Message
  isLastAssistantMessage?: boolean
}

interface UserMessageProps {
  message: Message
}

function UserMessage({ message }: UserMessageProps) {
  const [showMenu, setShowMenu] = useState(false)
  const [showInspector, setShowInspector] = useState(false)
  const [copied, setCopied] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  
  const hasPromptContext = !!message.promptContext
  
  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showMenu])
  
  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    setShowMenu(false)
    setTimeout(() => setCopied(false), 1500)
  }
  
  const isAutoPrompt = message.messageKind === 'auto-prompt'
  const isSystemGenerated = message.isSystemGenerated
  
  return (
    <div className="flex justify-end items-start gap-1.5 feed-item">
      {/* Copy feedback checkmark */}
      {copied && (
        <svg className="w-4 h-4 text-accent-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      )}
      
      {/* Three-dot menu */}
      {!isSystemGenerated && (
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary"
            title="Message options"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          </button>
          
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 bg-bg-secondary border border-border rounded-lg shadow-xl z-50 py-1 min-w-36">
              <button
                onClick={handleCopy}
                className="w-full px-3 py-1.5 text-left text-sm text-text-primary hover:bg-bg-tertiary flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy
              </button>
              {hasPromptContext && (
                <button
                  onClick={() => {
                    setShowInspector(true)
                    setShowMenu(false)
                  }}
                  className="w-full px-3 py-1.5 text-left text-sm text-text-primary hover:bg-bg-tertiary flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  Inspect
                </button>
              )}
            </div>
          )}
        </div>
      )}
      
      {/* Prompt Inspector Modal */}
      {message.promptContext && (
        <PromptInspector
          isOpen={showInspector}
          onClose={() => setShowInspector(false)}
          promptContext={message.promptContext}
        />
      )}
      
      <div className={`max-w-[75%] rounded p-2 ${
        isSystemGenerated
          ? isAutoPrompt 
            ? 'bg-slate-500/10 border border-slate-500/30' 
            : 'bg-amber-500/10 border border-amber-500/30'
          : 'bg-accent-primary text-white'
      }`}>
        {isSystemGenerated && (
          <span className={`text-[10px] block mb-0.5 ${
            isAutoPrompt ? 'text-slate-400' : 'text-amber-400'
          }`}>
            {isAutoPrompt ? 'Auto' : 'System'}
          </span>
        )}
        <div className={`whitespace-pre-wrap text-sm ${
          isSystemGenerated
            ? `${isAutoPrompt ? 'text-slate-200' : 'text-amber-200 italic'}`
            : ''
        }`}>
          {message.content}
        </div>
      </div>
    </div>
  )
}

export function ChatMessage({ message, isLastAssistantMessage = false }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const isSystem = message.role === 'system'
  const isTool = message.role === 'tool'
  
  // Use unified AssistantMessage for assistant role
  if (isAssistant) {
    return <AssistantMessage message={message} showStats={isLastAssistantMessage} />
  }
  
  if (isSystem && message.isCompacted) {
    return (
      <div className="feed-item bg-bg-tertiary/50 border border-border rounded p-2">
        <div className="text-text-muted text-xs mb-0.5">[Compacted]</div>
        <div className="text-text-secondary text-xs whitespace-pre-wrap">
          {message.content.replace('[COMPACTED HISTORY]\n', '')}
        </div>
      </div>
    )
  }
  
  if (isTool) {
    return (
      <div className="feed-item bg-bg-tertiary/30 border-l-2 border-accent-primary rounded-r p-2">
        <div className="text-accent-primary text-xs mb-0.5">
          Tool: {message.toolName}
        </div>
        <pre className="text-text-secondary text-xs whitespace-pre-wrap overflow-x-auto max-h-32">
          {message.content.slice(0, 500)}
          {message.content.length > 500 && '...'}
        </pre>
      </div>
    )
  }
  
  if (isTool) {
    return (
      <div className="feed-item bg-bg-tertiary/30 border-l-2 border-accent-primary rounded-r p-2">
        <div className="text-accent-primary text-xs mb-0.5">
          Tool: {message.toolName}
        </div>
        <pre className="text-text-secondary text-xs whitespace-pre-wrap overflow-x-auto max-h-32">
          {message.content.slice(0, 500)}
          {message.content.length > 500 && '...'}
        </pre>
      </div>
    )
  }
  
  // Context reset separator (full-width divider for fresh context)
  if (message.messageKind === 'context-reset') {
    return (
      <div className="flex items-center gap-4 mb-6 text-text-muted text-xs uppercase tracking-wide">
        <div className="flex-1 border-t border-border" />
        <span>{message.content}</span>
        <div className="flex-1 border-t border-border" />
      </div>
    )
  }
  
  // User message
  if (isUser) {
    return <UserMessage message={message} />
  }
  
  return (
    <div className="flex justify-start feed-item">
      <div className="max-w-[75%] rounded p-2 bg-bg-tertiary text-text-primary">
        <Markdown content={message.content} />
      </div>
    </div>
  )
}
