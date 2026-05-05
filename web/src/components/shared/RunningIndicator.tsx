import { useAbortInProgress } from '../../stores/session'

/**
 * Running indicator shown at bottom of chat when agent is active.
 * Displays a subtle animation and "esc to interrupt" hint.
 */
export function RunningIndicator() {
  const aborting = useAbortInProgress()
  const dotColor = aborting ? 'bg-amber-400' : 'bg-accent-primary'

  return (
    <div className="flex items-center gap-3 text-xs text-text-muted py-2">
      <div className="flex items-center gap-1.5">
        <span className="flex gap-0.5">
          <span className={`w-1 h-1 rounded-full animate-bounce ${dotColor}`} style={{ animationDelay: '0ms' }} />
          <span className={`w-1 h-1 rounded-full animate-bounce ${dotColor}`} style={{ animationDelay: '150ms' }} />
          <span className={`w-1 h-1 rounded-full animate-bounce ${dotColor}`} style={{ animationDelay: '300ms' }} />
        </span>
        <span className="text-text-secondary">{aborting ? 'Running... (abort in progress)' : 'Running'}</span>
      </div>
      {!aborting && <span className="text-text-muted">esc to interrupt</span>}
    </div>
  )
}
