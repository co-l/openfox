import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { useSessionStore, useIsRunning } from '../../stores/session'
// @ts-ignore
import type { Message, ToolCall, Attachment } from '@shared/types.js'
import { SessionLayout } from '../layout/SessionLayout'
import { SessionHeader } from './SessionHeader'
import { ChatMessage } from './ChatMessage'
import { AssistantMessage } from './AssistantMessage'
import { SubAgentContainer } from './SubAgentContainer'
import { ModeSwitch } from './ModeSwitch'
import { Button } from '../shared/Button'
import { PathConfirmationDialog } from '../shared/PathConfirmationDialog'
import { RunningIndicator } from '../shared/RunningIndicator'
import { CriteriaGroupDisplay } from '../shared/CriteriaGroupDisplay'
import { AttachmentPreview } from '../shared/AttachmentPreview.js'
import { PromptHistoryList } from '../shared/PromptHistory.js'
import { compressImage, isValidImageType, validateImageSize } from '../../lib/image-compression.js'
import { buildPromptContextByUserMessageId } from './prompt-context-linking.js'
import { ProviderSelector } from '../settings/ProviderSelector'
import { generateUUID } from '../../lib/uuid.js'
import { groupMessages, type DisplayItem } from './groupMessages.js'
import { usePromptHistory } from '../../hooks/usePromptHistory.js'

export function PlanPanel() {
  const [criteriaSidebarOpen, setCriteriaSidebarOpen] = useState(true)
  const [input, setInput] = useState('')
  const [, setAtBottom] = useState(true)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  const session = useSessionStore(state => state.currentSession)
  const rawMessages = useSessionStore(state => state.messages)
  const streamingMessage = useSessionStore(state => state.streamingMessage)
  const sessions = useSessionStore(state => state.sessions)
  const error = useSessionStore(state => state.error)
  const pendingPathConfirmation = useSessionStore(state => state.pendingPathConfirmation)
  
  const isRunning = useIsRunning()
  
  const sendMessage = useSessionStore(state => state.sendMessage)
  const clearError = useSessionStore(state => state.clearError)
  const acceptAndBuild = useSessionStore(state => state.acceptAndBuild)
  const stopGeneration = useSessionStore(state => state.stopGeneration)
  const launchRunner = useSessionStore(state => state.launchRunner)
  
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
  
  // Virtuoso auto-scroll: follow new output when user is at the bottom
  const followOutput = useCallback((isAtBottom: boolean) => {
    return isAtBottom ? 'smooth' : false
  }, [])

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
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isRunning, stopGeneration])

  // Paste event listener for textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    
    const handlePaste = (e: ClipboardEvent) => {
      // Only handle if the textarea is focused
      if (document.activeElement !== textarea) return
      
      const items = e.clipboardData?.items
      if (!items) return
      
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const file = item.getAsFile()
          if (!file) continue
          
          // Process the pasted image (inline function to access state)
          ;(async () => {
            try {
              if (!isValidImageType(file)) {
                setErrorMessage('Only PNG, JPG, and GIF images are supported.')
                return
              }
              
              const sizeValidation = validateImageSize(file, 50 * 1024 * 1024)
              if (!sizeValidation.valid) {
                setErrorMessage(sizeValidation.error ?? 'Image file is too large')
                return
              }
              
              const compressed = await compressImage(file, {
                maxWidth: 1920,
                maxHeight: 1920,
                quality: 0.85,
                maxSizeBytes: 1048576,
              })
              
              const attachment: Attachment = {
                id: generateUUID(),
                filename: 'pasted-image',
                mimeType: compressed.mimeType as 'image/png' | 'image/jpeg' | 'image/gif',
                size: compressed.size,
                data: compressed.dataUrl,
              }
              
              setAttachments(prev => [...prev, attachment])
            } catch (err) {
              const errorMsg = err instanceof Error ? (err.message ?? 'Failed to process image') : 'Failed to process image'
              setErrorMessage(errorMsg)
            }
          })()
        }
      }
    }
    
    textarea.addEventListener('paste', handlePaste)
    return () => textarea.removeEventListener('paste', handlePaste)
  }, [])
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if ((!input.trim() && attachments.length === 0) || isRunning) return

    // Scroll to bottom when sending a message
    virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'smooth' })

    sendMessage(input, attachments)
    setInput('')
    setAttachments([])
    
    // Clear draft from localStorage after sending
    if (session?.id) {
      localStorage.removeItem(`openfox:draft:${session.id}`)
    }
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
      try {
        // Validate file type
        if (!isValidImageType(file)) {
          setErrorMessage(`Unsupported file type: ${file.type}. Only PNG, JPG, and GIF are supported.`)
          continue
        }
        
        // Validate file size (before compression)
        const sizeValidation = validateImageSize(file, 50 * 1024 * 1024) // 50MB max
        if (!sizeValidation.valid) {
          setErrorMessage(sizeValidation.error ?? 'Image file is too large')
          continue
        }
        
        // Compress the image
        const compressed = await compressImage(file, {
          maxWidth: 1920,
          maxHeight: 1920,
          quality: 0.85,
          maxSizeBytes: 1048576, // 1MB target
        })
        
        // Create attachment
        const attachment: Attachment = {
          id: generateUUID(),
          filename: file.name,
          mimeType: compressed.mimeType as 'image/png' | 'image/jpeg' | 'image/gif',
          size: compressed.size,
          data: compressed.dataUrl,
        }
        
        setAttachments(prev => [...prev, attachment])
      } catch (err) {
        const errorMsg = err instanceof Error ? (err.message ?? 'Failed to process image') : 'Failed to process image'
        setErrorMessage(errorMsg)
      }
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
      try {
        // Validate file type
        if (!isValidImageType(file)) {
          setErrorMessage(`Unsupported file type: ${file.type}. Only PNG, JPG, and GIF are supported.`)
          continue
        }
        
        // Validate file size
        const sizeValidation = validateImageSize(file, 50 * 1024 * 1024)
        if (!sizeValidation.valid) {
          setErrorMessage(sizeValidation.error ?? 'Image file is too large')
          continue
        }
        
        // Compress the image
        const compressed = await compressImage(file, {
          maxWidth: 1920,
          maxHeight: 1920,
          quality: 0.85,
          maxSizeBytes: 1048576,
        })
        
        const attachment: Attachment = {
          id: generateUUID(),
          filename: file.name,
          mimeType: compressed.mimeType as 'image/png' | 'image/jpeg' | 'image/gif',
          size: compressed.size,
          data: compressed.dataUrl,
        }
        
        setAttachments(prev => [...prev, attachment])
      } catch (err) {
        const errorMsg = err instanceof Error ? (err.message ?? 'Failed to process image') : 'Failed to process image'
        setErrorMessage(errorMsg)
      }
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
  
  // Count pending criteria (not passed)
  const pendingCriteria = session?.criteria.filter(c => c.status.type !== 'passed') ?? []
  const hasPendingCriteria = pendingCriteria.length > 0
  
  // Show "Start Building" when in planner with criteria and assistant has responded
  // Don't show if already done (all criteria verified)
  const hasAssistantResponse = displayItems.some(item => 
    item.type === 'message' && item.message.role === 'assistant'
  )
  const showStartBuilding = isPlanning && hasCriteria && !isRunning && hasAssistantResponse && !isDone
  
  // Show Launch button in builder mode when there are pending criteria
  const showLaunchButton = isBuilding && hasPendingCriteria && !isRunning && !isDone
  
  return (
    <SessionLayout criteriaSidebarOpen={criteriaSidebarOpen} messages={messages}>
      {pendingPathConfirmation && (
        <PathConfirmationDialog confirmation={pendingPathConfirmation} />
      )}
      <SessionHeader 
        criteriaSidebarOpen={criteriaSidebarOpen}
        onCriteriaSidebarToggle={() => setCriteriaSidebarOpen(!criteriaSidebarOpen)}
      />
      
      {displayItems.length === 0 && (
        <div className="flex-1 min-w-0" />
      )}
      {displayItems.length > 0 && <Virtuoso
        key={session?.id ?? 'none'}
        ref={virtuosoRef}
        data={displayItems}
        className="flex-1 min-w-0 overflow-x-hidden"
        increaseViewportBy={{ top: 500, bottom: 200 }}
        followOutput={followOutput}
        atBottomStateChange={setAtBottom}
        atBottomThreshold={150}
        defaultItemHeight={120}
        initialTopMostItemIndex={Infinity}
        alignToBottom
        itemContent={(_index, item) => {
          if (item.type === 'context-divider') {
            return (
              <div className="flex items-center gap-2 feed-item px-2 md:px-4">
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
              <div className="px-2 md:px-4">
                <SubAgentContainer
                  messages={item.messages}
                  subAgentType={item.subAgentType}
                  isStreaming={groupIsStreaming}
                />
              </div>
            )
          }

          if (item.type === 'criteria-batch') {
            return (
              <div className="feed-item px-2 md:px-4">
                <CriteriaGroupDisplay toolCalls={item.toolCalls} criteria={session?.criteria} />
              </div>
            )
          }

          const message = item.message
          if (message.role === 'assistant') {
            return (
              <div className="px-2 md:px-4">
                <AssistantMessage
                  message={message}
                  showStats={true}
                />
              </div>
            )
          }

          return (
            <div className="px-2 md:px-4">
              <ChatMessage
                message={message}
                isLastAssistantMessage={false}
                promptContext={message.role === 'user' ? promptContextByUserMessageId[message.id] : undefined}
              />
            </div>
          )
        }}
        components={{
          Header: () => <div className="pt-4" />,
          Footer: () => (
            <div className="px-2 md:px-4 pb-4">
              {error && (
                <div className="feed-item bg-red-500/10 border border-red-500/50 rounded p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-red-400 text-sm font-medium">{error.code}</div>
                      <div className="text-red-300 text-xs mt-0.5">{error.message}</div>
                    </div>
                    <button
                      onClick={clearError}
                      className="text-red-400 hover:text-red-300 p-0.5"
                      aria-label="Dismiss error"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}

              {showStartBuilding && (
                <div className="flex justify-center feed-item">
                  <Button
                    variant="primary"
                    onClick={acceptAndBuild}
                    className="bg-blue-600 hover:bg-blue-700 px-4 py-1 text-sm"
                  >
                    ▶ Start
                  </Button>
                </div>
              )}

              {isRunning && <RunningIndicator />}
            </div>
          ),
        }}
      />}

      <form onSubmit={handleSubmit} className="p-2 md:p-4 border-t border-border bg-gradient-to-t from-bg-secondary/50 to-transparent">
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
        
        <div 
          className={`flex items-end gap-3 p-3 rounded border transition-colors ${
            dragOver 
              ? 'border-accent-primary/50 bg-accent-primary/10' 
              : isRunning 
                ? 'border-accent-warning/30 bg-accent-warning/5' 
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
            disabled={isRunning}
            className="p-3 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Attach image file"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
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
            onKeyUp={(e) => {
              // Handle Arrow Up on empty textarea to show history
              if (e.key === 'ArrowUp' && input.trim() === '' && !showHistory) {
                e.preventDefault()
                openHistory()
              }
            }}
            placeholder={
              isPlanning 
                ? "What would you like to build?" 
                : "Send a message..."
            }
            className="flex-1 bg-transparent text-sm placeholder:text-text-muted resize-none overflow-y-auto focus:outline-none"
            style={{ minHeight: '24px', maxHeight: '200px' }}
          />
          {!isRunning ? (
            <div className="flex items-center gap-2">
              {showLaunchButton && (
                <button
                  type="button"
                  onClick={launchRunner}
                  className="px-4 py-1.5 rounded bg-accent-success/20 text-sm text-accent-success font-medium hover:bg-accent-success/30 transition-colors"
                >
                  Launch
                </button>
              )}
              <button
                type="submit"
                disabled={(!input.trim() && attachments.length === 0)}
                className="px-4 py-1.5 rounded bg-accent-primary/20 text-sm text-accent-primary font-medium hover:bg-accent-primary/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Send
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={stopGeneration}
              className="px-4 py-1.5 rounded bg-accent-error/20 text-sm text-accent-error font-medium hover:bg-accent-error/30 transition-colors animate-pulse"
            >
              Stop
            </button>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <ModeSwitch />
          <ProviderSelector />
        </div>
      </form>
    </SessionLayout>
  )
}
