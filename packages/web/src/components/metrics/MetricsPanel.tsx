import { useMetricsStore } from '../../stores/metrics'
import { useSessionStore } from '../../stores/session'
import { useConfigStore } from '../../stores/config'

export function MetricsPanel() {
  const derived = useMetricsStore(state => state.derived)
  const session = useSessionStore(state => state.currentSession)
  const { model, maxContext } = useConfigStore()
  
  const contextUsed = session?.executionState?.currentTokenCount ?? 0
  const contextMax = maxContext
  const contextPercent = Math.round((contextUsed / contextMax) * 100)
  
  return (
    <div className="p-4 space-y-4">
      <h3 className="font-semibold text-text-secondary text-sm">Metrics</h3>
      
      {/* Model info */}
      {model && (
        <div className="pb-3 border-b border-border">
          <div className="text-xs text-text-muted mb-1">Model</div>
          <div className="text-sm text-text-primary truncate" title={model}>
            {model.split('/').pop()}
          </div>
        </div>
      )}
      
      {/* Speed metrics */}
      <div className="space-y-3">
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-text-muted">Prefill</span>
            <span className="text-text-primary">
              {derived?.prefillSpeed ? `${derived.prefillSpeed} t/s` : '--'}
            </span>
          </div>
        </div>
        
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-text-muted">Generation</span>
            <span className="text-text-primary">
              {derived?.generationSpeed ? `${derived.generationSpeed} t/s` : '--'}
            </span>
          </div>
        </div>
      </div>
      
      {/* Context usage */}
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span className="text-text-muted">Context</span>
          <span className="text-text-primary">
            {contextUsed.toLocaleString()} / {contextMax.toLocaleString()}
          </span>
        </div>
        <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${
              contextPercent > 85 ? 'bg-accent-error' :
              contextPercent > 60 ? 'bg-accent-warning' :
              'bg-accent-success'
            }`}
            style={{ width: `${contextPercent}%` }}
          />
        </div>
        <div className="text-xs text-text-muted mt-1">{contextPercent}% used</div>
      </div>
      
      {/* Cache health */}
      <div>
        <div className="flex justify-between text-sm">
          <span className="text-text-muted">Cache</span>
          <span className={
            derived?.cacheHealth === 'good' ? 'text-accent-success' :
            derived?.cacheHealth === 'pressure' ? 'text-accent-warning' :
            derived?.cacheHealth === 'critical' ? 'text-accent-error' :
            'text-text-muted'
          }>
            {derived?.cacheHealth ?? '--'}
          </span>
        </div>
      </div>
      
      {/* Session stats */}
      {session && (
        <div className="pt-4 border-t border-border space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Tokens used</span>
            <span className="text-text-primary">
              {session.metadata.totalTokensUsed.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Tool calls</span>
            <span className="text-text-primary">
              {session.metadata.totalToolCalls}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Iterations</span>
            <span className="text-text-primary">
              {session.metadata.iterationCount}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
