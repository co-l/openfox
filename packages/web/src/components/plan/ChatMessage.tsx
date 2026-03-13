import type { Message } from '@openfox/shared'
import { Markdown } from '../shared/Markdown'

interface ChatMessageProps {
  message: Message
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const isTool = message.role === 'tool'
  
  if (isSystem && message.isCompacted) {
    return (
      <div className="bg-bg-tertiary/50 border border-border rounded-lg p-3 my-2">
        <div className="text-text-muted text-sm mb-1">[Compacted History]</div>
        <div className="text-text-secondary text-sm whitespace-pre-wrap">
          {message.content.replace('[COMPACTED HISTORY]\n', '')}
        </div>
      </div>
    )
  }
  
  if (isTool) {
    return (
      <div className="bg-bg-tertiary/30 border-l-2 border-accent-primary rounded-r-lg p-3 my-2">
        <div className="text-accent-primary text-sm mb-1">
          Tool: {message.toolName}
        </div>
        <pre className="text-text-secondary text-sm whitespace-pre-wrap overflow-x-auto max-h-48">
          {message.content.slice(0, 500)}
          {message.content.length > 500 && '...'}
        </pre>
      </div>
    )
  }
  
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} my-2`}>
      <div
        className={`max-w-[80%] rounded-lg p-3 ${
          isUser
            ? 'bg-accent-primary text-white'
            : 'bg-bg-tertiary text-text-primary'
        }`}
      >
        {message.thinkingContent && (
          <div className="text-text-muted text-sm mb-2 pb-2 border-b border-border/50 italic">
            <Markdown content={message.thinkingContent} />
          </div>
        )}
        {isUser ? (
          <div className="whitespace-pre-wrap">{message.content}</div>
        ) : (
          <Markdown content={message.content} />
        )}
      </div>
    </div>
  )
}

interface StreamingMessageProps {
  content: string
  thinking: string
}

export function StreamingMessage({ content, thinking }: StreamingMessageProps) {
  if (!content && !thinking) return null
  
  return (
    <div className="flex justify-start my-2">
      <div className="max-w-[80%] rounded-lg p-3 bg-bg-tertiary text-text-primary">
        {thinking && (
          <div className="text-text-muted text-sm mb-2 pb-2 border-b border-border/50 italic">
            <Markdown content={thinking} />
            <span className="animate-pulse">|</span>
          </div>
        )}
        {content && (
          <div>
            <Markdown content={content} />
            <span className="animate-pulse text-accent-primary">|</span>
          </div>
        )}
      </div>
    </div>
  )
}
