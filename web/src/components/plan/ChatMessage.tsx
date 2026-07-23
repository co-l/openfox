import { memo, useCallback, useRef, useState } from 'react'
import type { Message } from '@shared/types.js'
import type { TaskCompletedPayload } from '@shared/protocol.js'
import { Markdown } from '../shared/Markdown'
import { AssistantMessage } from './AssistantMessage'
import { TaskCompletedCard } from './TaskCompletedCard'
import { WorkflowStartedCard } from './WorkflowStartedCard'
import { MessageAttachments } from '../shared/MessageAttachments.js'
import { AutoPromptCard } from './AutoPromptCard'
import { CheckIcon, CopyIcon, EditSmallIcon, ReloadIcon, XCloseIcon } from '../shared/icons'
import { replayMessage } from '../../lib/api.js'
import { useSessionStore } from '../../stores/session.js'
import { copyToClipboard } from '../../lib/clipboard.js'

interface ChatMessageProps {
  message: Message
  isLastAssistantMessage?: boolean
  messageId?: string
  sessionId?: string
}

interface UserMessageProps {
  message: Message
  messageId?: string
  sessionId?: string
}

function UserMessage({ message, messageId, sessionId }: UserMessageProps) {
  const isAutoPrompt = message.messageKind === 'auto-prompt'
  const isCommand = message.messageKind === 'command'
  const isSystemGenerated = message.isSystemGenerated
  const loadSession = useSessionStore((s) => s.loadSession)
  const [hovered, setHovered] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const autoResize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  const handleCopy = async () => {
    try {
      await copyToClipboard(message.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  const handleReplay = async () => {
    if (!sessionId || !messageId || pending) return
    setPending(true)
    setError(null)
    const ok = await replayMessage(sessionId, messageId)
    setPending(false)
    if (ok) {
      loadSession(sessionId)
    } else {
      setError('Failed to replay')
    }
  }

  const handleEditConfirm = async () => {
    if (!sessionId || !messageId || !editContent.trim() || pending) return
    setPending(true)
    setError(null)
    const ok = await replayMessage(sessionId, messageId, editContent)
    setPending(false)
    if (ok) {
      loadSession(sessionId)
      setEditing(false)
    } else {
      setError('Failed to send')
    }
  }

  const handleEditCancel = () => {
    setEditContent(message.content)
    setEditing(false)
    setError(null)
  }

  const actionsVisible = hovered && !editing && !pending
  const actionsClass = `flex items-center gap-0.5 self-end transition-opacity focus-within:opacity-100 focus-within:pointer-events-auto ${actionsVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`

  return (
    <div
      className="flex justify-end items-start gap-1.5 feed-item"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {!isSystemGenerated && (
        <div className={actionsClass}>
          <button
            onClick={() => {
              void handleCopy()
            }}
            title="Copy"
            disabled={pending}
            className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary disabled:opacity-50"
          >
            {copied ? <CheckIcon className="w-3.5 h-3.5 text-accent-success" /> : <CopyIcon className="w-3.5 h-3.5" />}
          </button>
          {sessionId && messageId && (
            <>
              <button
                onClick={() => {
                  setError(null)
                  setEditContent(message.content)
                  setEditing(true)
                }}
                title="Edit & resend"
                disabled={pending}
                className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary disabled:opacity-50"
              >
                <EditSmallIcon className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  void handleReplay()
                }}
                title="Replay"
                disabled={pending}
                className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary disabled:opacity-50"
              >
                <ReloadIcon className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      )}

      <div
        className={`max-w-[75%] ${editing ? 'w-full' : ''} rounded p-2 ${
          isSystemGenerated ? 'bg-bg-system border border-border-system' : 'bg-accent-primary/15 text-text-primary'
        }`}
      >
        {isSystemGenerated && (
          <span className="text-[10px] block mb-0.5 text-text-system">
            {isCommand ? 'Command' : isAutoPrompt ? 'Auto' : 'System'}
          </span>
        )}
        {editing ? (
          <div className="flex flex-col gap-1.5">
            <textarea
              ref={(el) => {
                ;(textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el
                if (el) {
                  el.style.height = 'auto'
                  el.style.height = `${el.scrollHeight}px`
                }
              }}
              className="w-full bg-bg-primary border border-border rounded p-1.5 text-sm text-text-primary resize-none focus:outline-none focus:border-accent-primary min-h-[60px] overflow-hidden disabled:opacity-50"
              value={editContent}
              onChange={(e) => {
                setEditContent(e.target.value)
                autoResize()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void handleEditConfirm()
                }
                if (e.key === 'Escape') handleEditCancel()
              }}
              disabled={pending}
              autoFocus
            />
            {error && <p className="text-xs text-accent-error">{error}</p>}
            <div className="flex justify-end gap-1">
              <button
                onClick={handleEditCancel}
                disabled={pending}
                className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary disabled:opacity-50"
                title="Cancel"
              >
                <XCloseIcon className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  void handleEditConfirm()
                }}
                disabled={pending || !editContent.trim()}
                className="p-1 rounded hover:bg-bg-tertiary text-accent-primary hover:text-accent-primary disabled:opacity-50"
                title="Confirm (Ctrl+Enter)"
              >
                <CheckIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <>
            {error && <p className="text-xs text-accent-error mb-1">{error}</p>}
            <div className={`whitespace-pre-wrap break-words text-sm ${isSystemGenerated ? 'text-text-system' : ''}`}>
              {message.content}
            </div>
            {message.attachments && message.attachments.length > 0 && (
              <MessageAttachments attachments={message.attachments} messageId={message.id} />
            )}
          </>
        )}
      </div>
    </div>
  )
}

export const ChatMessage = memo(function ChatMessage({
  message,
  isLastAssistantMessage = false,
  messageId,
  sessionId,
}: ChatMessageProps) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const isSystem = message.role === 'system'
  const isTool = message.role === 'tool'

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
        <pre className="text-text-secondary text-xs whitespace-pre-wrap break-words overflow-x-auto max-h-32">
          {message.content.slice(0, 500)}
          {message.content.length > 500 && '...'}
        </pre>
      </div>
    )
  }

  if (message.messageKind === 'workflow-started') {
    try {
      const data = JSON.parse(message.content) as { workflowName: string; workflowId: string; workflowColor?: string }
      return <WorkflowStartedCard data={data} />
    } catch {
      // Fall through to default rendering
    }
  }

  if (message.messageKind === 'task-completed') {
    try {
      const data = JSON.parse(message.content) as TaskCompletedPayload
      return <TaskCompletedCard data={data} />
    } catch {
      // Fall through to default rendering
    }
  }

  if (message.messageKind === 'context-reset') {
    return (
      <div className="flex items-center gap-4 mb-6 text-text-muted text-xs uppercase tracking-wide">
        <div className="flex-1 border-t border-border" />
        <span>{message.content}</span>
        <div className="flex-1 border-t border-border" />
      </div>
    )
  }

  if (message.messageKind === 'auto-prompt' && message.isSystemGenerated) {
    return <AutoPromptCard message={message} />
  }

  if (message.messageKind === 'correction' && message.isSystemGenerated) {
    return (
      <div className="flex justify-end feed-item">
        <div className="max-w-[75%] rounded p-2 bg-bg-system border border-border-system">
          <span className="text-[10px] block mb-0.5 text-text-system">System</span>
          <div className="whitespace-pre-wrap break-words text-sm text-text-system italic">{message.content}</div>
        </div>
      </div>
    )
  }

  if (isUser) {
    return <UserMessage message={message} messageId={messageId} sessionId={sessionId} />
  }

  return (
    <div className="flex justify-start feed-item">
      <div className="max-w-[75%] rounded p-2 bg-bg-tertiary text-text-primary">
        <Markdown content={message.content} />
      </div>
    </div>
  )
})
