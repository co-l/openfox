import { memo, useState, useRef, useCallback, useEffect, useLayoutEffect, type RefObject } from 'react'
import { useSessionStore, useIsRunning } from '../../stores/session'
import { useWorkflowsStore } from '../../stores/workflows'
import { useDisplaySettings } from '../../stores/settings'
import { ChatFeedItems } from './ChatFeedItems'
import { CloseButton } from '../shared/CloseButton'
import { ChevronUpIcon } from '../shared/icons'
import { useClickOutside } from '../../hooks/useClickOutside'
import type { DisplayItem } from './groupMessages.js'
import type { MetadataEntry } from '@shared/types.js'

const EMPTY_CRITERIA: MetadataEntry[] = []

interface MessageListProps {
  displayItems: DisplayItem[]
  scrollContainerRef: RefObject<HTMLDivElement | null>
  highlightedMessageId: string | null
  onLaunchWorkflow: (workflowId: string, subGroup?: string) => void
  onScrollToTop?: () => void
  hiddenCount?: number
}

export const MessageList = memo(function MessageList({
  displayItems,
  scrollContainerRef,
  highlightedMessageId,
  onLaunchWorkflow,
  onScrollToTop,
  hiddenCount = 0,
}: MessageListProps) {
  const criteria = useSessionStore((state) => state.currentSession?.metadataEntries?.['criteria'] ?? EMPTY_CRITERIA)
  const sessionId = useSessionStore((state) => state.currentSession?.id)
  const sessionMode = useSessionStore((state) => state.currentSession?.mode)
  const sessionPhase = useSessionStore((state) => state.currentSession?.phase)
  const error = useSessionStore((state) => state.error)
  const clearError = useSessionStore((state) => state.clearError)
  const isRunning = useIsRunning()
  const { showThinking, showVerboseToolOutput, showStats, showAgentDefinitions, showWorkflowBars } =
    useDisplaySettings()

  const workflowDefaults = useWorkflowsStore((state) => state.defaults)
  const workflowUserItems = useWorkflowsStore((state) => state.userItems)
  const workflows = [...workflowDefaults, ...workflowUserItems]

  const isPlanning = sessionMode === 'planner'
  const hasCriteria = criteria.length > 0
  const isDone = sessionPhase === 'done'
  const hasAssistantResponse = displayItems.some((item) => item.type === 'message' && item.message.role === 'assistant')
  const showStartBuilding = isPlanning && hasCriteria && !isRunning && hasAssistantResponse && !isDone

  const projectId = useSessionStore((state) => state.currentSession?.projectId)
  const [popupBlocked, setPopupBlocked] = useState(false)
  const [isScrollable, setIsScrollable] = useState(false)
  const [scrolledPastTop, setScrolledPastTop] = useState(false)

  useLayoutEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    setIsScrollable(el.scrollHeight > el.clientHeight + 1)
  }, [scrollContainerRef, displayItems])

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const onScroll = () => setScrolledPastTop(el.scrollTop > 4)
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [scrollContainerRef])

  const openFullHistory = () => {
    if (!projectId || !sessionId) return
    setPopupBlocked(false)
    const win = window.open(`/p/${projectId}/s/${sessionId}/readonly`, '_blank')
    if (!win) {
      setPopupBlocked(true)
    }
  }

  const scrollToTop = useCallback(() => {
    onScrollToTop?.()
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [scrollContainerRef, onScrollToTop])

  return (
    <div className="relative flex-1 min-w-0 group">
      <div
        ref={scrollContainerRef}
        data-testid="chat-scroll-container"
        className="absolute inset-0 overflow-y-auto bg-primary scrollbar-stable"
      >
        <div className="pt-4">
          {hiddenCount > 0 && (
            <div className="px-2 md:px-4 pb-2 space-y-1">
              <button
                onClick={openFullHistory}
                className="w-full text-sm text-text-muted hover:text-text-primary bg-bg-tertiary/50 hover:bg-bg-tertiary border border-border rounded px-3 py-2 transition-colors text-center"
              >
                {hiddenCount} older item{hiddenCount !== 1 ? 's' : ''} hidden — View full history
              </button>
              {popupBlocked && (
                <p className="text-xs text-text-muted text-center">
                  Popup blocked.{' '}
                  <a
                    href={projectId && sessionId ? `/p/${projectId}/s/${sessionId}/readonly` : '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-text-primary"
                  >
                    Open manually
                  </a>
                </p>
              )}
            </div>
          )}

          <ChatFeedItems
            displayItems={displayItems}
            highlightedMessageId={highlightedMessageId}
            sessionId={sessionId}
            showThinking={showThinking}
            showVerboseToolOutput={showVerboseToolOutput}
            showStats={showStats}
            showAgentDefinitions={showAgentDefinitions}
            showWorkflowBars={showWorkflowBars}
          />
        </div>
        <div className="px-2 md:px-4 pb-4">
          {error && (
            <div className="feed-item bg-text-tool-error/10 border border-text-tool-error/50 rounded p-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-text-tool-error text-sm font-medium">{error.code}</div>
                  <div className="text-text-tool-error/80 text-xs mt-0.5">{error.message}</div>
                </div>
                <CloseButton
                  onClick={clearError}
                  className="text-text-tool-error hover:text-text-tool-error/80 p-0.5"
                  size="sm"
                />
              </div>
            </div>
          )}

          {showStartBuilding && (
            <div className="flex justify-center gap-2 feed-item flex-wrap">
              {workflows.map((w) => {
                const c = w.color ?? '#3b82f6'
                const r = parseInt(c.slice(1, 3), 16),
                  g = parseInt(c.slice(3, 5), 16),
                  b = parseInt(c.slice(5, 7), 16)
                const bg = `rgba(${r},${g},${b},0.12)`
                const bgHover = `rgba(${r},${g},${b},0.22)`
                const border = `rgba(${r},${g},${b},0.25)`
                return (
                  <WorkflowButton
                    key={w.id}
                    workflowName={w.name}
                    color={c}
                    bg={bg}
                    bgHover={bgHover}
                    border={border}
                    subGroups={w.subGroups}
                    onLaunch={(subGroup?: string) => onLaunchWorkflow(w.id, subGroup)}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>

      {isScrollable && scrolledPastTop && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <button
            type="button"
            onClick={scrollToTop}
            className="pointer-events-auto text-sm text-text-muted hover:text-text-primary flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-bg-tertiary transition-colors backdrop-blur-sm bg-bg-secondary/60"
          >
            <ChevronUpIcon className="w-3 h-3" />
            scroll to top
          </button>
        </div>
      )}
    </div>
  )
})

function WorkflowButton({
  workflowName,
  color,
  bg,
  bgHover,
  border,
  subGroups,
  onLaunch,
}: {
  workflowName: string
  color: string
  bg: string
  bgHover: string
  border: string
  subGroups?: string[]
  onLaunch: (subGroup?: string) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useClickOutside(menuRef, () => setMenuOpen(false), menuOpen)

  const hasSubGroups = subGroups && subGroups.length > 0

  return (
    <div className="relative flex">
      <button
        onClick={() => onLaunch()}
        data-testid="workflow-run-button"
        className={`px-4 py-1.5 text-sm font-medium transition-colors ${hasSubGroups ? 'rounded-l' : 'rounded'}`}
        style={{
          backgroundColor: bg,
          color,
          border: `1px solid ${border}`,
          ...(hasSubGroups ? { borderRight: 'none' } : {}),
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = bgHover
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = bg
        }}
      >
        ▶ {workflowName}
      </button>
      {hasSubGroups && (
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="px-2.5 py-1.5 rounded-r text-sm font-medium transition-colors"
            style={{ backgroundColor: bg, color, border: `1px solid ${border}` }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = bgHover
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = bg
            }}
          >
            ⋮
          </button>
          {menuOpen && (
            <div className="absolute top-full right-0 mt-1 w-40 bg-bg-secondary border border-border rounded-lg shadow-xl z-50 overflow-hidden">
              <button
                onClick={() => {
                  onLaunch()
                  setMenuOpen(false)
                }}
                className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-tertiary transition-colors"
              >
                Full workflow
              </button>
              <div className="border-t border-border/50" />
              {subGroups.map((sg) => (
                <button
                  key={sg}
                  onClick={() => {
                    onLaunch(sg)
                    setMenuOpen(false)
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-tertiary transition-colors"
                >
                  {sg}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
