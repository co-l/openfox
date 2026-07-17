import { useRef, useEffect, useCallback, type Dispatch, type SetStateAction } from 'react'
import { useSessionStore, useIsRunning } from '../../stores/session'
import { authFetch } from '../../lib/api'
import type { Attachment } from '@shared/types.js'
import type { PromptHistoryItem } from '../../hooks/usePromptHistory'
import { AttachmentPreview } from '../shared/AttachmentPreview.js'
import { PromptHistoryList } from '../shared/PromptHistory.js'
import { RunningIndicator } from '../shared/RunningIndicator'
import { AutoScrollToggle } from '../shared/AutoScrollToggle'
import { SearchIcon, StopIcon } from '../shared/icons'
import { processFile } from '../../lib/file-processing.js'
import { mimeTypeToExtension, isSupportedMimeType } from '../../lib/attachment-utils.js'
import { CHAT_TEXTAREA_ID } from '../../lib/focusChatTextarea'
import { useScrolledSend } from '../../hooks/useScrolledSend'
import { MoreMenu } from './MoreMenu'
import { QueuedMessages } from './QueuedMessages'
import { AgentSelector } from './AgentSelector'
import { DangerLevelSelector } from './DangerLevelSelector'
import { ProviderSelector } from '../settings/ProviderSelector'
import {
  AtMentionAutocomplete,
  type AtMentionAutocompleteHandle,
  type FileSuggestion,
} from '../shared/AtMentionAutocomplete'

interface ChatInputProps {
  input: string
  setInput: (value: string) => void
  attachments: Attachment[]
  setAttachments: Dispatch<SetStateAction<Attachment[]>>
  dragOver: boolean
  setDragOver: (dragOver: boolean) => void
  errorMessage: string | null
  setErrorMessage: (msg: string | null) => void
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  sessionId: string | undefined
  sessionMode: string | undefined
  showHistory: boolean
  history: PromptHistoryItem[]
  selectedIndex: number
  openHistory: () => void
  closeHistory: () => void
  navigateUp: () => void
  navigateDown: () => void
  selectCurrent: () => string | null
  isAutoScrollActive: boolean
  setAutoScroll: (active: boolean) => void
  onOpenMessageSearch: () => void
  onOpenCommandsModal: () => void
  onOpenWorkflowsModal: () => void
  onSelectWorkflow: (workflowId: string) => void
  onSelectWorkflowWithSubGroup: (workflowId: string, subGroup: string) => void
  clearInput: () => void
}

export function ChatInput({
  input,
  setInput,
  attachments,
  setAttachments,
  dragOver,
  setDragOver,
  errorMessage,
  setErrorMessage,
  scrollContainerRef,
  sessionId,
  sessionMode,
  showHistory,
  history,
  selectedIndex,
  openHistory,
  closeHistory,
  navigateUp,
  navigateDown,
  selectCurrent,
  isAutoScrollActive,
  setAutoScroll,
  onOpenMessageSearch,
  onOpenCommandsModal,
  onOpenWorkflowsModal,
  onSelectWorkflow,
  onSelectWorkflowWithSubGroup,
  clearInput,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const prevLenRef = useRef(0)
  const cursorPosRef = useRef(0)
  const autocompleteRef = useRef<AtMentionAutocompleteHandle>(null)

  const isRunning = useIsRunning()
  const stopGeneration = useSessionStore((state) => state.stopGeneration)
  const cancelQueued = useSessionStore((state) => state.cancelQueued)
  const queuedMessages = useSessionStore((state) => state.queuedMessages)
  const restoredInput = useSessionStore((state) => state.restoredInput)
  const clearRestoredInput = useSessionStore((state) => state.clearRestoredInput)
  const workdir = useSessionStore((state) => state.currentSession?.workdir)
  const currentSession = useSessionStore((state) => state.currentSession)
  const warmupSentRef = useRef(false)

  const { sendMessage } = useScrolledSend(setAutoScroll)

  useEffect(() => {
    if (restoredInput !== null) {
      setInput(restoredInput)
      clearRestoredInput()
      textareaRef.current?.focus()
    }
  }, [restoredInput, setInput, clearRestoredInput])

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

  useEffect(() => {
    if (!sessionId) return
    const draftKey = `openfox:draft:${sessionId}`
    const savedDraft = localStorage.getItem(draftKey)
    if (savedDraft !== null) {
      setInput(savedDraft)
    }
  }, [sessionId, setInput])

  useEffect(() => {
    textareaRef.current?.focus()
    resizeTextarea()
  }, [sessionId, resizeTextarea])

  useEffect(() => {
    if (!sessionId) return
    const draftKey = `openfox:draft:${sessionId}`
    const timeoutId = setTimeout(() => {
      if (input) {
        localStorage.setItem(draftKey, input)
      } else {
        localStorage.removeItem(draftKey)
      }
    }, 500)
    return () => clearTimeout(timeoutId)
  }, [sessionId, input])

  useEffect(() => {
    resizeTextarea()
  }, [input, resizeTextarea])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    const handlePaste = async (e: ClipboardEvent) => {
      if (document.activeElement !== textarea) return
      const items = e.clipboardData?.items
      if (!items) return
      const added: Attachment[] = []
      for (const item of Array.from(items)) {
        let file = item.getAsFile()
        if (!file) continue

        if (isSupportedMimeType(file.type)) {
          e.preventDefault()
          if (!file.name) {
            const ext = mimeTypeToExtension(file.type)
            file = new File([file], `pasted-file.${ext}`, { type: file.type })
          }
          await processFile(file, (att) => added.push(att), setErrorMessage)
        }
      }
      if (added.length > 0) {
        setAttachments((prev) => [...prev, ...added])
      }
    }

    textarea.addEventListener('paste', handlePaste)
    return () => textarea.removeEventListener('paste', handlePaste)
  }, [setAttachments, setErrorMessage])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() && attachments.length === 0) return
    sendMessage(input, attachments.length > 0 ? attachments : undefined)
    clearInput()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (autocompleteRef.current?.handleKeyDown(e)) {
      return
    }
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

    if (e.key === 'ArrowUp' && input.trim() === '' && !showHistory) {
      e.preventDefault()
      openHistory()
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files || files.length === 0) return
      setErrorMessage(null)
      const added: Attachment[] = []
      for (const file of Array.from(files)) {
        await processFile(file, (att) => added.push(att), setErrorMessage)
      }
      if (added.length > 0) {
        setAttachments((prev) => [...prev, ...added])
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    [setAttachments, setErrorMessage],
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types?.includes('Files')) return
      e.preventDefault()
      e.stopPropagation()
      setDragOver(true)
    },
    [setDragOver],
  )

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOver(false)
    },
    [setDragOver],
  )

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOver(false)
      setErrorMessage(null)
      const files = e.dataTransfer.files
      if (!files || files.length === 0) return
      const added: Attachment[] = []
      for (const file of Array.from(files)) {
        await processFile(file, (att) => added.push(att), setErrorMessage)
      }
      if (added.length > 0) {
        setAttachments((prev) => [...prev, ...added])
      }
    },
    [setAttachments, setDragOver, setErrorMessage],
  )

  const handleRemoveAttachment = useCallback(
    (id: string) => {
      setAttachments(attachments.filter((att) => att.id !== id))
    },
    [attachments, setAttachments],
  )

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleSend = () => {
    if (!input.trim() && attachments.length === 0) return
    scrollContainerRef.current?.scrollTo({
      top: scrollContainerRef.current.scrollHeight,
      behavior: 'smooth',
    })
    sendMessage(input, attachments)
    clearInput()
  }

  const handleSelectFile = useCallback(
    (suggestion: FileSuggestion, startIndex: number) => {
      const isDirectory = suggestion.type === 'directory'
      // Files get a trailing space (closes the popup); directories get a trailing
      // slash so the query continues and the popup refetches the dir's contents.
      const suffix = isDirectory ? '/' : ' '
      const beforeCursor = input.slice(0, startIndex)
      const afterCursor = input.slice(cursorPosRef.current)
      const newText = `${beforeCursor}@${suggestion.path}${suffix}${afterCursor}`
      setInput(newText)
      const newCursorPos = startIndex + suggestion.path.length + 2
      cursorPosRef.current = newCursorPos
      if (textareaRef.current) {
        textareaRef.current.selectionStart = newCursorPos
        textareaRef.current.selectionEnd = newCursorPos
        textareaRef.current.focus()
      }
    },
    [input, setInput],
  )

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value
      setInput(value)
      if (showHistory) closeHistory()
      cursorPosRef.current = e.target.selectionStart

      // Warmup: on first keystroke in an empty session, prefill the LLM cache
      if (!warmupSentRef.current && sessionId && value && currentSession && currentSession.messages.length === 0) {
        warmupSentRef.current = true
        authFetch(`/api/sessions/${sessionId}/warmup`, { method: 'POST' }).catch(() => {})
      }
    },
    [setInput, showHistory, closeHistory, sessionId, currentSession],
  )

  const handleSelect = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
    cursorPosRef.current = (e.target as HTMLTextAreaElement).selectionStart
  }, [])

  const handleKeyUp = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    cursorPosRef.current = e.currentTarget.selectionStart
  }, [])

  return (
    <form onSubmit={handleSubmit} className="relative p-2 md:p-4 bg-secondary">
      {isRunning && (
        <div className="absolute -top-8 left-2 md:left-4 z-10">
          <RunningIndicator />
        </div>
      )}
      <div
        className={`absolute -top-8 right-2 md:right-4 z-10 flex items-center gap-2 border${!isAutoScrollActive ? ' rounded backdrop-blur-xl saturate-150 border-border' : ' border-transparent'}`}
      >
        <AutoScrollToggle
          isActive={isAutoScrollActive}
          onToggle={setAutoScroll}
          className="text-sm text-text-muted hover:text-text-primary flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-bg-tertiary transition-colors"
        />
        <button
          type="button"
          onClick={onOpenMessageSearch}
          className="text-sm text-text-muted hover:text-text-primary flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-bg-tertiary transition-colors"
          aria-label="Browse history"
        >
          <SearchIcon />
          Browse history
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,text/*,.pdf,.json,.xml,.yaml,.yml,.js,.sh,.xhtml"
        onChange={handleFileSelect}
        className="hidden"
        multiple
      />

      {errorMessage && (
        <div className="mb-2 p-2 bg-red-500/10 border border-red-500/50 rounded text-red-300 text-sm">
          {errorMessage}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <AttachmentPreview key={attachment.id} attachment={attachment} onRemove={handleRemoveAttachment} />
          ))}
        </div>
      )}

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
            if (direction === 'up') navigateUp()
            else navigateDown()
          }}
        />
      )}

      <QueuedMessages messages={queuedMessages} onCancel={cancelQueued} />

      <div
        className={`flex items-end gap-3 p-3 rounded transition-colors ${
          dragOver ? 'bg-accent-primary/10' : 'bg-primary'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="relative flex-1 min-w-0">
          <textarea
            id={CHAT_TEXTAREA_ID}
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onSelect={handleSelect}
            onKeyUp={handleKeyUp}
            placeholder="What would you like to build?"
            data-testid="chat-input-textarea"
            className="w-full bg-transparent text-sm placeholder:text-text-muted resize-none overflow-y-auto focus:outline-none"
            style={{ minHeight: '24px', maxHeight: '200px' }}
            spellCheck={false}
          />
          <AtMentionAutocomplete
            ref={autocompleteRef}
            text={input}
            cursorPos={cursorPosRef.current}
            workdir={workdir}
            onSelect={handleSelectFile}
          />
        </div>
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
              onClick={handleSend}
              disabled={!input.trim() && attachments.length === 0}
              data-testid="chat-send-button"
              className="px-4 py-1.5 rounded-l bg-accent-primary/20 text-sm text-accent-primary font-medium hover:bg-accent-primary/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Send
            </button>
            <MoreMenu
              onSendCommand={(content, agentMode, textareaContent, attachments) => {
                if (agentMode && sessionMode !== agentMode) {
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
              onSelectWorkflow={onSelectWorkflow}
              onSelectWorkflowWithSubGroup={onSelectWorkflowWithSubGroup}
              onOpenCommandsManager={onOpenCommandsModal}
              onOpenWorkflowsManager={onOpenWorkflowsModal}
              onAttach={handleAttachClick}
              textareaContent={input}
              attachments={attachments.length > 0 ? attachments : undefined}
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
  )
}
