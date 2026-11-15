import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../../hooks/useT'
import { useSessionStore } from '../../stores/session'
import { useSessionScope, useScopedPaneState } from '../../stores/session/session-scope'
import { useSessionWorkdir } from '../../hooks/useSessionWorkdir'
import { useResourceWhen } from '../../hooks/useResource'
import { agentsResource, workflowResource } from '../../lib/resources'
import { FlowDiagram } from '../settings/workflows/FlowDiagram'
import { ChevronDownIcon, PinIcon } from '../shared/icons'

/** Delay before the popover opens on hover — long enough to cross the gap. */
const OPEN_DELAY_MS = 250
/** Delay before the popover closes on mouse leave — lets the pointer travel. */
const CLOSE_DELAY_MS = 250

export function WorkflowBar() {
  const t = useT()
  const sessionId = useSessionScope()
  const workdir = useSessionWorkdir()
  const activeWorkflowExecution = useScopedPaneState(
    sessionId,
    (pane) => pane.activeWorkflowExecution ?? null,
    (state) => state.activeWorkflowExecution,
    null,
  )
  const exitWorkflow = useSessionStore((state) => state.exitWorkflow)
  const [exiting, setExiting] = useState(false)

  const [popoverOpen, setPopoverOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Reset exiting state when a new workflow execution appears
  useEffect(() => {
    setExiting(false)
  }, [activeWorkflowExecution?.id])

  const clearTimers = useCallback(() => {
    if (openTimerRef.current !== null) {
      clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  useEffect(() => clearTimers, [clearTimers])

  // The workflow definition is only needed while the popover is open — it is
  // loaded on demand and released as soon as the popover closes. The scope of
  // the running execution is used when known, so a shadowed id resolves to the
  // definition that is really running.
  const workflowScope = activeWorkflowExecution?.workflowScope
  const { data: workflowDefinition, loading: definitionLoading } = useResourceWhen(
    popoverOpen && !!activeWorkflowExecution?.workflowId,
    workflowResource,
    activeWorkflowExecution?.workflowId ?? '',
    workdir,
    workflowScope,
  )

  // Agent display names and colours for the graph, so the running viewer shows
  // the same labels as the settings modal instead of raw agent ids.
  const { data: agentsData } = useResourceWhen(popoverOpen, agentsResource, workdir)
  const agentTypes = useMemo(
    () => (agentsData ? [...agentsData.defaults, ...agentsData.userItems, ...agentsData.projectItems] : []),
    [agentsData],
  )

  const closePopover = useCallback(() => {
    clearTimers()
    setPopoverOpen(false)
    setPinned(false)
  }, [clearTimers])

  const openPopover = useCallback(() => {
    if (openTimerRef.current !== null) clearTimeout(openTimerRef.current)
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setPopoverOpen(true)
  }, [])

  // Clicking the name toggles the graph: hover is only an accelerator, so
  // touch users and anyone who does not discover the hover still reach it.
  const handleAnchorClick = useCallback(() => {
    if (popoverOpen) {
      closePopover()
    } else {
      openPopover()
    }
  }, [popoverOpen, closePopover, openPopover])

  const handleAnchorEnter = useCallback(() => {
    // Clear a pending close: travelling popover → anchor must not close the
    // popover while the pointer is still over the trigger.
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    if (pinned) return
    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null
      setPopoverOpen(true)
    }, OPEN_DELAY_MS)
  }, [pinned])

  const handleAnchorLeave = useCallback(() => {
    if (pinned) return
    if (openTimerRef.current !== null) {
      clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null
      setPopoverOpen(false)
    }, CLOSE_DELAY_MS)
  }, [pinned])

  const handlePopoverEnter = useCallback(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const handlePopoverLeave = useCallback(() => {
    if (pinned) return
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null
      setPopoverOpen(false)
    }, CLOSE_DELAY_MS)
  }, [pinned])

  const togglePinned = useCallback(() => {
    setPinned((prev) => !prev)
  }, [])

  /**
   * Close on blur only when the focus left the anchor AND the popover. The
   * pin button lives inside the popover, so a plain `setPopoverOpen(false)`
   * here would unmount the popover before the button could take the focus.
   */
  const handleAnchorBlur = useCallback(
    (e: React.FocusEvent<HTMLSpanElement>) => {
      if (pinned) return
      const next = e.relatedTarget as Node | null
      if (next && (anchorRef.current?.contains(next) || popoverRef.current?.contains(next))) return
      setPopoverOpen(false)
    },
    [pinned],
  )

  // Escape closes the popover (and unpins it). The event is deliberately NOT
  // stopped: the global Escape shortcut (stop generation, PlanPanel) must
  // keep working while the popover is open.
  useEffect(() => {
    if (!popoverOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePopover()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [popoverOpen, closePopover])

  const handleExit = useCallback(() => {
    if (exiting || !sessionId) return
    setExiting(true)
    exitWorkflow(sessionId)
  }, [exiting, exitWorkflow, sessionId])

  if (!activeWorkflowExecution) return null
  if (activeWorkflowExecution.status !== 'running' && activeWorkflowExecution.status !== 'waiting') return null

  const color =
    activeWorkflowExecution.workflowColor && /^#[0-9a-fA-F]{6}$/.test(activeWorkflowExecution.workflowColor)
      ? activeWorkflowExecution.workflowColor
      : '#3b82f6'

  const iterations = activeWorkflowExecution.iterations
  const maxIterations = activeWorkflowExecution.maxIterations
  const totalIterations = activeWorkflowExecution.totalIterations
  const stepIterations = activeWorkflowExecution.stepIterations

  const isOpen = popoverOpen

  // The bar shows the engine's own numbers: the per-invocation counter and the
  // cap it is compared against, plus the cumulative total whenever a resume
  // made them differ. Without that, a resumed run would look like it restarted
  // its budget at iteration 1.
  const iterationLabel = (() => {
    if (iterations === undefined) return null
    const local =
      maxIterations !== undefined
        ? t({ en: `iteration ${iterations}/${maxIterations}`, fr: `itération ${iterations}/${maxIterations}` })
        : iterations === 1
          ? t({ en: '1 iteration', fr: '1 itération' })
          : t({ en: `${iterations} iterations`, fr: `${iterations} itérations` })
    if (totalIterations === undefined || totalIterations <= iterations) return local
    return t({ en: `${local} · ${totalIterations} total`, fr: `${local} · ${totalIterations} au total` })
  })()

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-border relative">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="relative min-w-0">
        <span
          ref={anchorRef}
          className="inline-flex max-w-[14rem] items-center gap-1 font-medium text-text-primary cursor-pointer"
          onMouseEnter={handleAnchorEnter}
          onMouseLeave={handleAnchorLeave}
          onClick={handleAnchorClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              handleAnchorClick()
            }
          }}
          onFocus={() => openPopover()}
          onBlur={handleAnchorBlur}
          tabIndex={0}
          role="button"
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          aria-label={t({
            en: `Show the ${activeWorkflowExecution.workflowName} workflow graph`,
            fr: `Afficher le graphe du workflow ${activeWorkflowExecution.workflowName}`,
          })}
        >
          <span className="truncate">{activeWorkflowExecution.workflowName}</span>
          <ChevronDownIcon className="w-3 h-3 shrink-0 text-text-muted" rotate={isOpen ? 180 : 0} />
        </span>

        {isOpen && (
          <div
            ref={popoverRef}
            role="dialog"
            aria-label={t({
              en: 'Workflow graph',
              fr: 'Graphe du workflow',
            })}
            data-testid="workflow-popover"
            // Opens upward: WorkflowBar sits at the bottom of the chat column,
            // whose ancestors clip overflow — a downward popover would be
            // cut off below the viewport.
            className="absolute left-0 bottom-full mb-1 z-50 w-[420px] max-w-[90vw] bg-bg-secondary border border-border rounded-lg shadow-xl p-2"
            onMouseEnter={handlePopoverEnter}
            onMouseLeave={handlePopoverLeave}
          >
            <div className="flex items-center justify-between gap-2 px-1 pb-1.5">
              <span className="font-medium text-text-primary truncate">{activeWorkflowExecution.workflowName}</span>
              <button
                onClick={togglePinned}
                aria-pressed={pinned}
                aria-label={
                  pinned
                    ? t({ en: 'Unpin the workflow graph', fr: 'Désépingler le graphe du workflow' })
                    : t({ en: 'Pin the workflow graph', fr: 'Épingler le graphe du workflow' })
                }
                title={pinned ? t({ en: 'Unpin', fr: 'Désépingler' }) : t({ en: 'Pin', fr: 'Épingler' })}
                className={`p-1 rounded transition-colors ${
                  pinned ? 'text-accent-warning' : 'text-text-muted hover:text-text-primary'
                }`}
              >
                <PinIcon className="w-3.5 h-3.5" />
              </button>
            </div>

            {workflowDefinition ? (
              <div className="max-h-[320px] overflow-auto" data-testid="workflow-popover-graph">
                <FlowDiagram
                  steps={workflowDefinition.steps}
                  entryStep={workflowDefinition.entryStep}
                  selectedNodeId={null}
                  selectedEdgeKey={null}
                  startConditionLabel=""
                  agentTypes={agentTypes}
                  isReadOnly={true}
                  onSelectNode={() => {}}
                  onSelectEdge={() => {}}
                  onRemoveStep={() => {}}
                  onCreateTransition={() => {}}
                  onReconnectTo={() => {}}
                  onReconnectFrom={() => {}}
                  onDeleteTransition={() => {}}
                  runtime={{
                    currentStepId: activeWorkflowExecution.currentStepId ?? null,
                    ...(stepIterations ? { stepIterationCounts: stepIterations } : {}),
                  }}
                />
              </div>
            ) : definitionLoading ? (
              <div className="px-1 py-2 text-text-muted" data-testid="workflow-popover-loading">
                {t({ en: 'Loading the workflow graph…', fr: 'Chargement du graphe du workflow…' })}
              </div>
            ) : (
              <div className="px-1 py-2 text-text-muted" data-testid="workflow-popover-unavailable">
                {t({
                  en: 'The workflow graph is unavailable — the definition could not be loaded.',
                  fr: 'Le graphe du workflow est indisponible — la définition n’a pas pu être chargée.',
                })}
              </div>
            )}

            {totalIterations !== undefined && totalIterations > (iterations ?? 0) && (
              <div className="px-1 pt-1.5 text-text-muted" data-testid="workflow-total-iterations">
                {t({
                  en: `${totalIterations} iterations in total`,
                  fr: `${totalIterations} itérations au total`,
                })}
              </div>
            )}
          </div>
        )}
      </span>
      {activeWorkflowExecution.currentStepName && (
        <>
          <span className="text-text-muted">·</span>
          <span className="text-text-muted truncate">{activeWorkflowExecution.currentStepName}</span>
        </>
      )}
      {iterationLabel !== null && (
        <span className="text-text-muted shrink-0" data-testid="workflow-iterations">
          {iterationLabel}
        </span>
      )}
      <div className="ml-auto shrink-0 flex items-center gap-1">
        <button
          onClick={handleExit}
          disabled={exiting}
          className="text-xs px-2 py-0.5 rounded text-text-tool-error hover:bg-text-tool-error/10 transition-colors disabled:opacity-50"
        >
          {exiting ? t({ en: 'Exiting...', fr: 'Sortie…' }) : t({ en: '✕ Exit', fr: '✕ Quitter' })}
        </button>
      </div>
    </div>
  )
}
