import type { SessionMode } from '@openfox/shared'
import { useSessionStore } from '../../stores/session'

const modes: { mode: SessionMode; label: string; activeClass: string }[] = [
  { mode: 'planner', label: 'Planner', activeClass: 'bg-purple-500 text-white' },
  { mode: 'builder', label: 'Builder', activeClass: 'bg-blue-500 text-white' },
  { mode: 'verifier', label: 'Verifier', activeClass: 'bg-green-500 text-white' },
]

export function ModeSwitch() {
  const currentMode = useSessionStore(state => state.currentSession?.mode)
  const switchMode = useSessionStore(state => state.switchMode)
  const isStreaming = useSessionStore(state => state.isStreaming)

  if (!currentMode) return null

  return (
    <div className="inline-flex rounded-lg overflow-hidden border border-border bg-bg-secondary">
      {modes.map(({ mode, label, activeClass }) => {
        const isActive = currentMode === mode
        return (
          <button
            key={mode}
            onClick={() => !isActive && switchMode(mode)}
            disabled={isStreaming}
            className={`
              px-4 py-1.5 text-sm font-medium transition-colors
              ${isActive 
                ? activeClass 
                : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary cursor-pointer'
              }
              ${!isActive && 'border-l border-border first:border-l-0'}
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
