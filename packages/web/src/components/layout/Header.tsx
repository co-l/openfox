import { Link } from 'wouter'
import { useSessionStore } from '../../stores/session'
import { useProjectStore } from '../../stores/project'
import { useConfigStore } from '../../stores/config'

export function Header() {
  const connectionStatus = useSessionStore(state => state.connectionStatus)
  const session = useSessionStore(state => state.currentSession)
  const project = useProjectStore(state => state.currentProject)
  const model = useConfigStore(state => state.model)
  const refreshModel = useConfigStore(state => state.refreshModel)
  
  // Extract short model name for display
  const shortModelName = model
    ? model.split('/').pop()?.replace(/-/g, ' ') ?? model
    : 'detecting...'
  
  return (
    <header className="h-12 bg-bg-secondary border-b border-border flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-accent-primary font-semibold text-lg hover:underline">
          OpenFox
        </Link>
        {project && (
          <>
            <span className="text-text-muted">/</span>
            <Link 
              href={`/p/${project.id}`}
              className="text-text-secondary hover:text-text-primary hover:underline"
            >
              {project.name}
            </Link>
          </>
        )}
        {session && (
          <>
            <span className="text-text-muted">/</span>
            <span className="text-text-secondary">
              {session.metadata.title ?? session.id.slice(0, 8)}
            </span>
          </>
        )}
      </div>
      
      <div className="flex items-center gap-4">
        {/* Model indicator */}
        <button
          onClick={() => refreshModel()}
          className="flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-tertiary transition-colors group"
          title={model ?? 'Click to refresh model'}
        >
          <span className="text-xs text-text-muted">Model:</span>
          <span className="text-sm text-accent-primary truncate max-w-48">
            {shortModelName}
          </span>
          <span className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
            ↻
          </span>
        </button>
        
        {/* Connection status */}
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            connectionStatus === 'connected' ? 'bg-accent-success' :
            connectionStatus === 'reconnecting' ? 'bg-accent-warning animate-pulse' :
            'bg-accent-error'
          }`} />
          <span className="text-sm text-text-secondary">
            {connectionStatus === 'connected' ? 'Connected' :
             connectionStatus === 'reconnecting' ? 'Reconnecting...' :
             'Disconnected'}
          </span>
        </div>
      </div>
    </header>
  )
}
