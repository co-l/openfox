import { useState } from 'react'
import { useSessionStore } from '../../stores/session'
import { useConfigStore } from '../../stores/config'
import { useSessionStats } from '../../hooks/useSessionStats'
import { Button } from '../shared/Button'
import { StatsModal } from './StatsModal'

/**
 * Format token count with space as thousand separator (e.g., 125000 -> "125 000")
 */
function formatTokens(tokens: number): string {
  return tokens.toLocaleString('en-US').replace(/,/g, ' ')
}

/**
 * Format speed with k suffix
 */
function formatSpeed(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toFixed(1)
}

/**
 * Format seconds to compact time
 */
function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return `${mins}m${secs}s`
}

/**
 * Get color class based on context usage percentage
 */
function getProgressColor(percent: number, dangerZone: boolean): string {
  if (dangerZone) return 'bg-accent-error'
  if (percent > 85) return 'bg-accent-error'
  if (percent > 60) return 'bg-accent-warning'
  return 'bg-accent-success'
}

/**
 * Get text color class based on context usage
 */
function getTextColor(percent: number, dangerZone: boolean): string {
  if (dangerZone) return 'text-accent-error'
  if (percent > 85) return 'text-accent-error'
  if (percent > 60) return 'text-accent-warning'
  return 'text-text-muted'
}

export function SessionHeader() {
  const [showStatsModal, setShowStatsModal] = useState(false)
  
  const contextState = useSessionStore(state => state.contextState)
  const currentSession = useSessionStore(state => state.currentSession)
  const messages = useSessionStore(state => state.messages)
  const compactContext = useSessionStore(state => state.compactContext)
  const model = useConfigStore(state => state.model)
  
  const stats = useSessionStats(messages)
  
  // Don't render if no context state or no session
  if (!contextState || !currentSession) {
    return null
  }
  
  const { currentTokens, maxTokens, compactionCount, dangerZone } = contextState
  const percent = Math.round((currentTokens / maxTokens) * 100)
  const isRunning = currentSession.isRunning
  
  return (
    <>
      <div className="flex-shrink-0 px-4 py-1.5 border-b border-border bg-bg-secondary/50">
        <div className="flex items-center justify-between gap-4">
          {/* Left side: Context info */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-text-muted">Context:</span>
              <span className={getTextColor(percent, dangerZone)}>
                {formatTokens(currentTokens)} / {formatTokens(maxTokens)}
              </span>
              <span className={getTextColor(percent, dangerZone)}>({percent}%)</span>
            </div>
            
            <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden w-20">
              <div
                className={`h-full transition-all duration-300 ${getProgressColor(percent, dangerZone)}`}
                style={{ width: `${Math.min(percent, 100)}%` }}
              />
            </div>
            
            {dangerZone && (
              <span className="text-[10px] text-accent-error font-medium animate-pulse">
                Low!
              </span>
            )}
            
            {compactionCount > 0 && (
              <span className="text-[10px] text-text-muted bg-bg-tertiary px-1 py-0.5 rounded">
                {compactionCount}x
              </span>
            )}
            
            <Button
              variant="secondary"
              size="md"
              onClick={compactContext}
              disabled={isRunning}
              title={isRunning ? 'Cannot compact while running' : 'Compact context'}
              className={dangerZone ? 'border-accent-error text-accent-error hover:bg-accent-error/10' : ''}
            >
              Compact
            </Button>
          </div>
          
          {/* Right side: Stats summary */}
          {stats && (
            <button
              onClick={() => setShowStatsModal(true)}
              className="flex items-center gap-3 px-2 py-0.5 rounded hover:bg-bg-tertiary/50 transition-colors group"
              title="View detailed response and call-level stats"
            >
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <span className="text-text-secondary">{formatTime(stats.aiTime)}</span>
                <span>AI</span>
              </div>
              <div className="w-px h-3 bg-border" />
              <div className="flex items-center gap-1 text-xs text-text-muted">
                <span className="text-text-secondary">{formatSpeed(stats.avgPrefillSpeed)}</span>
                <span>pp</span>
              </div>
              <div className="w-px h-3 bg-border" />
              <div className="flex items-center gap-1 text-xs text-text-muted">
                <span className="text-text-secondary">{formatSpeed(stats.avgGenerationSpeed)}</span>
                <span>tg</span>
              </div>
              <span className="text-text-muted text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                ▼
              </span>
            </button>
          )}
        </div>
      </div>
      
      {/* Stats Modal */}
      {stats && (
        <StatsModal
          isOpen={showStatsModal}
          onClose={() => setShowStatsModal(false)}
          stats={stats}
          model={model ?? undefined}
        />
      )}
    </>
  )
}

// Keep the old export name for backwards compatibility during transition
export { SessionHeader as ContextHeader }
