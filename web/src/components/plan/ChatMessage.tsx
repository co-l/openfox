import { memo, useCallback, useRef, useState } from 'react'
import { OptionalScrollArea } from '../shared/OptionalScrollArea'
import type { Attachment, Message } from '@shared/types.js'
import type { TaskCompletedPayload } from '@shared/protocol.js'
import { Markdown } from '../shared/Markdown'
import { AssistantMessage } from './AssistantMessage'
import { TaskCompletedCard } from './TaskCompletedCard'
import { WorkflowStartedCard } from './WorkflowStartedCard'
import { MessageAttachments } from '../shared/MessageAttachments.js'
import { AttachmentPreview } from '../shared/AttachmentPreview.js'
import { AutoPromptCard } from './AutoPromptCard'
import { CheckIcon, CopyIcon, EditSmallIcon, ReloadIcon } from '../shared/icons'
import { useT } from '../../hooks/useT'
import { replayMessage, forkSession } from '../../lib/api.js'
import { AUTOSCROLL_REARM_EVENT } from './feed-window'
import { useSessionStore } from '../../stores/session.js'
import { copyToClipboard } from '../../lib/clipboard.js'
import { shouldAutofocus } from '../../lib/device'
import { useLocation } from 'wouter'
import { useContextMenu } from '../../hooks/useContextMenu'
import { useMessageContextMenu } from '../../hooks/useMessageContextMenu'

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
  const t = useT()
  const isAutoPrompt = message.messageKind === 'auto-prompt'
  const isCommand = message.messageKind === 'command'
  const isSystemGenerated = message.isSystemGenerated
  const loadSession = useSessionStore((s) => s.loadSession)
  const [, navigate] = useLocation()
  const [hovered, setHovered] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content)
  const [editAttachments, setEditAttachments] = useState<Attachment[]>(message.attachments ?? [])
  const [pending, setPending] = useState(false)
  const [forkPending, setForkPending] = useState(false)
  const [forkError, setForkError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { onContextMenu, contextMenu } = useContextMenu()

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

  const handleFork = async () => {
    if (!sessionId || !messageId || forkPending) return
    setForkPending(true)
    setForkError(null)
    const result = await forkSession(sessionId, messageId)
    setForkPending(false)
    if (result?.session) {
      const projectId = result.session.projectId
      navigate(`/p/${projectId}/s/${result.session.id}`)
    } else {
      setForkError(t({ en: 'Failed to fork session', fr: 'Échec de la duplication de la session' }))
    }
  }

  const handleReplay = async () => {
    if (!sessionId || !messageId || pending) return
    setPending(true)
    setError(null)
    const ok = await replayMessage(sessionId, messageId)
    setPending(false)
    if (ok) {
      window.dispatchEvent(new CustomEvent(AUTOSCROLL_REARM_EVENT))
      loadSession(sessionId, true)
    } else {
      setError(t({ en: 'Failed to replay', fr: 'Échec de la relecture' }))
    }
  }

  const handleEditConfirm = async () => {
    if (!sessionId || !messageId || !editContent.trim() || pending) return
    setPending(true)
    setError(null)
    const ok = await replayMessage(sessionId, messageId, editContent, editAttachments)
    setPending(false)
    if (ok) {
      window.dispatchEvent(new CustomEvent(AUTOSCROLL_REARM_EVENT))
      loadSession(sessionId, true)
      setEditing(false)
    } else {
      setError(t({ en: 'Failed to send', fr: 'Échec de l’envoi' }))
    }
  }

  const handleEditCancel = () => {
    setEditContent(message.content)
    setEditAttachments(message.attachments ?? [])
    setEditing(false)
    setError(null)
  }

  const actionsVisible = hovered && !editing && !pending
  const actionsClass = `flex items-center gap-0.5 self-end transition-[visibility,opacity] focus-within:visible focus-within:opacity-100 ${actionsVisible ? 'visible opacity-100' : 'invisible opacity-0'}`

  return (
    <div
      className="flex justify-end items-start gap-1.5 feed-item"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(e) => onContextMenu(e, !!sessionId && !!messageId)}
    >
      {!isSystemGenerated && (
        <div className={actionsClass}>
          <button
            onClick={() => {
              void handleCopy()
            }}
            title={t({ en: 'Copy', fr: 'Copier' })}
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
                  setEditAttachments(message.attachments ?? [])
                  setEditing(true)
                }}
                title={t({ en: 'Edit & resend', fr: 'Modifier et renvoyer' })}
                disabled={pending}
                className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary disabled:opacity-50"
              >
                <EditSmallIcon className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  void handleReplay()
                }}
                title={t({ en: 'Replay', fr: 'Rejouer' })}
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
            {isCommand
              ? t({ en: 'Command', fr: 'Commande' })
              : isAutoPrompt
                ? t({ en: 'Auto', fr: 'Auto' })
                : t({ en: 'System', fr: 'Système' })}
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
              autoFocus={shouldAutofocus()}
            />
            {editAttachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {editAttachments.map((attachment) => (
                  <AttachmentPreview
                    key={attachment.id}
                    attachment={attachment}
                    onRemove={(id) => setEditAttachments((prev) => prev.filter((a) => a.id !== id))}
                  />
                ))}
              </div>
            )}
            {error && <p className="text-xs text-accent-error">{error}</p>}
            <div className="flex justify-end gap-1.5">
              <button
                onClick={handleEditCancel}
                disabled={pending}
                className="px-4 py-1.5 rounded text-sm bg-bg-tertiary/50 text-text-muted hover:bg-bg-tertiary hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t({ en: 'Cancel', fr: 'Annuler' })}
              </button>
              <button
                onClick={() => {
                  void handleEditConfirm()
                }}
                disabled={pending || !editContent.trim()}
                className="px-4 py-1.5 rounded text-sm bg-accent-primary/20 text-accent-primary font-medium hover:bg-accent-primary/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {t({ en: 'Send', fr: 'Envoyer' })}
              </button>
            </div>
          </div>
        ) : (
          <>
            {(error || forkError) && <p className="text-xs text-accent-error mb-1">{error ?? forkError}</p>}
            <div className={`whitespace-pre-wrap break-words text-sm ${isSystemGenerated ? 'text-text-system' : ''}`}>
              {message.content}
            </div>
            {message.attachments && message.attachments.length > 0 && (
              <MessageAttachments attachments={message.attachments} messageId={message.id} />
            )}
          </>
        )}
      </div>

      {contextMenu(
        useMessageContextMenu(
          message,
          () => void handleCopy(),
          () => void handleFork(),
        ),
      )}
    </div>
  )
}

export const ChatMessage = memo(function ChatMessage({
  message,
  isLastAssistantMessage = false,
  messageId,
  sessionId,
}: ChatMessageProps) {
  const t = useT()
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
        <div className="text-text-muted text-xs mb-0.5">{t({ en: '[Compacted]', fr: '[Compacté]' })}</div>
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
          {t({ en: 'Tool:', fr: 'Outil :' })} {message.toolName}
        </div>
        <OptionalScrollArea horizontal className="max-h-32">
          <pre className="text-text-secondary text-xs whitespace-pre-wrap break-words">
            {message.content.slice(0, 500)}
            {message.content.length > 500 && '...'}
          </pre>
        </OptionalScrollArea>
      </div>
    )
  }

  if (message.messageKind === 'workflow-started') {
    try {
      const data = JSON.parse(message.content) as {
        workflowName: string
        workflowId: string
        workflowColor?: string
        autoLaunched?: boolean
      }
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
          <span className="text-[10px] block mb-0.5 text-text-system">{t({ en: 'System', fr: 'Système' })}</span>
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
