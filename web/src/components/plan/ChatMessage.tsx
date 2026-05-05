import { memo } from 'react'
import type { Message, PromptContext } from '@shared/types.js'
import type { TaskCompletedPayload } from '@shared/protocol.js'
import { Markdown } from '../shared/Markdown'
import { AssistantMessage } from './AssistantMessage'
import { TaskCompletedCard } from './TaskCompletedCard'
import { WorkflowStartedCard } from './WorkflowStartedCard'
import { MessageAttachments } from '../shared/MessageAttachments.js'
import { MessageOptionsMenu } from './MessageOptionsMenu'
import { AutoPromptCard } from './AutoPromptCard'

interface ChatMessageProps {
  message: Message
  isLastAssistantMessage?: boolean
  promptContext?: PromptContext
  messageIndex?: number
  sessionId?: string
}

interface UserMessageProps {
  message: Message
  promptContext?: PromptContext
  messageIndex?: number
  sessionId?: string
}

function UserMessage({ message, promptContext, messageIndex, sessionId }: UserMessageProps) {
  const isAutoPrompt = message.messageKind === 'auto-prompt'
  const isCommand = message.messageKind === 'command'
  const isSystemGenerated = message.isSystemGenerated

  return (
    <div className="flex justify-end items-start gap-1.5 feed-item">
      {!isSystemGenerated && (
        <MessageOptionsMenu
          content={message.content}
          promptContext={promptContext}
          align="right"
          messageIndex={messageIndex}
          sessionId={sessionId}
        />
      )}

      <div
        className={`max-w-[75%] rounded p-2 ${
          isSystemGenerated
            ? isCommand
              ? 'bg-teal-500/10 border border-teal-500/30'
              : isAutoPrompt
                ? 'bg-slate-500/10 border border-slate-500/30'
                : 'bg-amber-500/10 border border-amber-500/30'
            : 'bg-accent-primary/15 text-text-primary'
        }`}
      >
        {isSystemGenerated && (
          <span
            className={`text-[10px] block mb-0.5 ${
              isCommand ? 'text-teal-400' : isAutoPrompt ? 'text-slate-400' : 'text-amber-400'
            }`}
          >
            {isCommand ? 'Command' : isAutoPrompt ? 'Auto' : 'System'}
          </span>
        )}
        <div
          className={`whitespace-pre-wrap text-sm ${
            isSystemGenerated
              ? `${isCommand ? 'text-teal-200' : isAutoPrompt ? 'text-slate-200' : 'text-amber-200 italic'}`
              : ''
          }`}
        >
          {message.content}
        </div>
        {message.attachments && message.attachments.length > 0 && (
          <MessageAttachments attachments={message.attachments} messageId={message.id} />
        )}
      </div>
    </div>
  )
}

export const ChatMessage = memo(function ChatMessage({
  message,
  isLastAssistantMessage = false,
  promptContext,
  messageIndex,
  sessionId,
}: ChatMessageProps) {
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
        <div className="text-accent-primary text-xs mb-0.5">Tool: {message.toolName}</div>
        <pre className="text-text-secondary text-xs whitespace-pre-wrap overflow-x-auto max-h-32">
          {message.content.slice(0, 500)}
          {message.content.length > 500 && '...'}
        </pre>
      </div>
    )
  }

  // Workflow started card
  if (message.messageKind === 'workflow-started') {
    try {
      const data = JSON.parse(message.content) as { workflowName: string; workflowId: string; workflowColor?: string }
      return <WorkflowStartedCard data={data} />
    } catch {
      // Fall through to default rendering
    }
  }

  // Task completed card — rendered from marker message
  if (message.messageKind === 'task-completed') {
    try {
      const data = JSON.parse(message.content) as TaskCompletedPayload
      return <TaskCompletedCard data={data} />
    } catch {
      // Fall through to default rendering
    }
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

  // Auto-prompt message - show compact card instead of full content
  if (message.messageKind === 'auto-prompt' && message.isSystemGenerated) {
    return <AutoPromptCard message={message} />
  }

  // User message
  if (isUser) {
    return (
      <UserMessage message={message} promptContext={promptContext} messageIndex={messageIndex} sessionId={sessionId} />
    )
  }

  return (
    <div className="flex justify-start feed-item">
      <div className="max-w-[75%] rounded p-2 bg-bg-tertiary text-text-primary">
        <Markdown content={message.content} />
      </div>
    </div>
  )
})
