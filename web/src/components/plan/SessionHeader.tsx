import { useSessionStore } from '../../stores/session'
import { Button } from '../shared/Button'
import { formatTokens } from '../../lib/format-stats'

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

interface SessionHeaderProps {
  criteriaSidebarOpen?: boolean
  onCriteriaSidebarToggle?: () => void
  alwaysShowToggle?: boolean
}

export function SessionHeader({ criteriaSidebarOpen = true, onCriteriaSidebarToggle }: SessionHeaderProps) {
  const contextState = useSessionStore(state => state.contextState)
  const currentSession = useSessionStore(state => state.currentSession)
  const compactContext = useSessionStore(state => state.compactContext)
  
  // Don't render if no context state or no session
  if (!contextState || !currentSession) {
    return null
  }
  
  console.log('[SessionHeader] Rendering with contextState:', contextState)
  const { currentTokens, maxTokens, compactionCount, dangerZone } = contextState
  const percent = Math.round((currentTokens / maxTokens) * 100)
  const isRunning = currentSession.isRunning
  
  return (
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
        
        {/* Criteria sidebar toggle button - always visible on desktop, toggles sidebar */}
        {onCriteriaSidebarToggle && (
          <button
            onClick={onCriteriaSidebarToggle}
            className="flex md:hidden items-center justify-center p-1.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title={criteriaSidebarOpen ? 'Hide criteria sidebar' : 'Show criteria sidebar'}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

// Keep the old export name for backwards compatibility during transition
export { SessionHeader as ContextHeader }
