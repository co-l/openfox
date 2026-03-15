import { useSessionStore } from '../../stores/session'
import { Button } from '../shared/Button'

/**
 * Format token count with space as thousand separator (e.g., 125000 -> "125 000")
 */
function formatTokens(tokens: number): string {
  return tokens.toLocaleString('en-US').replace(/,/g, ' ')
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

export function ContextHeader() {
  const contextState = useSessionStore(state => state.contextState)
  const currentSession = useSessionStore(state => state.currentSession)
  const compactContext = useSessionStore(state => state.compactContext)
  
  // Don't render if no context state or no session
  if (!contextState || !currentSession) {
    return null
  }
  
  const { currentTokens, maxTokens, compactionCount, dangerZone } = contextState
  const percent = Math.round((currentTokens / maxTokens) * 100)
  const isRunning = currentSession.isRunning
  
  return (
    <div className="flex-shrink-0 px-2 py-1.5 border-b border-border bg-bg-secondary/50">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-text-muted">Ctx:</span>
          <span className={getTextColor(percent, dangerZone)}>
            {formatTokens(currentTokens)} / {formatTokens(maxTokens)}
          </span>
          <span className={getTextColor(percent, dangerZone)}>({percent}%)</span>
        </div>
        
        <div className="flex-1 h-1.5 bg-bg-tertiary rounded-full overflow-hidden max-w-24">
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
          size="sm"
          onClick={compactContext}
          disabled={isRunning}
          title={isRunning ? 'Cannot compact while running' : 'Compact context'}
          className={dangerZone ? 'border-accent-error text-accent-error hover:bg-accent-error/10' : ''}
        >
          Compact
        </Button>
      </div>
    </div>
  )
}
