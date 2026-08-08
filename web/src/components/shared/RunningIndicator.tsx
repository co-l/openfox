import { useSessionStore } from '../../stores/session'
import { projectFromSessionStore, statusLabel, type SessionStatusState } from '../../lib/session-status'

/**
 * Session status indicator shown at the bottom of the chat.
 * Reuses the existing position. Displays the factually-derived state
 * (running / waiting / completed / blocked) when one is present in the
 * existing client-side session data, otherwise renders nothing.
 *
 * The component is strictly read-only: no click handler, no actions, no
 * new sync mechanism. All inputs come from useSessionStore, which is
 * already populated by the existing session-load flow.
 */
export function RunningIndicator() {
  const aborting = useSessionStore((state) => state.abortInProgress)
  const currentSession = useSessionStore((state) => state.currentSession)
  const pendingQuestions = useSessionStore((state) => state.pendingQuestions)
  const pendingPathConfirmations = useSessionStore((state) => state.pendingPathConfirmations)
  const activeWorkflowExecution = useSessionStore((state) => state.activeWorkflowExecution)

  const view = projectFromSessionStore({
    currentSession,
    pendingQuestions,
    pendingPathConfirmations,
    activeWorkflowExecution,
  })

  const state: SessionStatusState = view.state

  if (state === null) return null

  const label = statusLabel(state, currentSession?.phase ?? 'plan')
  const dotColor = aborting ? 'bg-amber-400' : 'bg-accent-primary'
  const showBounce = state === 'running'
  const lastActivityAtText = view.lastActivityAt ? formatLastActivity(view.lastActivityAt) : ''

  return (
    <div
      className="flex items-center gap-3 text-xs text-text-muted py-2"
      data-testid="session-status-indicator"
      data-state={state}
    >
      <div className="flex items-center gap-1.5">
        {showBounce && (
          <span className="flex gap-0.5">
            <span
              className={`w-1 h-1 rounded-full ${aborting ? '' : 'animate-bounce'} ${dotColor}`}
              style={{ animationDelay: '0ms' }}
            />
            <span
              className={`w-1 h-1 rounded-full ${aborting ? '' : 'animate-bounce'} ${dotColor}`}
              style={{ animationDelay: '150ms' }}
            />
            <span
              className={`w-1 h-1 rounded-full ${aborting ? '' : 'animate-bounce'} ${dotColor}`}
              style={{ animationDelay: '300ms' }}
            />
          </span>
        )}
        <span className="text-text-secondary">
          {aborting && state === 'running' ? `${label} (abort in progress)` : label}
        </span>
      </div>
      {!aborting && state === 'running' && <span className="text-text-muted hidden sm:inline">esc to interrupt</span>}
      {lastActivityAtText && (
        <span className="text-text-muted hidden sm:inline" aria-label="last activity">
          {lastActivityAtText}
        </span>
      )}
    </div>
  )
}

function formatLastActivity(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
