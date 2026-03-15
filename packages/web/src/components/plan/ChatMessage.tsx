import { useState } from 'react'
import type { Message } from '@openfox/shared'
import { Markdown } from '../shared/Markdown'
import { AssistantMessage } from './AssistantMessage'

interface ChatMessageProps {
  message: Message
  isLastAssistantMessage?: boolean
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  
  return (
    <button
      onClick={handleCopy}
      className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/20"
      title="Copy"
    >
      {copied ? (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
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
      <div className="bg-bg-tertiary/50 border border-border rounded p-2 my-1">
        <div className="text-text-muted text-xs mb-0.5">[Compacted]</div>
        <div className="text-text-secondary text-xs whitespace-pre-wrap">
          {message.content.replace('[COMPACTED HISTORY]\n', '')}
        </div>
      </div>
    )
  }
  
  if (isTool) {
    return (
      <div className="bg-bg-tertiary/30 border-l-2 border-accent-primary rounded-r p-2 my-1">
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
      <div className="bg-bg-tertiary/30 border-l-2 border-accent-primary rounded-r p-2 my-1">
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
      <div className="flex items-center gap-4 my-6 text-text-muted text-xs uppercase tracking-wide">
        <div className="flex-1 border-t border-border" />
        <span>{message.content}</span>
        <div className="flex-1 border-t border-border" />
      </div>
    )
  }
  
  // User message
  if (isUser) {
    if (message.isSystemGenerated) {
      const isAutoPrompt = message.messageKind === 'auto-prompt'
      
      return (
        <div className="flex justify-end items-start gap-1.5 my-1">
          <div className={`max-w-[75%] rounded border p-2 ${
            isAutoPrompt 
              ? 'bg-slate-500/10 border-slate-500/30' 
              : 'bg-amber-500/10 border-amber-500/30'
          }`}>
            <span className={`text-[10px] block mb-0.5 ${
              isAutoPrompt ? 'text-slate-400' : 'text-amber-400'
            }`}>
              {isAutoPrompt ? 'Auto' : 'System'}
            </span>
            <div className={`whitespace-pre-wrap text-xs ${
              isAutoPrompt ? 'text-slate-200' : 'text-amber-200 italic'
            }`}>
              {message.content}
            </div>
          </div>
        </div>
      )
    }
    
    return (
      <div className="flex justify-end items-start gap-1.5 my-1 group">
        <CopyButton text={message.content} />
        <div className="max-w-[75%] rounded p-2 bg-accent-primary text-white">
          <div className="whitespace-pre-wrap text-sm">{message.content}</div>
        </div>
      </div>
    )
  }
  
  return (
    <div className="flex justify-start my-1">
      <div className="max-w-[75%] rounded p-2 bg-bg-tertiary text-text-primary">
        <Markdown content={message.content} />
      </div>
    </div>
  )
}
