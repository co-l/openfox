import { useState, useRef, useEffect, useCallback, type Dispatch, type SetStateAction } from 'react'
import { useSessionStore, useIsRunning, useQueuedMessages } from '../../stores/session'
import { useScopedPaneState } from '../../stores/session/session-scope'
import { useWorkflowsStore, selectAllWorkflows } from '../../stores/workflows'
import { useCommandsStore } from '../../stores/commands'
import { authFetch } from '../../lib/api'
import { parseSlashCommand, extractTemplateParams } from '../../lib/parse-slash-command'
import { insertSuggestionAtCursor, focusTextareaAt, resolveSlashParamIds } from '../../lib/composer-utils'
import { resolveWorkflowForLaunch } from '../../lib/workflow-scope'
import { dedupById } from '../../lib/modal-utils'
import type { WorkflowLaunchScope } from '@shared/types.js'
import type { Attachment } from '@shared/types.js'
import type { PromptHistoryItem } from '../../hooks/usePromptHistory'
import { AttachmentPreview } from '../shared/AttachmentPreview.js'
import { PromptHistoryList } from '../shared/PromptHistory.js'
import { RunningIndicator } from '../shared/RunningIndicator'
import { AutoScrollToggle } from '../shared/AutoScrollToggle'
import { SearchIcon, StopIcon } from '../shared/icons'
import { WorkflowBar } from './WorkflowBar'
import { processFile } from '../../lib/file-processing.js'
import { mimeTypeToExtension, isSupportedMimeType } from '../../lib/attachment-utils.js'
import { CHAT_TEXTAREA_ID } from '../../lib/focusChatTextarea'
import { shouldAutofocus } from '../../lib/device'
import { useScrolledSend } from '../../hooks/useScrolledSend'
import { MoreMenu } from './MoreMenu'
import { QueuedMessages } from './QueuedMessages'
import { AgentSelector } from './AgentSelector'
import { DangerLevelSelector } from './DangerLevelSelector'
import { ProviderSelector } from '../settings/ProviderSelector'
import { McpSelector } from './McpSelector'
import { SETTINGS_KEYS } from '../../stores/settings'
import { useSettingsStore } from '../../stores/settings'
import {
  AtMentionAutocomplete,
  type AtMentionAutocompleteHandle,
  type FileSuggestion,
} from '../shared/AtMentionAutocomplete'
import { SlashAutocomplete, type SlashAutocompleteHandle, type SlashSuggestion } from '../shared/SlashAutocomplete'

const COMPOSER_MIN_HEIGHT = 24
const COMPOSER_MAX_HEIGHT = 200

interface ChatInputProps {
  input: string
  setInput: (value: string) => void
  attachments: Attachment[]
  setAttachments: Dispatch<SetStateAction<Attachment[]>>
  dragOver: boolean
  setDragOver: (dragOver: boolean) => void
  errorMessage: string | null
  setErrorMessage: (msg: string | null) => void
  scrollToBottom?: () => void
  sessionId: string | null | undefined
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
  onSelectWorkflow: (workflowId: string, scope?: WorkflowLaunchScope) => void
  onSelectWorkflowWithSubGroup: (workflowId: string, subGroup: string, scope?: WorkflowLaunchScope) => void
  onSendCommand: (content: string, agentMode?: string, textareaContent?: string, attachments?: Attachment[]) => void
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
  scrollToBottom,
  sessionId,
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
  onSendCommand,
  clearInput,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const prevLenRef = useRef(0)
  const cursorPosRef = useRef(0)
  const autocompleteRef = useRef<AtMentionAutocompleteHandle>(null)
  const slashAutocompleteRef = useRef<SlashAutocompleteHandle>(null)

  const isRunning = useIsRunning(sessionId)
  const stopGeneration = useSessionStore((state) => state.stopGeneration)
  const cancelQueued = useSessionStore((state) => state.cancelQueued)
  const queuedMessages = useQueuedMessages(sessionId)
  const restoredInput = useScopedPaneState(
    sessionId,
    (pane) => pane.restoredInput ?? null,
    (state) => state.restoredInput,
    null,
  )
  const clearRestoredInput = useSessionStore((state) => state.clearRestoredInput)
  const workdir = useScopedPaneState(
    sessionId,
    (pane) => pane.session?.workdir ?? undefined,
    (state) => state.currentSession?.workdir,
    undefined,
  )
  const currentSession = useScopedPaneState(
    sessionId,
    (pane) => pane.session ?? null,
    (state) => state.currentSession,
    null,
  )
  const warmupSentRef = useRef(false)
  const loadedWorkdirRef = useRef<string | undefined>(undefined)
  const sendingRef = useRef(false)
  const [activeSlashParams, setActiveSlashParams] = useState<string[]>([])
  // Records the scope chosen via the slash autocomplete so the launch resolves
  // the exact definition the user picked (only honored when the id still matches).
  const selectedSlashScopeRef = useRef<{ id: string; scope: WorkflowLaunchScope } | null>(null)

  const { sendMessage, launchWorkflow } = useScrolledSend(setAutoScroll, sessionId)

  // Eagerly load workflows and commands so slash autocomplete always has data.
  // Scoped to the session's project workdir; reloads when the active project changes.
  useEffect(() => {
    if (loadedWorkdirRef.current === workdir) return
    loadedWorkdirRef.current = workdir
    useWorkflowsStore.getState().fetchWorkflows(workdir)
    useCommandsStore.getState().fetchCommands(workdir)
  }, [workdir])

  // Clear inline param hints when input is emptied (after send, escape, etc.)
  useEffect(() => {
    if (!input) {
      setActiveSlashParams([])
    }
  }, [input])

  useEffect(() => {
    if (restoredInput !== null) {
      setInput(restoredInput)
      clearRestoredInput(sessionId)
      if (shouldAutofocus()) textareaRef.current?.focus()
    }
  }, [restoredInput, setInput, clearRestoredInput])

  const resizeTextarea = useCallback(
    (opts: { force?: boolean } = {}) => {
      const textarea = textareaRef.current
      if (!textarea) return
      // An empty textarea reports its wrapped placeholder in scrollHeight, which
      // balloons the box on narrow layouts; pin it to the minimum height instead.
      if (!input) {
        textarea.style.height = `${COMPOSER_MIN_HEIGHT}px`
        return
      }
      // While typing (content growing), avoid collapsing to 'auto' on every
      // keystroke: that forces a full re-layout of the collapsed box and makes the
      // pane jump. Reset to 'auto' only when the content shrinks, or when forced
      // (e.g. the column width changed and wrapping needs re-measuring).
      const isGrowing = input.length >= prevLenRef.current
      prevLenRef.current = input.length
      if (opts.force || !isGrowing) {
        textarea.style.height = 'auto'
      }
      textarea.style.height = `${Math.min(COMPOSER_MAX_HEIGHT, textarea.scrollHeight)}px`
    },
    [input],
  )

  // Latest resizeTextarea for the (stable) width observer, so the observer isn't
  // torn down and rebuilt on every keystroke.
  const resizeTextareaRef = useRef(resizeTextarea)
  useEffect(() => {
    resizeTextareaRef.current = resizeTextarea
  }, [resizeTextarea])

  useEffect(() => {
    if (!sessionId) return
    const draftKey = `openfox:draft:${sessionId}`
    const savedDraft = localStorage.getItem(draftKey)
    if (savedDraft !== null) {
      setInput(savedDraft)
    }
  }, [sessionId, setInput])

  useEffect(() => {
    if (shouldAutofocus()) textareaRef.current?.focus()
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

  // Re-evaluate the height when the composer's column changes width (narrower or
  // wider panes change how content wraps). Forces a fresh 'auto' measurement so a
  // previously measured height can't keep the box stale. Guarded to only fire on
  // width changes so adjusting the textarea's own height doesn't loop.
  useEffect(() => {
    const container = textareaRef.current?.parentElement
    if (!container || typeof ResizeObserver === 'undefined') return
    let lastWidth = container.clientWidth
    const observer = new ResizeObserver(() => {
      const width = container.clientWidth
      if (width === lastWidth) return
      lastWidth = width
      resizeTextareaRef.current({ force: true })
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

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
    // Delegate to handleSend so slash commands are processed the same way
    // whether triggered by Enter or the Send button
    handleSend()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (slashAutocompleteRef.current?.handleKeyDown(e)) {
      return
    }
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
          if (isRunning && sessionId) stopGeneration(sessionId)
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

  async function processFiles(
    files: FileList,
    setAttachments: Dispatch<SetStateAction<Attachment[]>>,
    setErrorMessage: (msg: string | null) => void,
  ): Promise<void> {
    const added: Attachment[] = []
    for (const file of Array.from(files)) {
      await processFile(file, (att) => added.push(att), setErrorMessage)
    }
    if (added.length > 0) {
      setAttachments((prev) => [...prev, ...added])
    }
  }

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files || files.length === 0) return
      setErrorMessage(null)
      await processFiles(files, setAttachments, setErrorMessage)
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
      await processFiles(files, setAttachments, setErrorMessage)
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
    if (sendingRef.current) return
    if (!input.trim() && attachments.length === 0) return
    sendingRef.current = true
    scrollToBottom?.()

    // Detect slash commands: /workflow-id arg1 arg2 or /command-name arg1 arg2
    const trimmed = input.trim()
    if (trimmed.startsWith('/')) {
      const workflows = selectAllWorkflows(useWorkflowsStore.getState())
      const allCommands = useCommandsStore.getState()
      const commands = dedupById(dedupById(allCommands.defaults, allCommands.userItems), allCommands.projectItems)
      const slashResult = parseSlashCommand(input, workflows, commands)
      if (slashResult?.workflowId) {
        const pending = selectedSlashScopeRef.current
        const scope: WorkflowLaunchScope = pending && pending.id === slashResult.workflowId ? pending.scope : 'auto'
        selectedSlashScopeRef.current = null
        // Resolve the exact definition that will be launched so param validation
        // (and inline hints) match server execution — not just the precedence winner.
        const wf = resolveWorkflowForLaunch(workflows, slashResult.workflowId, scope)
        const missingRequired = (wf?.parameters ?? []).filter((p) => p.required && !(p.id in slashResult.params))
        if (missingRequired.length > 0) {
          const names = missingRequired.map((p) => p.label || p.id).join(', ')
          setErrorMessage(`Missing required parameter${missingRequired.length > 1 ? 's' : ''}: ${names}`)
          sendingRef.current = false
          return
        }
        launchWorkflow(undefined, undefined, slashResult.workflowId, undefined, slashResult.params, scope)
        clearInput()
        sendingRef.current = false
        return
      }
      if (slashResult?.commandId) {
        // Fetch command, resolve params, send as message
        allCommands.fetchCommand(slashResult.commandId, workdir).then((full) => {
          if (full) {
            // Map positional args to named params by order of appearance in the prompt
            const paramNames = extractTemplateParams(full.prompt)
            const namedParams: Record<string, string> = {}
            for (const [posKey, value] of Object.entries(slashResult.params)) {
              const idx = parseInt(posKey, 10)
              const name = paramNames[idx]
              if (name) namedParams[name] = value
            }
            let prompt = full.prompt
            for (const [key, value] of Object.entries(namedParams)) {
              prompt = prompt.replaceAll(`{{${key}}}`, value)
            }
            onSendCommand(prompt, full.metadata.agentMode)
            clearInput()
          }
          sendingRef.current = false
          // If fetch fails (null), leave input intact so user can retry
        })
        return
      }
    }

    sendMessage(input, attachments)
    clearInput()
    sendingRef.current = false
  }

  const handleSelectFile = useCallback(
    (suggestion: FileSuggestion, startIndex: number) => {
      const isDirectory = suggestion.type === 'directory'
      // Files get a trailing space (closes the popup); directories get a trailing
      // slash so the query continues and the popup refetches the dir's contents.
      const suffix = isDirectory ? '/' : ' '
      const { newText, newCursorPos } = insertSuggestionAtCursor(
        input,
        cursorPosRef.current,
        startIndex,
        `@${suggestion.path}${suffix}`,
      )
      setInput(newText)
      cursorPosRef.current = newCursorPos
      focusTextareaAt(textareaRef.current, newCursorPos)
    },
    [input, setInput],
  )

  const handleSelectSlash = useCallback(
    (suggestion: SlashSuggestion, startIndex: number) => {
      const { newText, newCursorPos } = insertSuggestionAtCursor(
        input,
        cursorPosRef.current,
        startIndex,
        `/${suggestion.id} `,
      )
      setInput(newText)
      cursorPosRef.current = newCursorPos
      focusTextareaAt(textareaRef.current, newCursorPos)
      // Set inline param hints (same resolution as the task editor)
      if (suggestion.type === 'workflow') {
        selectedSlashScopeRef.current = { id: suggestion.id, scope: suggestion.scope }
      }
      setActiveSlashParams(resolveSlashParamIds(suggestion))
    },
    [input, setInput],
  )

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value
      setInput(value)
      if (showHistory) closeHistory()
      cursorPosRef.current = e.target.selectionStart

      // Drop a stale slash-scope selection when the typed slash target no longer
      // matches it (edited, cleared, or rewritten to a different id).
      const pending = selectedSlashScopeRef.current
      if (pending) {
        const match = value.match(/^\/(\S+)/)
        const currentId = match ? match[1] : undefined
        if (!currentId || currentId !== pending.id) {
          selectedSlashScopeRef.current = null
        }
      }

      // Clear inline param hints when slash pattern is broken or input is empty
      if (activeSlashParams.length > 0 && (!value.startsWith('/') || !value.includes(' '))) {
        setActiveSlashParams([])
      }

      // Warmup: on first keystroke in an empty session, prefill the LLM cache
      if (!warmupSentRef.current && sessionId && value && currentSession && (currentSession.messageCount ?? 0) === 0) {
        warmupSentRef.current = true
        authFetch(`/api/sessions/${sessionId}/warmup`, { method: 'POST' }).catch(() => {})
      }
    },
    [setInput, showHistory, closeHistory, sessionId, currentSession, activeSlashParams],
  )

  const handleSelect = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
    cursorPosRef.current = (e.target as HTMLTextAreaElement).selectionStart
  }, [])

  const handleKeyUp = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    cursorPosRef.current = e.currentTarget.selectionStart
  }, [])

  return (
    <div className="relative">
      {isRunning && (
        <div className="absolute -top-8 left-2 @md:left-4 z-10">
          <RunningIndicator />
        </div>
      )}
      <div
        className={`absolute -top-8 right-2 @md:right-4 z-10 flex items-center gap-2 border${!isAutoScrollActive ? ' rounded backdrop-blur-xl saturate-150 border-border' : ' border-transparent'}`}
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

      <WorkflowBar />

      <form onSubmit={handleSubmit} className="p-2 @md:p-4 bg-secondary rounded-lg">
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

        <QueuedMessages
          messages={queuedMessages}
          onCancel={(queueId) => sessionId && cancelQueued(sessionId, queueId)}
        />

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
              style={{ minHeight: `${COMPOSER_MIN_HEIGHT}px`, maxHeight: `${COMPOSER_MAX_HEIGHT}px` }}
              spellCheck={false}
            />
            <AtMentionAutocomplete
              ref={autocompleteRef}
              text={input}
              cursorPos={cursorPosRef.current}
              workdir={workdir}
              onSelect={handleSelectFile}
            />
            <SlashAutocomplete
              ref={slashAutocompleteRef}
              text={input}
              cursorPos={cursorPosRef.current}
              workflows={(() => selectAllWorkflows(useWorkflowsStore.getState()))()}
              commands={(() => {
                const s = useCommandsStore.getState()
                return dedupById(dedupById(s.defaults, s.userItems), s.projectItems)
              })()}
              onSelect={handleSelectSlash}
            />
            {activeSlashParams.length > 0 &&
              (() => {
                // Count space-separated args after the last /command
                const match = input.match(/\/(\w+)\s+(.*)$/)
                const args = match ? match[2]!.trim().split(/\s+/) : []
                const filledCount = args.filter(Boolean).length
                const nextParam = activeSlashParams[filledCount]
                if (!nextParam) return null
                return (
                  <span
                    className="absolute left-3 top-[26px] text-sm text-text-muted/40 pointer-events-none select-none"
                    aria-hidden
                  >
                    {nextParam}=?
                  </span>
                )
              })()}
          </div>
          <div className="flex items-center self-center gap-1.5">
            {isRunning && (
              <button
                type="button"
                onClick={() => sessionId && stopGeneration(sessionId)}
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
                onSendCommand={onSendCommand}
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
          <div className="flex items-center gap-2">
            {useSettingsStore((s) => s.settings)[SETTINGS_KEYS.FEATURES_PER_SESSION_MCP] === 'true' && <McpSelector />}
            <ProviderSelector />
          </div>
        </div>
      </form>
    </div>
  )
}
