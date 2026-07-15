import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useSessionStore, useIsRunning } from '../../stores/session'
import { useDisplaySettings } from '../../stores/settings'

import { type TurnStats } from '../../lib/types'

import { SessionLayout } from '../layout/SessionLayout'
import { SessionHeader } from './SessionHeader'
import { TurnStatsModal } from './TurnStatsModal'
import { MessageList } from './MessageList'
import { ConnectionStatusBar } from '../shared/ConnectionStatusBar'
import { useAgentsStore } from '../../stores/agents'
import { useCommandsStore } from '../../stores/commands'
import { useWorkflowsStore } from '../../stores/workflows'
import { focusChatTextarea } from '../../lib/focusChatTextarea'
import { CommandsModal } from '../settings/CommandsModal'
import { WorkflowsModal } from '../settings/WorkflowsModal'
import { QuickActionModal } from '../QuickActionModal'
import { MessageSearchModal } from './MessageSearchModal'
import { ChatInput } from './ChatInput'
import { shouldCaptureMessageSearchShortcut } from './message-search-shortcut'

import { groupMessages, type DisplayItem } from './groupMessages.js'
import { usePromptHistory } from '../../hooks/usePromptHistory.js'
import { useAutoScroll } from '@/hooks/useAutoScroll.ts'
import { useScrolledSend } from '@/hooks/useScrolledSend.ts'
import { useKeybindings, useBinding, useAgentSwitchingBindings } from '../../hooks/useKeybindings'

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

  const [attachments, setAttachments] = useState<import('@shared/types.js').Attachment[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [showCommandsModal, setShowCommandsModal] = useState(false)
  const [showWorkflowsModal, setShowWorkflowsModal] = useState(false)
  const [showQuickAction, setShowQuickAction] = useState(false)
  const [showMessageSearch, setShowMessageSearch] = useState(false)
  const [turnStatsModal, setTurnStatsModal] = useState<TurnStats | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const session = useSessionStore((state) => state.currentSession)
  const rawMessages = useSessionStore((state) => state.messages)
  const sessions = useSessionStore((state) => state.sessions)
  const isRunning = useIsRunning()
  const stopGeneration = useSessionStore((state) => state.stopGeneration)

  const agentDefaults = useAgentsStore((state) => state.defaults)
  const agentUserItems = useAgentsStore((state) => state.userItems)
  const topLevelAgents = [...agentDefaults, ...agentUserItems].filter((a) => !a.subagent)

  const { history, selectedIndex, showHistory, openHistory, closeHistory, navigateUp, navigateDown, selectCurrent } =
    usePromptHistory(rawMessages, sessions, session?.id)

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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (shouldCaptureMessageSearchShortcut(e)) {
        e.preventDefault()
        setShowMessageSearch(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const { maxVisibleItems } = useDisplaySettings()

  const previousDisplayItemsRef = useRef<DisplayItem[]>([])

  const { displayItems, hiddenCount } = useMemo((): { displayItems: DisplayItem[]; hiddenCount: number } => {
    const items = groupMessages(rawMessages, previousDisplayItemsRef.current)
    previousDisplayItemsRef.current = items
    if (maxVisibleItems > 0 && items.length > maxVisibleItems) {
      return { displayItems: items.slice(-maxVisibleItems), hiddenCount: items.length - maxVisibleItems }
    }
    return { displayItems: items, hiddenCount: 0 }
  }, [rawMessages, maxVisibleItems])

  const { isAutoScrollActive, setAutoScroll } = useAutoScroll(scrollContainerRef, session)
  const { sendMessage, launchWorkflow } = useScrolledSend(setAutoScroll)

  const handleLaunchWorkflow = useCallback(
    (workflowId: string, subGroup?: string) => {
      launchWorkflow(undefined, undefined, workflowId, subGroup)
    },
    [launchWorkflow],
  )

  const handleTimelineNavigate = useCallback(
    (index: number) => {
      setAutoScroll(false)
      const element = document.querySelector(`[data-item-index="${index}"]`)
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' })
        element.closest('[data-testid="chat-scroll-container"]')?.scrollBy(0, -80)
      }
    },
    [setAutoScroll],
  )

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

  const keybindings = useKeybindings()
  useBinding(keybindings.quickAction, () => {
    setShowQuickAction(true)
  })

  useAgentSwitchingBindings(keybindings.agentSwitching, topLevelAgents, (agentId) => {
    useSessionStore.getState().switchMode(agentId)
  })

  const handleSelectWorkflow = (workflowId: string) => {
    const content = input.trim() ? input : undefined
    const atts = attachments.length > 0 ? attachments : undefined
    launchWorkflow(content, atts, workflowId)
    clearInput()
  }

  const handleSelectWorkflowWithSubGroup = (workflowId: string, subGroup: string) => {
    const content = input.trim() ? input : undefined
    const atts = attachments.length > 0 ? attachments : undefined
    launchWorkflow(content, atts, workflowId, subGroup)
    clearInput()
  }

  const clearInput = () => {
    setInput('')
    setAttachments([])
    if (session?.id) {
      localStorage.removeItem(`openfox:draft:${session.id}`)
    }
  }

  return (
    <>
      <SessionLayout
        criteriaSidebarOpen={criteriaSidebarOpen}
        onCriteriaSidebarToggle={onCriteriaSidebarToggle}
        messages={rawMessages}
      >
        <SessionHeader />

        {turnStatsModal && <TurnStatsModal stats={turnStatsModal} onClose={() => setTurnStatsModal(null)} />}
        <ConnectionStatusBar />

        <MessageList
          displayItems={displayItems}
          scrollContainerRef={scrollContainerRef}
          highlightedMessageId={null}
          onLaunchWorkflow={handleLaunchWorkflow}
          hiddenCount={hiddenCount}
        />

        <ChatInput
          input={input}
          setInput={setInput}
          attachments={attachments}
          setAttachments={setAttachments}
          dragOver={dragOver}
          setDragOver={setDragOver}
          errorMessage={errorMessage}
          setErrorMessage={setErrorMessage}
          scrollContainerRef={scrollContainerRef}
          sessionId={session?.id}
          sessionMode={session?.mode}
          showHistory={showHistory}
          history={history}
          selectedIndex={selectedIndex}
          openHistory={openHistory}
          closeHistory={closeHistory}
          navigateUp={navigateUp}
          navigateDown={navigateDown}
          selectCurrent={selectCurrent}
          isAutoScrollActive={isAutoScrollActive}
          setAutoScroll={setAutoScroll}
          onOpenMessageSearch={() => setShowMessageSearch(true)}
          onOpenCommandsModal={() => setShowCommandsModal(true)}
          onOpenWorkflowsModal={() => setShowWorkflowsModal(true)}
          onSelectWorkflow={handleSelectWorkflow}
          onSelectWorkflowWithSubGroup={handleSelectWorkflowWithSubGroup}
          clearInput={clearInput}
        />
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
            launchWorkflow(content, atts, workflowId)
            clearInput()
          }}
        />
      </SessionLayout>

      {showMessageSearch && (
        <MessageSearchModal
          isOpen={showMessageSearch}
          onClose={() => {
            setShowMessageSearch(false)
            focusChatTextarea()
          }}
          displayItems={displayItems}
          onNavigate={handleTimelineNavigate}
        />
      )}
    </>
  )
}

export { VisionFallbackItem } from './VisionFallbackItem'
