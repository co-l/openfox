import { useState } from 'react'
import { useSessionStore } from '../../stores/session'
import { MoreIcon } from '../shared/icons'
import { ProgressBar, LowTokenWarning } from '../shared/ProgressBar'
import { formatTokens } from '../../lib/format-stats'

function getTextColor(percent: number, dangerZone: boolean): string {
  if (dangerZone) return 'text-accent-error'
  if (percent > 85) return 'text-accent-error'
  if (percent > 60) return 'text-accent-warning'
  return 'text-text-muted'
}

export function SessionHeader() {
  const contextState = useSessionStore((state) => state.contextState)
  const currentSession = useSessionStore((state) => state.currentSession)
  const compactContext = useSessionStore((state) => state.compactContext)

  const [menuOpen, setMenuOpen] = useState(false)

  if (!contextState || !currentSession) {
    return null
  }

  const { currentTokens, maxTokens, compactionCount, dangerZone } = contextState
  const percent = Math.round((currentTokens / maxTokens) * 100)
  const isRunning = currentSession.isRunning

  return (
    <div className="flex-shrink-0 px-4 py-1.5 border-b border-border bg-secondary">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1" />

        <div className="flex items-center gap-2">
          <span className={getTextColor(percent, dangerZone)}>
            {formatTokens(currentTokens)} / {formatTokens(maxTokens)}
          </span>
          <span className={getTextColor(percent, dangerZone)}>({percent}%)</span>

          <ProgressBar percent={percent} dangerZone={dangerZone} />
          <LowTokenWarning dangerZone={dangerZone} />

          {compactionCount > 0 && (
            <span className="text-[10px] text-text-muted bg-bg-tertiary px-1 py-0.5 rounded">{compactionCount}x</span>
          )}
        </div>

        <div className="flex-1 flex justify-end">
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
              title="More options"
            >
              <MoreIcon />
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1.5 z-50 bg-bg-secondary border border-border rounded-lg shadow-xl py-1 min-w-[160px]">
                  <button
                    onClick={() => {
                      if (!isRunning) compactContext()
                      setMenuOpen(false)
                    }}
                    disabled={isRunning}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-bg-tertiary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title={isRunning ? 'Cannot compact while running' : 'Compact context'}
                  >
                    <span className={dangerZone ? 'text-accent-error' : ''}>Compact</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export { SessionHeader as ContextHeader }
