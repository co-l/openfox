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
    <header className="h-8 bg-bg-secondary border-b border-border flex items-center justify-between px-2">
      <div className="flex items-center gap-2">
        <Link href="/" className="text-accent-primary font-semibold text-base hover:underline">
          OpenFox
        </Link>
        {project && (
          <>
            <span className="text-text-muted">/</span>
            <Link 
              href={`/p/${project.id}`}
              className="text-text-secondary hover:text-text-primary hover:underline text-sm"
            >
              {project.name}
            </Link>
          </>
        )}
        {session && (
          <>
            <span className="text-text-muted">/</span>
            <span className="text-text-secondary text-sm">
              {session.metadata.title ?? session.id.slice(0, 8)}
            </span>
          </>
        )}
      </div>
      
      <div className="flex items-center gap-3">
        <button
          onClick={() => refreshModel()}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-bg-tertiary transition-colors group"
          title={model ?? 'Click to refresh model'}
        >
          <span className="text-[10px] text-text-muted">Model:</span>
          <span className="text-xs text-accent-primary truncate max-w-32">
            {shortModelName}
          </span>
          <span className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
            ↻
          </span>
        </button>
        
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${
            connectionStatus === 'connected' ? 'bg-accent-success' :
            connectionStatus === 'reconnecting' ? 'bg-accent-warning animate-pulse' :
            'bg-accent-error'
          }`} />
          <span className="text-xs text-text-secondary">
            {connectionStatus === 'connected' ? 'Connected' :
             connectionStatus === 'reconnecting' ? 'Reconnecting...' :
             'Disconnected'}
          </span>
        </div>
      </div>
    </header>
  )
}
