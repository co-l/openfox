import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react'
import { useSessionStore, useIsRunning, useQueuedMessages } from '../../stores/session'
// @ts-ignore
import type { Message, ToolCall, Attachment } from '@shared/types.js'
import { SessionLayout } from '../layout/SessionLayout'
import { SessionHeader } from './SessionHeader'
import { ChatMessage } from './ChatMessage'
import { AssistantMessage } from './AssistantMessage'
import { SubAgentContainer } from './SubAgentContainer'
import { AgentSelector } from './AgentSelector'
import { DangerLevelSelector } from './DangerLevelSelector'
import { AskUserDialog } from '../shared/AskUserDialog'
import { ConnectionStatusBar } from '../shared/ConnectionStatusBar'
import { RunningIndicator } from '../shared/RunningIndicator'
import { CriteriaGroupDisplay } from '../shared/CriteriaGroupDisplay'
import { AttachmentPreview } from '../shared/AttachmentPreview.js'
import { PromptHistoryList } from '../shared/PromptHistory.js'
import { Markdown } from '../shared/Markdown.js'
import { CloseButton } from '../shared/CloseButton'
import { useWorkflowsStore } from '../../stores/workflows'
import { processImageFile } from '../../lib/image-processing.js'
import { buildPromptContextByUserMessageId } from './prompt-context-linking.js'
import { ProviderSelector } from '../settings/ProviderSelector'
import { CommandMenu } from './CommandMenu'
import { WorkflowMenu } from './WorkflowMenu'
import { CommandsModal } from '../settings/CommandsModal'
import { WorkflowsModal } from '../settings/WorkflowsModal'

import { groupMessages, type DisplayItem } from './groupMessages.js'
import { usePromptHistory } from '../../hooks/usePromptHistory.js'
import { useAutoScroll } from "@/hooks/useAutoScroll.ts"

interface PlanPanelProps {
  criteriaSidebarOpen?: boolean
  onCriteriaSidebarToggle?: () => void
}

export function PlanPanel({ criteriaSidebarOpen: externalCriteriaSidebarOpen, onCriteriaSidebarToggle }: PlanPanelProps = {}) {
  const criteriaSidebarOpen = externalCriteriaSidebarOpen ?? true
  const [input, setInput] = useState('')

  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [showCommandsModal, setShowCommandsModal] = useState(false)
  const [showWorkflowsModal, setShowWorkflowsModal] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const session = useSessionStore(state => state.currentSession)
  const rawMessages = useSessionStore(state => state.messages)
  const streamingMessage = useSessionStore(state => state.streamingMessage)
  const sessions = useSessionStore(state => state.sessions)
  const error = useSessionStore(state => state.error)
  const pendingQuestion = useSessionStore(state => state.pendingQuestion)
  const isRunning = useIsRunning()

  const sendMessage = useSessionStore(state => state.sendMessage)
  const clearError = useSessionStore(state => state.clearError)
  const acceptAndBuild = useSessionStore(state => state.acceptAndBuild)
  const stopGeneration = useSessionStore(state => state.stopGeneration)
  const launchRunner = useSessionStore(state => state.launchRunner)
  const cancelQueued = useSessionStore(state => state.cancelQueued)
  const queuedMessages = useQueuedMessages()

  const workflows = useWorkflowsStore(state => state.workflows)
  const fetchWorkflows = useWorkflowsStore(state => state.fetchWorkflows)
  useEffect(() => {
    fetchWorkflows()
  }, [fetchWorkflows])

  // Prompt history navigation
  const {
    history,
    selectedIndex,
    showHistory,
    openHistory,
    closeHistory,
    navigateUp,
    navigateDown,
    selectCurrent,
  } = usePromptHistory(rawMessages, sessions, session?.id)

  // Merge streamingMessage into the messages array for rendering.
  // When streaming, only the streamingMessage changes — rawMessages stays stable,
  // so groupMessages() and promptContext skip recomputation for non-streaming items.
  const messages = useMemo(() => {
    if (!streamingMessage) return rawMessages
    return rawMessages.map(m => m.id === streamingMessage.id ? streamingMessage : m)
  }, [rawMessages, streamingMessage])

  // Ref to store previous displayItems for identity preservation
  const previousDisplayItemsRef = useRef<DisplayItem[]>([])

  // Group messages for display, collapsing sub-agent messages into containers
  const displayItems = useMemo((): DisplayItem[] => {
    const items = groupMessages(messages, previousDisplayItemsRef.current)
    previousDisplayItemsRef.current = items
    return items
  }, [messages])

  // Use rawMessages (stable during streaming) since prompt context only depends on user messages
  const promptContextByUserMessageId = useMemo(() => buildPromptContextByUserMessageId(rawMessages), [rawMessages])

  // TEMP: Auto-start test messages on page load
/*  useEffect(() => {
    testInterval.current = setInterval(() => {
      setTestMessageCount(prev => prev + 1)
    }, 2000)
    return () => {
      if (testInterval.current) clearInterval(testInterval.current)
    }
  }, [])*/

  const {force_scroll_to_bottom, isAutoScrollActive, setAutoScroll} = useAutoScroll(scrollContainerRef, session)

  // Auto-resize textarea based on content, up to 200px max
  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    // Reset height to auto to get correct scrollHeight
    textarea.style.height = 'auto'
    // Calculate new height based on content
    const newHeight = Math.min(200, textarea.scrollHeight)
    textarea.style.height = `${newHeight}px`
  }, [])

  // Load draft from localStorage on session change
  useEffect(() => {
    if (!session?.id) return
    const draftKey = `openfox:draft:${session.id}`
    const savedDraft = localStorage.getItem(draftKey)
    if (savedDraft !== null) {
      setInput(savedDraft)
    }
  }, [session?.id])

  // Auto-focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus()
    resizeTextarea()
  }, [session?.id, resizeTextarea])

  // Throttled save of draft to localStorage
  useEffect(() => {
    if (!session?.id) return
    const draftKey = `openfox:draft:${session.id}`
    const timeoutId = setTimeout(() => {
      if (input) {
        localStorage.setItem(draftKey, input)
      } else {
        localStorage.removeItem(draftKey)
      }
    }, 500)
    return () => clearTimeout(timeoutId)
  }, [session?.id, input])

  // Resize textarea when input changes
  useEffect(() => {
    resizeTextarea()
  }, [input, resizeTextarea])

  // Escape key to stop generation
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isRunning) {
        stopGeneration()
      }
      if (e.key === 'ScrollLock') {
        setAutoScroll(!isAutoScrollActive)
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isRunning, stopGeneration, isAutoScrollActive])

  // Paste event listener for textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    const handlePaste = async (e: ClipboardEvent) => {
      // Only handle if the textarea is focused
      if (document.activeElement !== textarea) return

      const items = e.clipboardData?.items
      if (!items) return

      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const file = item.getAsFile()
          if (!file) continue

          await processImageFile(
            file,
            att => setAttachments(prev => [...prev, att]),
            setErrorMessage,
            { filename: 'pasted-image' }
          )
        }
      }
    }

    textarea.addEventListener('paste', handlePaste)
    return () => textarea.removeEventListener('paste', handlePaste)
  }, [])

  const clearInput = () => {
    setInput('')
    setAttachments([])
    if (session?.id) {
      localStorage.removeItem(`openfox:draft:${session.id}`)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!input.trim() && attachments.length === 0) return

    // Always use unified sendMessage - handles both idle and running cases
    // When running, backend queues it; when idle, processes immediately
    force_scroll_to_bottom()

    sendMessage(input, attachments.length > 0 ? attachments : undefined)
    clearInput()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Handle prompt history navigation when history is visible
    if (showHistory) {
      switch (e.key) {
        case 'Enter':
          e.preventDefault()
          const selectedContent = selectCurrent()
          if (selectedContent) {
            setInput(selectedContent)
            closeHistory()
          }
          return
        case 'Escape':
          e.preventDefault()
          closeHistory()
          if (isRunning) stopGeneration()
          return
        case 'ArrowUp':
          e.preventDefault()
          navigateUp()
          return
        case 'ArrowDown':
          e.preventDefault()
          navigateDown()
          return
      }
    }

    // Arrow Up on empty textarea opens history
    if (e.key === 'ArrowUp' && input.trim() === '' && !showHistory) {
      e.preventDefault()
      openHistory()
      return
    }

    // Normal textarea behavior
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  // Handle file selection from file picker
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setErrorMessage(null)

    for (const file of Array.from(files)) {
      await processImageFile(
        file,
        att => setAttachments(prev => [...prev, att]),
        setErrorMessage,
      )
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [])

  // Handle drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    setErrorMessage(null)

    const files = e.dataTransfer.files
    if (!files || files.length === 0) return

    for (const file of Array.from(files)) {
      await processImageFile(
        file,
        att => setAttachments(prev => [...prev, att]),
        setErrorMessage,
      )
    }
  }, [])

  // Handle remove attachment
  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(att => att.id !== id))
  }, [])

  // Handle attach button click
  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const isPlanning = session?.mode === 'planner'
  const isBuilding = session?.mode === 'builder'
  const hasCriteria = (session?.criteria.length ?? 0) > 0
  const isDone = session?.phase === 'done'

  // Show "Start Building" when in planner with criteria and assistant has responded
  // Don't show if already done (all criteria verified)
  const hasAssistantResponse = displayItems.some(item =>
    item.type === 'message' && item.message.role === 'assistant',
  )
  const showStartBuilding = isPlanning && hasCriteria && !isRunning && hasAssistantResponse && !isDone

  const handleSelectWorkflow = (workflowId: string) => {
    const content = input.trim() ? input : undefined
    const atts = attachments.length > 0 ? attachments : undefined
    if (isPlanning) {
      acceptAndBuild(workflowId, content, atts)
    } else if (isBuilding) {
      launchRunner(content, atts, workflowId)
    }
    clearInput()
  }

  return (
    <SessionLayout criteriaSidebarOpen={criteriaSidebarOpen} onCriteriaSidebarToggle={onCriteriaSidebarToggle} messages={messages}>
      {pendingQuestion && (
        <AskUserDialog question={pendingQuestion} />
      )}
      <SessionHeader />
      <ConnectionStatusBar />

      <div ref={scrollContainerRef} data-testid="chat-scroll-container" className="flex-1 min-w-0 overflow-y-auto relative">
        <div className="pt-4">
          {displayItems.map((item, index) => {
            if (item.type === 'context-divider') {
              return (
                <div key={index} className="flex items-center gap-2 feed-item px-2 md:px-4">
                  <div className="flex-1 border-t border-border" />
                  <span className="text-[10px] text-text-muted font-medium px-2">
                    Earlier context summarized
                  </span>
                  <div className="flex-1 border-t border-border" />
                </div>
              )
            }

            if (item.type === 'subagent') {
              const groupIsStreaming = item.messages.some(m => m.isStreaming)
              return (
                <div key={index} className="px-2 md:px-4">
                  <SubAgentContainer
                    messages={item.messages}
                    subAgentType={item.subAgentType}
                    subAgentId={item.subAgentId}
                    isStreaming={groupIsStreaming}
                  />
                </div>
              )
            }

            if (item.type === 'criteria-batch') {
              return (
                <div key={index} className="feed-item px-2 md:px-4">
                  <CriteriaGroupDisplay toolCalls={item.toolCalls} criteria={session?.criteria} />
                </div>
              )
            }

            const message = item.message
            if (message.role === 'assistant') {
              return (
                <div key={index} className="px-2 md:px-4">
                  <AssistantMessage
                    message={message}
                    showStats={true}
                  />
                </div>
              )
            }

            return (
              <div key={index} className="px-2 md:px-4">
                <ChatMessage
                  message={message}
                  isLastAssistantMessage={false}
                  promptContext={message.role === 'user' ? promptContextByUserMessageId[message.id] : undefined}
                />
              </div>
            )
          })}
        </div>
        <div className="px-2 md:px-4 pb-4">
          {error && (
            <div className="feed-item bg-red-500/10 border border-red-500/50 rounded p-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-red-400 text-sm font-medium">{error.code}</div>
                  <div className="text-red-300 text-xs mt-0.5">{error.message}</div>
                </div>
                <CloseButton
                  onClick={clearError}
                  className="text-red-400 hover:text-red-300 p-0.5"
                  size="sm"
                />
              </div>
            </div>
          )}

          {showStartBuilding && (
            <div className="flex justify-center gap-2 feed-item flex-wrap">
              {workflows.map(w => {
                const c = w.color ?? '#3b82f6'
                const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16)
                const bg = `rgba(${r},${g},${b},0.12)`
                const bgHover = `rgba(${r},${g},${b},0.22)`
                const border = `rgba(${r},${g},${b},0.25)`
                return (
                  <button
                    key={w.id}
                    onClick={() => acceptAndBuild(w.id)}
                    className="px-4 py-1.5 rounded text-sm font-medium transition-colors"
                    style={{ backgroundColor: bg, color: c, border: `1px solid ${border}` }}
                    onMouseEnter={e => {
                      e.currentTarget.style.backgroundColor = bgHover
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.backgroundColor = bg
                    }}
                  >
                    ▶ {w.name}
                  </button>
                )
              })}
            </div>
          )}

          {isRunning && <RunningIndicator />}
        </div>
      </div>

      <form onSubmit={handleSubmit}
            className="relative p-2 md:p-4 border-t border-border bg-gradient-to-t from-bg-secondary/50 to-transparent">
        <button
          type="button"
          className="absolute -top-8 right-2 md:right-4 text-sm text-text-muted hover:text-text-primary z-10 flex items-center gap-1.5"
          onClick={() => setAutoScroll(!isAutoScrollActive)}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isAutoScrollActive ? 'bg-accent-success' : 'border border-text-muted'}`} />
          live
        </button>
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.gif"
          onChange={handleFileSelect}
          className="hidden"
          multiple
        />

        {/* Error message */}
        {errorMessage && (
          <div className="mb-2 p-2 bg-red-500/10 border border-red-500/50 rounded text-red-300 text-sm">
            {errorMessage}
          </div>
        )}

        {/* Attachments preview area */}
        {attachments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <AttachmentPreview
                key={attachment.id}
                attachment={attachment}
                onRemove={handleRemoveAttachment}
              />
            ))}
          </div>
        )}

        {/* Prompt history list */}
        {showHistory && (
          <PromptHistoryList
            history={history}
            selectedIndex={selectedIndex}
            onSelect={(content) => {
              setInput(content)
              closeHistory()
            }}
            onEscape={closeHistory}
            onNavigate={(direction) => {
              if (direction === 'up') {
                navigateUp()
              } else {
                navigateDown()
              }
            }}
          />
        )}

        {/* Queued messages display */}
        {queuedMessages.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {queuedMessages.map((qm) => (
              <div
                key={qm.queueId}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
                  qm.mode === 'asap'
                    ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                    : 'bg-blue-500/15 text-blue-300 border border-blue-500/30'
                }`}
              >
                <span className="font-medium">{qm.mode === 'asap' ? 'ASAP' : 'Queue'}:</span>
                <span className="truncate max-w-[200px]">{qm.content}</span>
                <CloseButton
                  onClick={() => cancelQueued(qm.queueId)}
                  size="sm"
                />
              </div>
            ))}
          </div>
        )}

        <div
          className={`flex items-end gap-3 p-3 rounded border transition-colors ${
            dragOver
              ? 'border-accent-primary/50 bg-accent-primary/10'
              : 'border-border bg-bg-tertiary/50'
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Attach file button */}
          <button
            type="button"
            onClick={handleAttachClick}
            className="p-3 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title="Attach image file"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              // Hide history when user starts typing
              if (showHistory) {
                closeHistory()
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              isPlanning
                ? "What would you like to build?"
                : "Send a message..."
            }
            className="flex-1 bg-transparent text-sm placeholder:text-text-muted resize-none overflow-y-auto focus:outline-none"
            style={{ minHeight: '24px', maxHeight: '200px' }}
          />
          <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-3">
                <CommandMenu
                  onSendCommand={(content, agentMode, textareaContent, attachments) => {
                    if (agentMode && session?.mode !== agentMode) {
                      useSessionStore.getState().switchMode(agentMode)
                    }
                    const combinedContent = textareaContent && textareaContent.trim()
                      ? `${textareaContent.trim()}\n\n${content}`
                      : content
                    scrollContainerRef.current?.scrollTo({
                      top: scrollContainerRef.current.scrollHeight,
                      behavior: 'smooth',
                    })
                    sendMessage(combinedContent, attachments?.length ? attachments : undefined, {
                      messageKind: 'command',
                      isSystemGenerated: true,
                    })
                    clearInput()
                  }}
                  onOpenManager={() => setShowCommandsModal(true)}
                  textareaContent={input}
                  attachments={attachments.length > 0 ? attachments : undefined}
                />
                <WorkflowMenu
                  onSelectWorkflow={handleSelectWorkflow}
                  onOpenManager={() => setShowWorkflowsModal(true)}
                  criteria={session?.criteria ?? []}
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!input.trim() && attachments.length === 0) return
                    scrollContainerRef.current?.scrollTo({
                      top: scrollContainerRef.current.scrollHeight,
                      behavior: 'smooth',
                    })
                    sendMessage(input, attachments)
                    clearInput()
                  }}
                  disabled={(!input.trim() && attachments.length === 0)}
                  className="px-4 py-1.5 rounded bg-accent-primary/20 text-sm text-accent-primary font-medium hover:bg-accent-primary/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Send
                </button>
              </div>
            </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AgentSelector />
            <DangerLevelSelector />
          </div>
          <ProviderSelector />
        </div>
      </form>
      <CommandsModal isOpen={showCommandsModal} onClose={() => setShowCommandsModal(false)} />
      <WorkflowsModal isOpen={showWorkflowsModal} onClose={() => setShowWorkflowsModal(false)} />
    </SessionLayout>
  )
}

export interface VisionFallbackItemProps {
  item: { type: 'start' | 'done'; messageId: string; attachmentId: string; filename?: string; description?: string }
}

export const VisionFallbackItem = memo(function VisionFallbackItem({ item }: VisionFallbackItemProps) {
  const [expanded, setExpanded] = useState(false)

  if (item.type === 'start') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded text-amber-300 text-sm">
        <span className="animate-pulse">●</span>
        <span>Delegating image to fallback vision model...</span>
        {item.filename && <span className="text-amber-400/70">({item.filename})</span>}
      </div>
    )
  }

  return (
    <div className="flex items-start gap-2 px-3 py-2 bg-accent-success/10 border border-accent-success/30 rounded">
      <span className="text-accent-success">✓</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-accent-success text-sm">Image description done</span>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-accent-primary hover:text-accent-primary/80 transition-colors"
          >
            {expanded ? 'Hide' : 'Show'}
          </button>
        </div>
        {expanded && item.description && (
          <div className="mt-2 text-xs prose prose-invert prose-sm max-w-none">
            <Markdown content={item.description} />
          </div>
        )}
      </div>
    </div>
  )
})
