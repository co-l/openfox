import { memo, useState, useRef, useCallback, useEffect, useLayoutEffect, type ReactNode } from 'react'
import type { OverlayScrollbarsComponentRef } from 'overlayscrollbars-react'
import { ScrollArea } from '../shared/ScrollArea'
import type { ScrollbarGestureKind } from '../shared/ScrollArea'
import { useViewport } from '../../hooks/useViewport'
import { useSessionStore, useIsRunning } from '../../stores/session'
import { useAllWorkflows } from '../../stores/workflows'
import { SCOPE_LABELS } from '../../lib/workflow-scope'
import { useDisplaySettings } from '../../stores/settings'
import { ChatFeedItems } from './ChatFeedItems'
import { CloseButton } from '../shared/CloseButton'
import { ChevronUpIcon } from '../shared/icons'
import { useClickOutside } from '../../hooks/useClickOutside'
import { useSessionScope, useScopedPaneState } from '../../stores/session/session-scope'
import type { DisplayItem } from './groupMessages.js'
import type { MetadataEntry, WorkflowScope } from '@shared/types.js'
import type { LLMRetryState } from '../../stores/session/types'

const EMPTY_CRITERIA: MetadataEntry[] = []

/** Live countdown pill shown while an LLM call is backing off before its next retry. */
function LLMRetryIndicator({
  retry,
  onRetryNow,
}: {
  retry: Extract<LLMRetryState, { status: 'retrying' }>
  onRetryNow: () => void
}) {
  const [receivedAt] = useState(Date.now())
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [])

  const remainingSec = Math.max(0, Math.ceil((retry.retryInMs - (now - receivedAt)) / 1000))
  const suffix = remainingSec > 0 ? ` — next try in ${remainingSec}s` : ''

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-bg-tertiary/60 border border-border text-xs text-text-secondary">
      <span className="w-2 h-2 rounded-full bg-accent-primary animate-pulse" />
      <span>
        LLM call failed — retrying (attempt {retry.attempt}){suffix}
      </span>
      <button
        onClick={onRetryNow}
        className="ml-1 px-2 py-0.5 rounded-full bg-accent-primary/15 text-accent-primary border border-accent-primary/25 hover:bg-accent-primary/25 transition-colors"
      >
        Retry now
      </button>
    </div>
  )
}

interface MessageListProps {
  displayItems: DisplayItem[]
  scrollContainerRef: React.RefObject<OverlayScrollbarsComponentRef<'div'> | null>
  highlightedMessageId: string | null
  onLaunchWorkflow: (
    workflowId: string,
    subGroup?: string,
    params?: Record<string, string>,
    scope?: WorkflowScope,
  ) => void
  onScrollToTop?: () => void
  hiddenCount?: number
  onScrollbarGesture?: (kind: ScrollbarGestureKind, gapToEndPx: number | null) => void
  emptyState?: ReactNode
}

export const MessageList = memo(function MessageList({
  displayItems,
  scrollContainerRef,
  highlightedMessageId,
  onLaunchWorkflow,
  onScrollToTop,
  hiddenCount = 0,
  onScrollbarGesture,
  emptyState,
}: MessageListProps) {
  const scopeId = useSessionScope()
  const criteria = useScopedPaneState(
    scopeId,
    (pane) => pane.session?.metadataEntries?.['criteria'] ?? EMPTY_CRITERIA,
    (state) => state.currentSession?.metadataEntries?.['criteria'] ?? EMPTY_CRITERIA,
    EMPTY_CRITERIA,
  )
  const sessionId = useScopedPaneState(
    scopeId,
    (pane) => pane.session?.id ?? null,
    (state) => state.currentSession?.id ?? null,
    null,
  )
  const sessionPhase = useScopedPaneState(
    scopeId,
    (pane) => pane.session?.phase ?? null,
    (state) => state.currentSession?.phase ?? null,
    null,
  )
  const error = useScopedPaneState(
    scopeId,
    (pane) => pane.error ?? null,
    (state) => state.error,
    null,
  )
  const clearError = useSessionStore((state) => state.clearError)
  const isRunning = useIsRunning(scopeId)
  const activeWorkflowExecution = useScopedPaneState(
    scopeId,
    (pane) => pane.activeWorkflowExecution ?? null,
    (state) => state.activeWorkflowExecution,
    null,
  )
  const continueWorkflow = useSessionStore((state) => state.continueWorkflow)
  const llmRetry = useScopedPaneState(
    scopeId,
    (pane) => pane.llmRetry ?? null,
    (state) => state.llmRetry,
    null,
  )
  const retryLLMNow = useSessionStore((state) => state.retryLLMNow)
  const retryLLM = useSessionStore((state) => state.retryLLM)
  const { showThinking, showVerboseToolOutput, showStats, showAgentDefinitions, showWorkflowBars } =
    useDisplaySettings()

  const workflows = useAllWorkflows()

  const hasNewCriteria = criteria.some((c) => c.status === 'pending')
  const isDone = sessionPhase === 'done'
  const hasAssistantResponse = displayItems.some((item) => item.type === 'message' && item.message.role === 'assistant')
  const hasActiveWorkflow =
    activeWorkflowExecution?.status === 'running' || activeWorkflowExecution?.status === 'waiting'
  const showStartBuilding = hasNewCriteria && !isRunning && hasAssistantResponse && !isDone && !hasActiveWorkflow
  const showContinueWorkflow = activeWorkflowExecution?.status === 'waiting' && !isRunning
  const blockedWorkflowStep = activeWorkflowExecution?.status === 'blocked' && !!activeWorkflowExecution.currentStepId
  const isWorkflowBlock = blockedWorkflowStep && llmRetry?.status !== 'failed'

  const projectId = useScopedPaneState(
    scopeId,
    (pane) => pane.session?.projectId ?? undefined,
    (state) => state.currentSession?.projectId,
    undefined,
  )
  const [popupBlocked, setPopupBlocked] = useState(false)
  const [isScrollable, setIsScrollable] = useState(false)
  const [scrolledPastTop, setScrolledPastTop] = useState(false)

  const getViewport = useViewport(scrollContainerRef)

  useLayoutEffect(() => {
    const el = getViewport()
    if (!el) return
    setIsScrollable(el.scrollHeight > el.clientHeight + 1)
  }, [getViewport, displayItems])

  useEffect(() => {
    const el = getViewport()
    if (!el) return
    const onScroll = () => setScrolledPastTop(el.scrollTop > 4)
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [getViewport])

  const openFullHistory = () => {
    if (!projectId || !sessionId) return
    setPopupBlocked(false)
    const win = window.open(`/p/${projectId}/s/${sessionId}/readonly`, '_blank')
    if (!win) {
      setPopupBlocked(true)
    }
  }

  const [continuing, setContinuing] = useState(false)

  const handleContinue = useCallback(
    (choiceId?: string) => {
      if (continuing || !scopeId) return
      setContinuing(true)
      continueWorkflow(scopeId, choiceId)
      // Re-enable after a timeout in case the workflow doesn't start
      setTimeout(() => setContinuing(false), 5000)
    },
    [continuing, continueWorkflow, scopeId],
  )

  const scrollToTop = useCallback(() => {
    onScrollToTop?.()
    getViewport()?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [getViewport, onScrollToTop])

  return (
    <div className="relative flex-1 min-w-0 group">
      <ScrollArea
        ref={scrollContainerRef}
        data-testid="chat-scroll-container"
        className="absolute inset-0 bg-primary"
        onScrollbarGesture={onScrollbarGesture}
      >
        <div className="flex min-h-full flex-col">
          <div className="pt-4">
            {hiddenCount > 0 && (
              <div className="px-2 @md:px-4 pb-2 space-y-1">
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
              scrollContainerRef={scrollContainerRef}
              showThinking={showThinking}
              showVerboseToolOutput={showVerboseToolOutput}
              showStats={showStats}
              showAgentDefinitions={showAgentDefinitions}
              showWorkflowBars={showWorkflowBars}
            />
          </div>
          {displayItems.length === 0 && emptyState && (
            <div className="flex flex-1 items-center justify-center px-2 @md:px-4 py-4">{emptyState}</div>
          )}
          <div className="px-2 @md:px-4 pb-4">
            {llmRetry?.status === 'retrying' && isRunning && (
              <div className="flex justify-center feed-item" data-testid="llm-retry-indicator">
                <LLMRetryIndicator
                  key={llmRetry.attempt}
                  retry={llmRetry}
                  onRetryNow={() => sessionId && retryLLMNow(sessionId)}
                />
              </div>
            )}

            {(llmRetry?.status === 'failed' && !isRunning) || blockedWorkflowStep ? (
              <div className="flex flex-col items-center gap-2 feed-item flex-wrap">
                {llmRetry?.status === 'failed' && (
                  <div className="text-xs text-text-secondary max-w-md text-center">
                    The LLM call failed: {llmRetry.error}
                  </div>
                )}
                {isWorkflowBlock && (
                  <div className="text-xs text-text-secondary max-w-md text-center">
                    {activeWorkflowExecution?.currentStepName
                      ? `The "${activeWorkflowExecution.currentStepName}" step stopped before finishing — retry to continue.`
                      : 'This workflow step stopped before finishing — retry to continue.'}
                  </div>
                )}
                <button
                  onClick={() => sessionId && retryLLM(sessionId)}
                  disabled={isRunning}
                  className="px-4 py-1.5 text-sm font-medium rounded bg-accent-primary/15 text-accent-primary border border-accent-primary/25 hover:bg-accent-primary/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isRunning ? 'Resuming…' : isWorkflowBlock ? '↻ Retry step' : '↻ Retry'}
                </button>
              </div>
            ) : null}

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

            {showContinueWorkflow && activeWorkflowExecution && (
              <div className="flex justify-center gap-2 feed-item flex-wrap">
                {(activeWorkflowExecution.pendingChoices && activeWorkflowExecution.pendingChoices.length > 0
                  ? activeWorkflowExecution.pendingChoices
                  : [
                      {
                        id: undefined as string | undefined,
                        label: `▶ Continue ${activeWorkflowExecution.workflowName} (${
                          activeWorkflowExecution.currentStepName ?? '...'
                        })`,
                        goto: '',
                        nextStepName: undefined as string | undefined,
                      },
                    ]
                ).map((choice) => (
                  <button
                    key={choice.id ?? 'continue'}
                    onClick={() => handleContinue(choice.id)}
                    disabled={continuing}
                    className="px-4 py-1.5 text-sm font-medium rounded bg-accent-primary/15 text-accent-primary border border-accent-primary/25 hover:bg-accent-primary/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {continuing
                      ? '⏳ Continuing...'
                      : choice.id === 'continue'
                        ? `▶ Continue ${activeWorkflowExecution.workflowName} (${choice.nextStepName ?? activeWorkflowExecution.currentStepName ?? '...'})`
                        : choice.label}
                  </button>
                ))}
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
                      key={`${w.id}-${w.scope}`}
                      workflowName={w.name}
                      scope={w.scope}
                      color={c}
                      bg={bg}
                      bgHover={bgHover}
                      border={border}
                      subGroups={w.subGroups}
                      onLaunch={(subGroup?: string) => onLaunchWorkflow(w.id, subGroup, undefined, w.scope)}
                    />
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

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
  scope,
  color,
  bg,
  bgHover,
  border,
  subGroups,
  onLaunch,
}: {
  workflowName: string
  scope: WorkflowScope
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
        ▶ {workflowName}{' '}
        <span className="text-[10px] font-normal opacity-70 whitespace-nowrap">{SCOPE_LABELS[scope]}</span>
      </button>
      {hasSubGroups && (
        <div ref={menuRef} className="relative flex">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="px-2.5 py-1.5 rounded-r text-sm font-medium transition-colors flex items-center"
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
