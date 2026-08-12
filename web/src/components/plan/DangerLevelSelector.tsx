import { useSessionStore } from '../../stores/session'
import { useSessionScope, useScopedPaneState } from '../../stores/session/session-scope'

export function DangerLevelSelector() {
  const sessionId = useSessionScope()
  const dangerLevel = useScopedPaneState(
    sessionId,
    (pane) => pane.session?.dangerLevel ?? 'normal',
    (state) => state.currentSession?.dangerLevel ?? 'normal',
    'normal',
  )
  const switchDangerLevel = useSessionStore((state) => state.switchDangerLevel)

  if (!sessionId) return null

  return (
    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-tertiary/50">
      <button
        type="button"
        onClick={() => switchDangerLevel(sessionId, 'normal')}
        className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
          dangerLevel === 'normal'
            ? 'bg-accent-success/20 text-accent-success'
            : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
        }`}
        title="Normal mode - requires path confirmation"
      >
        Normal
      </button>
      <button
        type="button"
        onClick={() => switchDangerLevel(sessionId, 'dangerous')}
        className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
          dangerLevel === 'dangerous'
            ? 'bg-red-500/20 text-red-400'
            : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
        }`}
        title="Dangerous mode - bypasses all confirmations"
      >
        Dangerous
      </button>
    </div>
  )
}
