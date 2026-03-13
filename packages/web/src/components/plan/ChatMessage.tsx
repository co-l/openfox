import type { Message } from '@openfox/shared'
import { Markdown } from '../shared/Markdown'
import { AssistantMessage } from './AssistantMessage'

interface ChatMessageProps {
  message: Message
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const isSystem = message.role === 'system'
  const isTool = message.role === 'tool'
  
  // Use unified AssistantMessage for assistant role
  if (isAssistant) {
    return <AssistantMessage message={message} />
  }
  
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
  
  // User message
  if (isUser) {
    return (
      <div className="flex justify-end my-2">
        <div className="max-w-[80%] rounded-lg p-3 bg-accent-primary text-white">
          <div className="whitespace-pre-wrap">{message.content}</div>
        </div>
      </div>
    )
  }
  
  // System or other messages
  return (
    <div className="flex justify-start my-2">
      <div className="max-w-[80%] rounded-lg p-3 bg-bg-tertiary text-text-primary">
        <Markdown content={message.content} />
      </div>
    </div>
  )
}
