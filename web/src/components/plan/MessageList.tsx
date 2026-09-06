import { memo, useState, useCallback, useEffect, useLayoutEffect, type ReactNode } from 'react'
import type { OverlayScrollbarsComponentRef } from 'overlayscrollbars-react'
import { ScrollArea } from '../shared/ScrollArea'
import type { ScrollbarGestureKind } from '../shared/ScrollArea'
import { useT } from '../../hooks/useT'
import { useViewport } from '../../hooks/useViewport'
import { useSessionStore, useIsRunning } from '../../stores/session'
import { useWorkflows } from '../../hooks/useWorkflows'
import { useSessionWorkdir } from '../../hooks/useSessionWorkdir'
import { useDisplaySettings } from '../../hooks/useDisplaySettings'
import { ChatFeedItems } from './ChatFeedItems'
import { AutoLaunchCountdown } from './AutoLaunchCountdown'
import { PostPlanLaunchBar } from './PostPlanLaunchBar'
import { WorkflowButton } from './WorkflowButton'
import { useResourceWhen } from '../../hooks/useResource'
import { taskFromSessionResource } from '../../lib/resources'
import { hexToRgba } from '../../lib/colors'
import { CloseButton } from '../shared/CloseButton'
import { Modal } from '../shared/Modal'
import { ChevronUpIcon, InfoIcon } from '../shared/icons'
import { useSessionScope, useScopedPaneState } from '../../stores/session/session-scope'
import type { DisplayItem } from './groupMessages.js'
import type { MetadataEntry, WorkflowScope } from '@shared/types.js'
import type { LLMRetryState } from '../../stores/session/types'
import { prettyPrintError } from '../../lib/prettyPrintError'

const EMPTY_CRITERIA: MetadataEntry[] = []

function ErrorInfoButton({ onClick }: { onClick: () => void }) {
  const t = useT()
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t({ en: 'View error details', fr: 'Voir les détails de l’erreur' })}
      title={t({ en: 'View error details', fr: 'Voir les détails de l’erreur' })}
      className="shrink-0 p-1 rounded-full text-text-muted hover:text-text-primary hover:bg-bg-primary transition-colors"
    >
      <InfoIcon className="w-3.5 h-3.5" />
    </button>
  )
}

/** Live countdown pill shown while an LLM call is backing off before its next retry. */
function LLMRetryIndicator({
  retry,
  onRetryNow,
  onShowError,
}: {
  retry: Extract<LLMRetryState, { status: 'retrying' }>
  onRetryNow: () => void
  onShowError: () => void
}) {
  const t = useT()
  const [receivedAt] = useState(Date.now())
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [])

  const remainingSec = Math.max(0, Math.ceil((retry.retryInMs - (now - receivedAt)) / 1000))
  const suffix =
    remainingSec > 0
      ? t({ en: ' — next try in {{count}}s', fr: ' — prochain essai dans {{count}}s' }, { count: remainingSec })
      : ''

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-bg-tertiary/60 border border-border text-xs text-text-secondary">
      <span className="w-2 h-2 rounded-full bg-accent-primary animate-pulse" />
      <span>
        {t(
          {
            en: 'LLM call failed — retrying (attempt {{count}})',
            fr: 'Appel LLM échoué — nouvelle tentative (essai {{count}})',
          },
          { count: retry.attempt },
        )}
        {suffix}
      </span>
      <ErrorInfoButton onClick={onShowError} />
      <button
        onClick={onRetryNow}
        className="ml-1 px-2 py-0.5 rounded-full bg-accent-primary/15 text-accent-primary border border-accent-primary/25 hover:bg-accent-primary/25 transition-colors"
      >
        {t({ en: 'Retry now', fr: 'Réessayer maintenant' })}
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
  const t = useT()
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
  const autoLaunch = useScopedPaneState(
    scopeId,
    (pane) => pane.autoLaunch ?? null,
    (state) => state.autoLaunch,
    null,
  )
  const cancelAutoLaunch = useSessionStore((state) => state.cancelAutoLaunch)
  const llmRetry = useScopedPaneState(
    scopeId,
    (pane) => pane.llmRetry ?? null,
    (state) => state.llmRetry,
    null,
  )
  const retryLLMNow = useSessionStore((state) => state.retryLLMNow)
  const retryLLM = useSessionStore((state) => state.retryLLM)
  const [showRetryError, setShowRetryError] = useState(false)
  // The modal lives above the per-attempt keyed pill so it survives retries.
  // Close it once the retry state clears (call succeeded, bubble gone).
  useEffect(() => {
    if (!llmRetry) setShowRetryError(false)
  }, [llmRetry])
  const { showThinking, showVerboseToolOutput, showStats, showAgentDefinitions, showWorkflowBars } =
    useDisplaySettings()

  const { workflows } = useWorkflows(useSessionWorkdir())

  const hasNewCriteria = criteria.some((c) => c.status === 'pending')
  const isDone = sessionPhase === 'done'
  const hasAssistantResponse = displayItems.some((item) => item.type === 'message' && item.message.role === 'assistant')
  const hasActiveWorkflow =
    activeWorkflowExecution?.status === 'running' || activeWorkflowExecution?.status === 'waiting'
  const showStartBuilding = hasNewCriteria && !isRunning && hasAssistantResponse && !isDone && !hasActiveWorkflow
  const showContinueWorkflow = activeWorkflowExecution?.status === 'waiting' && !isRunning
  // The blocked-step affordance only makes sense when the session is idle: while
  // a turn is running (e.g. a chat turn on a session with a stale blocked
  // execution), it must not render a misleading "stopped before finishing".
  const blockedWorkflowStep =
    activeWorkflowExecution?.status === 'blocked' && !!activeWorkflowExecution.currentStepId && !isRunning
  const isWorkflowBlock = blockedWorkflowStep && llmRetry?.status !== 'failed'

  const projectId = useScopedPaneState(
    scopeId,
    (pane) => pane.session?.projectId ?? undefined,
    (state) => state.currentSession?.projectId,
    undefined,
  )
  // Board task linked to this session — when one exists, the post-plan choice
  // point renders the decision bar instead of the plain workflow buttons. The
  // bar only makes sense while the task still awaits a build decision.
  const { data: linkedTask } = useResourceWhen(
    showStartBuilding && !!projectId && !!sessionId,
    taskFromSessionResource,
    projectId ?? '',
    sessionId ?? '',
  )
  const postPlanBarTask =
    linkedTask && (linkedTask.status === 'todo' || linkedTask.status === 'in_progress') ? linkedTask : null

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
                  {t(
                    {
                      en: {
                        one: '{{count}} older item hidden — View full history',
                        other: '{{count}} older items hidden — View full history',
                      },
                      fr: {
                        one: '{{count}} élément plus ancien masqué — Voir l’historique complet',
                        other: '{{count}} éléments plus anciens masqués — Voir l’historique complet',
                      },
                    },
                    { count: hiddenCount },
                  )}
                </button>
                {popupBlocked && (
                  <p className="text-xs text-text-muted text-center">
                    {t({ en: 'Popup blocked.', fr: 'Fenêtre pop-up bloquée.' })}{' '}
                    <a
                      href={projectId && sessionId ? `/p/${projectId}/s/${sessionId}/readonly` : '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-text-primary"
                    >
                      {t({ en: 'Open manually', fr: 'Ouvrir manuellement' })}
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
                  onShowError={() => setShowRetryError(true)}
                />
              </div>
            )}

            {(llmRetry?.status === 'failed' && !isRunning) || blockedWorkflowStep ? (
              <div className="flex flex-col items-center gap-2 feed-item flex-wrap">
                {llmRetry?.status === 'failed' && (
                  <div className="flex items-center gap-1.5 text-xs text-text-secondary max-w-md">
                    <span className="min-w-0 flex-1 truncate text-center">
                      {t({ en: 'The LLM call failed:', fr: 'L’appel LLM a échoué :' })} {llmRetry.error}
                    </span>
                    <ErrorInfoButton onClick={() => setShowRetryError(true)} />
                  </div>
                )}
                {isWorkflowBlock && (
                  <div className="text-xs text-text-secondary max-w-md text-center">
                    {activeWorkflowExecution?.currentStepName
                      ? t(
                          {
                            en: 'The "{{step}}" step stopped before finishing — retry to continue.',
                            fr: 'L’étape « {{step}} » s’est arrêtée avant la fin — réessayez pour continuer.',
                          },
                          { step: activeWorkflowExecution.currentStepName },
                        )
                      : t({
                          en: 'This workflow step stopped before finishing — retry to continue.',
                          fr: 'Cette étape du workflow s’est arrêtée avant la fin — réessayez pour continuer.',
                        })}
                  </div>
                )}
                <button
                  onClick={() => sessionId && retryLLM(sessionId)}
                  disabled={isRunning}
                  className="px-4 py-1.5 text-sm font-medium rounded bg-accent-primary/15 text-accent-primary border border-accent-primary/25 hover:bg-accent-primary/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isRunning
                    ? t({ en: 'Resuming…', fr: 'Reprise…' })
                    : isWorkflowBlock
                      ? t({ en: '↻ Retry step', fr: '↻ Réessayer l’étape' })
                      : t({ en: '↻ Retry', fr: '↻ Réessayer' })}
                </button>
              </div>
            ) : null}

            {llmRetry && (
              <Modal
                isOpen={showRetryError}
                onClose={() => setShowRetryError(false)}
                title={t({ en: 'LLM call failed', fr: 'Échec de l’appel LLM' })}
                size="lg"
              >
                <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-text-primary bg-bg-primary border border-border rounded p-3">
                  {prettyPrintError(llmRetry.error)}
                </pre>
              </Modal>
            )}

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
                        label: `▶ ${t({ en: 'Continue', fr: 'Continuer' })} ${activeWorkflowExecution.workflowName} (${
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
                      ? t({ en: '⏳ Continuing...', fr: '⏳ En cours…' })
                      : choice.id === 'continue'
                        ? `▶ ${t({ en: 'Continue', fr: 'Continuer' })} ${activeWorkflowExecution.workflowName} (${choice.nextStepName ?? activeWorkflowExecution.currentStepName ?? '...'})`
                        : choice.label}
                  </button>
                ))}
              </div>
            )}

            {showStartBuilding && postPlanBarTask && projectId && (
              <PostPlanLaunchBar
                task={postPlanBarTask}
                projectId={projectId}
                workflows={workflows}
                onLaunchWorkflow={onLaunchWorkflow}
                autoLaunch={autoLaunch ? { workflowId: autoLaunch.workflowId, deadline: autoLaunch.deadline } : null}
                onCancelAutoLaunch={() => (sessionId ?? scopeId) && cancelAutoLaunch(sessionId ?? scopeId!)}
              />
            )}

            {showStartBuilding && !postPlanBarTask && (
              <div className="flex justify-center gap-2 feed-item flex-wrap items-start">
                {workflows.map((w) => {
                  const c = w.color ?? '#3b82f6'
                  const bg = hexToRgba(c, 0.12)
                  const bgHover = hexToRgba(c, 0.22)
                  const border = hexToRgba(c, 0.25)
                  const isAutoLaunching =
                    autoLaunch?.workflowId === w.id &&
                    (autoLaunch.scope === 'auto' || autoLaunch.scope === undefined || autoLaunch.scope === w.scope)
                  return (
                    <div key={`${w.id}-${w.scope}`} className="flex flex-col items-center gap-1">
                      <WorkflowButton
                        workflowName={w.name}
                        scope={w.scope}
                        color={c}
                        bg={bg}
                        bgHover={bgHover}
                        border={border}
                        subGroups={w.subGroups}
                        onLaunch={(subGroup?: string) => {
                          if (scopeId) cancelAutoLaunch(sessionId ?? scopeId)
                          onLaunchWorkflow(w.id, subGroup, undefined, w.scope)
                        }}
                      />
                      {isAutoLaunching && autoLaunch && (sessionId ?? scopeId) && (
                        <AutoLaunchCountdown
                          deadline={autoLaunch.deadline}
                          color={c}
                          onCancel={() => cancelAutoLaunch(sessionId ?? scopeId!)}
                        />
                      )}
                    </div>
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
            {t({ en: 'scroll to top', fr: 'remonter en haut' })}
          </button>
        </div>
      )}
    </div>
  )
})
