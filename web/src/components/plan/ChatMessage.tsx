import { memo } from 'react'
import type { Message, PromptContext } from '@shared/types.js'
import { Markdown } from '../shared/Markdown'
import { AssistantMessage } from './AssistantMessage'
import { MessageAttachments } from '../shared/MessageAttachments.js'
import { MessageOptionsMenu } from './MessageOptionsMenu'

interface ChatMessageProps {
  message: Message
  isLastAssistantMessage?: boolean
  promptContext?: PromptContext
}

interface UserMessageProps {
  message: Message
  promptContext?: PromptContext
}

function UserMessage({ message, promptContext }: UserMessageProps) {
  const isAutoPrompt = message.messageKind === 'auto-prompt'
  const isSystemGenerated = message.isSystemGenerated
  
  return (
    <div className="flex justify-end items-start gap-1.5 feed-item">
      {!isSystemGenerated && (
        <MessageOptionsMenu content={message.content} promptContext={promptContext} align="right" />
      )}

      <div className={`max-w-[75%] rounded p-2 ${
        isSystemGenerated
          ? isAutoPrompt 
            ? 'bg-slate-500/10 border border-slate-500/30' 
            : 'bg-amber-500/10 border border-amber-500/30'
          : 'bg-accent-primary/15 text-white'
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
        {message.attachments && message.attachments.length > 0 && (
          <MessageAttachments attachments={message.attachments} />
        )}
      </div>
    </div>
  )
}

export const ChatMessage = memo(function ChatMessage({ message, isLastAssistantMessage = false, promptContext }: ChatMessageProps) {
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
    return <UserMessage message={message} promptContext={promptContext} />
  }
  
  return (
    <div className="flex justify-start feed-item">
      <div className="max-w-[75%] rounded p-2 bg-bg-tertiary text-text-primary">
        <Markdown content={message.content} />
      </div>
    </div>
  )
})
