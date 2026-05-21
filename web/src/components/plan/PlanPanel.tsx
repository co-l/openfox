import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react'
import { useSessionStore, useIsRunning, useQueuedMessages } from '../../stores/session'

import { type TurnStats } from '../../lib/types'

import type { Attachment } from '@shared/types.js'
import { SessionLayout } from '../layout/SessionLayout'
import { SessionHeader } from './SessionHeader'
import { TurnStatsModal } from './TurnStatsModal'
import { MessageList } from './MessageList'
import { AgentSelector } from './AgentSelector'
import { DangerLevelSelector } from './DangerLevelSelector'
import { AskUserDialog } from '../shared/AskUserDialog'
import { ConnectionStatusBar } from '../shared/ConnectionStatusBar'
import { AttachmentPreview } from '../shared/AttachmentPreview.js'
import { PromptHistoryList } from '../shared/PromptHistory.js'
import { RunningIndicator } from '../shared/RunningIndicator'
import { Markdown } from '../shared/Markdown.js'
import { CloseButton } from '../shared/CloseButton'
import { SearchIcon, ChevronDownIcon, StopIcon } from '../shared/icons'
import { useAgentsStore } from '../../stores/agents'
import { useCommandsStore } from '../../stores/commands'
import { useWorkflowsStore } from '../../stores/workflows'
import { processImageFile } from '../../lib/image-processing.js'
import { CHAT_TEXTAREA_ID, focusChatTextarea } from '../../lib/focusChatTextarea'
import { ProviderSelector } from '../settings/ProviderSelector'
import { MoreMenu } from './MoreMenu'
import { CommandsModal } from '../settings/CommandsModal'
import { WorkflowsModal } from '../settings/WorkflowsModal'
import { QuickActionModal } from '../QuickActionModal'
import { MessageSearchModal } from './MessageSearchModal'

import { groupMessages, type DisplayItem } from './groupMessages.js'
import { usePromptHistory } from '../../hooks/usePromptHistory.js'
import { useAutoScroll } from '@/hooks/useAutoScroll.ts'

interface PlanPanelProps {
  criteriaSidebarOpen?: boolean
  onCriteriaSidebarToggle?: () => void
}

export function PlanPanel({
  criteriaSidebarOpen: externalCriteriaSidebarOpen,
  onCriteriaSidebarToggle,
}: PlanPanelProps = {}) {
  const criteriaSidebarOpen = externalCriteriaSidebarOpen ?? true
  const [input, setInput] = useState('')

  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [showCommandsModal, setShowCommandsModal] = useState(false)
  const [showWorkflowsModal, setShowWorkflowsModal] = useState(false)
  const [showQuickAction, setShowQuickAction] = useState(false)
  const [showMessageSearch, setShowMessageSearch] = useState(false)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const [turnStatsModal, setTurnStatsModal] = useState<TurnStats | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const session = useSessionStore((state) => state.currentSession)
  const rawMessages = useSessionStore((state) => state.messages)
  const streamingMessage = useSessionStore((state) => state.streamingMessage)
  const sessions = useSessionStore((state) => state.sessions)
  const pendingQuestion = useSessionStore((state) => state.pendingQuestion)
  const isRunning = useIsRunning()
  const sendMessage = useSessionStore((state) => state.sendMessage)
  const acceptAndBuild = useSessionStore((state) => state.acceptAndBuild)
  const stopGeneration = useSessionStore((state) => state.stopGeneration)
  const launchRunner = useSessionStore((state) => state.launchRunner)
  const cancelQueued = useSessionStore((state) => state.cancelQueued)
  const queuedMessages = useQueuedMessages()

  const agentDefaults = useAgentsStore((state) => state.defaults)
  const agentUserItems = useAgentsStore((state) => state.userItems)
  const topLevelAgents = [...agentDefaults, ...agentUserItems].filter((a) => !a.subagent)

  // Prompt history navigation
  const { history, selectedIndex, showHistory, openHistory, closeHistory, navigateUp, navigateDown, selectCurrent } =
    usePromptHistory(rawMessages, sessions, session?.id)

  // Listen for open-turn-stats event from stats bar
  const handleSelectSearchMessage = useCallback((messageId: string) => {
    setHighlightedMessageId(messageId)
    setAutoScroll(false)
    const element = document.querySelector(`[data-message-id="${messageId}"]`)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    setTimeout(() => setHighlightedMessageId(null), 3000)
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<{ stats: TurnStats }>
      setTurnStatsModal(customEvent.detail.stats)
    }
    window.addEventListener('open-turn-stats', handler)
    return () => window.removeEventListener('open-turn-stats', handler)
  }, [])

  useEffect(() => {
    useWorkflowsStore.getState().fetchWorkflows()
  }, [])

  // Merge streamingMessage into the messages array for rendering.
  // When streaming, only the streamingMessage changes — rawMessages stays stable,
  // so groupMessages() and promptContext skip recomputation for non-streaming items.
  const messages = useMemo(() => {
    if (!streamingMessage) return rawMessages
    return rawMessages.map((m) => (m.id === streamingMessage.id ? streamingMessage : m))
  }, [rawMessages, streamingMessage])

  // Ref to store previous displayItems for identity preservation
  const previousDisplayItemsRef = useRef<DisplayItem[]>([])

  // Group messages for display, collapsing sub-agent messages into containers
  const displayItems = useMemo((): DisplayItem[] => {
    const items = groupMessages(messages, previousDisplayItemsRef.current)
    previousDisplayItemsRef.current = items
    return items
  }, [messages])

  // TEMP: Auto-start test messages on page load
  /*  useEffect(() => {
    testInterval.current = setInterval(() => {
      setTestMessageCount(prev => prev + 1)
    }, 2000)
    return () => {
      if (testInterval.current) clearInterval(testInterval.current)
    }
  }, [])*/

  const { force_scroll_to_bottom, isAutoScrollActive, setAutoScroll } = useAutoScroll(scrollContainerRef, session)

  // Track topmost visible display item for conversation index highlighting
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined)
  const displayItemsRef = useRef(displayItems)
  displayItemsRef.current = displayItems

  // Scroll the main chat to a specific display item index
  const scrollToIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= displayItems.length) return

      const element = document.querySelector(`[data-item-index="${index}"]`)
      if (!element) return

      const container = scrollContainerRef.current
      if (!container) return

      setAutoScroll(false)

      const elementTop = element.getBoundingClientRect().top + container.scrollTop
      const targetPosition = elementTop - 80

      // Record scroll position before scrolling
      const startScrollTop = container.scrollTop

      // Smooth scroll animation
      container.scrollTo({
        top: targetPosition,
        behavior: 'smooth',
      })

      // Check after 100ms if scroll actually moved
      setTimeout(() => {
        const currentScrollTop = container.scrollTop
        // If scroll didn't move (< 1px), item was unreachable - set highlight manually
        if (Math.abs(currentScrollTop - startScrollTop) < 1) {
          setActiveIndex(index)
        }
        // If scroll moved, let scroll handler update activeIndex naturally
      }, 100)
    },
    [displayItems.length, scrollContainerRef, setAutoScroll],
  )

  // Debounce activeIndex updates to prevent rapid-fire updates during scroll
  const lastActiveIndexUpdateRef = useRef<number>(0)
  const activeIndexDebounceMs = 50 // Minimum time between activeIndex updates

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || displayItems.length === 0) return

    const handleScroll = () => {
      const now = Date.now()
      // Skip if we just updated activeIndex
      if (now - lastActiveIndexUpdateRef.current < activeIndexDebounceMs) {
        return
      }

      const containerTop = container.scrollTop
      const viewportTop = containerTop
      const viewportBottom = containerTop + container.clientHeight

      let closestIndex = -1
      let closestDistance = Infinity
      let lastRenderedIndex = -1

      displayItemsRef.current.forEach((_, index) => {
        const item = displayItemsRef.current[index]
        if (!item) return

        if (item.type === 'message' && item.message.role === 'assistant') {
          if (!item.message.content?.trim() && !item.message.thinkingContent?.trim()) {
            return
          }
        }

        lastRenderedIndex = index

        const element = document.querySelector(`[data-item-index="${index}"]`)
        if (element) {
          const rect = element.getBoundingClientRect()
          const elementTop = rect.top + container.scrollTop - container.getBoundingClientRect().top
          const elementHeight = element.clientHeight
          const elementCenter = elementTop + elementHeight / 2

          // Only consider elements that have their center at or slightly below viewport top (with 5px offset)
          // Pick the first one that's visible (closest to viewport top from below)
          if (elementCenter >= viewportTop - 5 && elementTop < viewportBottom) {
            const distance = elementCenter - viewportTop
            if (distance < closestDistance) {
              closestDistance = distance
              closestIndex = index
            }
          }
        }
      })

      // Fallback: if no element found at or below viewport top, use last rendered
      if (closestIndex === -1 && lastRenderedIndex !== -1) {
        closestIndex = lastRenderedIndex
      }

      const maxScroll = container.scrollHeight - container.clientHeight
      const isAtBottom = container.scrollTop >= maxScroll - 10

      if (isAtBottom && lastRenderedIndex !== -1) {
        setActiveIndex(lastRenderedIndex)
        lastActiveIndexUpdateRef.current = now
      } else if (closestIndex !== -1) {
        setActiveIndex(closestIndex)
        lastActiveIndexUpdateRef.current = now
      }
    }

    container.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      container.removeEventListener('scroll', handleScroll)
    }
  }, [displayItems.length])

  const prevLenRef = useRef(0)

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    const isGrowing = input.length >= prevLenRef.current
    prevLenRef.current = input.length

    if (!isGrowing) {
      textarea.style.height = 'auto'
    }
    textarea.style.height = `${Math.min(200, textarea.scrollHeight)}px`
  }, [input])

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
      const popupOpen =
        showQuickAction || showCommandsModal || showWorkflowsModal || showMessageSearch || turnStatsModal
      if (e.key === 'Escape' && isRunning && !popupOpen) {
        stopGeneration()
      }
      if (e.key === 'ScrollLock') {
        setAutoScroll(!isAutoScrollActive)
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [
    isRunning,
    stopGeneration,
    isAutoScrollActive,
    showQuickAction,
    showCommandsModal,
    showWorkflowsModal,
    showMessageSearch,
    turnStatsModal,
  ])

  // Double Shift opens quick action modal
  const lastShiftRef = useRef<number>(0)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const now = Date.now()
        if (now - lastShiftRef.current < 300) {
          e.preventDefault()
          setShowQuickAction(true)
          lastShiftRef.current = 0
        } else {
          lastShiftRef.current = now
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

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

          await processImageFile(file, (att) => setAttachments((prev) => [...prev, att]), setErrorMessage, {
            filename: 'pasted-image',
          })
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
    // Ctrl+1/2/3/4 to switch agents (layout-independent via e.code)
    if ((e.ctrlKey || e.metaKey) && e.code.startsWith('Digit')) {
      const digit = parseInt(e.code.slice(-1), 10)
      const agentIndex = digit - 1
      const agent = topLevelAgents[agentIndex]
      if (agent) {
        e.preventDefault()
        useSessionStore.getState().switchMode(agent.id)
      }
      return
    }

    // Handle prompt history navigation when history is visible
    if (showHistory) {
      switch (e.key) {
        case 'Enter': {
          e.preventDefault()
          const selectedContent = selectCurrent()
          if (selectedContent) {
            setInput(selectedContent)
            closeHistory()
          }
          return
        }
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
      await processImageFile(file, (att) => setAttachments((prev) => [...prev, att]), setErrorMessage)
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
      await processImageFile(file, (att) => setAttachments((prev) => [...prev, att]), setErrorMessage)
    }
  }, [])

  // Handle remove attachment
  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((att) => att.id !== id))
  }, [])

  // Handle attach button click
  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const isPlanning = session?.mode === 'planner'
  const isBuilding = session?.mode === 'builder'

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
    <>
      <SessionLayout
        criteriaSidebarOpen={criteriaSidebarOpen}
        onCriteriaSidebarToggle={onCriteriaSidebarToggle}
        messages={messages}
        displayItems={displayItems}
        activeIndex={activeIndex}
        onNavigate={scrollToIndex}
      >
        {pendingQuestion && <AskUserDialog question={pendingQuestion} />}
        <SessionHeader />

        {/* Turn Stats Modal */}
        {turnStatsModal && <TurnStatsModal stats={turnStatsModal} onClose={() => setTurnStatsModal(null)} />}
        <ConnectionStatusBar />

        <MessageList
          displayItems={displayItems}
          scrollContainerRef={scrollContainerRef}
          highlightedMessageId={highlightedMessageId}
        />

        <form onSubmit={handleSubmit} className="relative p-2 md:p-4 bg-secondary">
          {isRunning && (
            <div className="absolute -top-8 left-2 md:left-4 z-10">
              <RunningIndicator />
            </div>
          )}
          <button
            type="button"
            className="absolute -top-8 right-12 md:right-16 text-sm text-text-muted hover:text-text-primary z-10 flex items-center gap-1.5"
            onClick={() => setAutoScroll(!isAutoScrollActive)}
          >
            {isAutoScrollActive ? (
              <span className="w-1.5 h-1.5 rounded-full bg-accent-success" />
            ) : (
              <ChevronDownIcon className="w-3 h-3 text-text-muted" />
            )}
            {isAutoScrollActive ? 'live' : 'scroll to bottom'}
          </button>
          <button
            type="button"
            onClick={() => setShowMessageSearch(true)}
            className="absolute -top-8 right-2 md:right-4 text-sm text-text-muted hover:text-text-primary z-10 flex items-center p-0.5 rounded hover:bg-bg-tertiary transition-colors"
            aria-label="Search messages"
          >
            <SearchIcon />
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
                <AttachmentPreview key={attachment.id} attachment={attachment} onRemove={handleRemoveAttachment} />
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
          {queuedMessages?.length > 0 && (
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
                  <CloseButton onClick={() => cancelQueued(qm.queueId)} size="sm" />
                </div>
              ))}
            </div>
          )}

          <div
            className={`flex items-end gap-3 p-3 rounded transition-colors ${
              dragOver ? 'bg-accent-primary/10' : 'bg-primary'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <textarea
              id={CHAT_TEXTAREA_ID}
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
              placeholder="What would you like to build?"
              data-testid="chat-input-textarea"
              className="flex-1 bg-transparent text-sm placeholder:text-text-muted resize-none overflow-y-auto focus:outline-none"
              style={{ minHeight: '24px', maxHeight: '200px' }}
              spellCheck={false}
            />
            <div className="flex items-center self-center gap-1.5">
              {isRunning && (
                <button
                  type="button"
                  onClick={() => stopGeneration()}
                  data-testid="chat-stop-button"
                  className="flex items-center gap-1 px-4 py-1.5 rounded bg-accent-error/20 text-sm text-accent-error font-medium hover:bg-accent-error/30 transition-colors whitespace-nowrap"
                >
                  <StopIcon />
                  Abort
                </button>
              )}
              <div className="flex items-center">
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
                  disabled={!input.trim() && attachments.length === 0}
                  data-testid="chat-send-button"
                  className="px-4 py-1.5 rounded-l bg-accent-primary/20 text-sm text-accent-primary font-medium hover:bg-accent-primary/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Send
                </button>
                <MoreMenu
                  onSendCommand={(content, agentMode, textareaContent, attachments) => {
                    if (agentMode && session?.mode !== agentMode) {
                      useSessionStore.getState().switchMode(agentMode)
                    }
                    const combinedContent =
                      textareaContent && textareaContent.trim() ? `${textareaContent.trim()}\n\n${content}` : content
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
                  onSelectWorkflow={handleSelectWorkflow}
                  onOpenCommandsManager={() => setShowCommandsModal(true)}
                  onOpenWorkflowsManager={() => setShowWorkflowsModal(true)}
                  onAttach={handleAttachClick}
                  textareaContent={input}
                  attachments={attachments.length > 0 ? attachments : undefined}
                  criteria={session?.criteria ?? []}
                />
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
        <QuickActionModal
          isOpen={showQuickAction}
          onClose={() => setShowQuickAction(false)}
          onSearchMessages={() => setShowMessageSearch(true)}
          isAutoScrollActive={isAutoScrollActive}
          onToggleAutoScroll={setAutoScroll}
          textareaContent={input}
          onCloseComplete={focusChatTextarea}
          onCloseCompleteAction={() => window.dispatchEvent(new CustomEvent('open-session-dropdown'))}
          onSelectCommand={async (commandId, textareaContent) => {
            const full = await useCommandsStore.getState().fetchCommand(commandId)
            if (full) {
              const combinedContent = textareaContent?.trim()
                ? `${textareaContent.trim()}\n\n${full.prompt}`
                : full.prompt
              if (full.metadata.agentMode) {
                useSessionStore.getState().switchMode(full.metadata.agentMode)
              }
              sendMessage(combinedContent, attachments?.length ? attachments : undefined, {
                messageKind: 'command',
                isSystemGenerated: true,
              })
              clearInput()
            }
          }}
          onSelectWorkflow={(workflowId) => {
            const content = input.trim() || undefined
            const atts = attachments.length > 0 ? attachments : undefined
            if (session?.mode === 'planner') {
              useSessionStore.getState().acceptAndBuild(workflowId, content, atts)
            } else {
              useSessionStore.getState().launchRunner(content, atts, workflowId)
            }
            clearInput()
          }}
        />
      </SessionLayout>

      {showMessageSearch && (
        <MessageSearchModal
          isOpen={showMessageSearch}
          onClose={() => setShowMessageSearch(false)}
          messages={rawMessages}
          onSelectMessage={handleSelectSearchMessage}
        />
      )}
    </>
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
