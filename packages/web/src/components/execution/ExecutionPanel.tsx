import { useSessionStore } from '../../stores/session'
import { SessionLayout } from '../layout/SessionLayout'
import { AgentStream } from './AgentStream'
import { Button } from '../shared/Button'

export function ExecutionPanel() {
  const session = useSessionStore(state => state.currentSession)
  const agentEvents = useSessionStore(state => state.agentEvents)
  
  const startAgent = useSessionStore(state => state.startAgent)
  const startValidation = useSessionStore(state => state.startValidation)
  
  const isExecuting = session?.phase === 'executing'
  const isValidating = session?.phase === 'validating'
  const hasEvents = agentEvents.length > 0
  
  const lastEvent = agentEvents[agentEvents.length - 1]
  const isDone = lastEvent?.type === 'done'
  const isStuck = lastEvent?.type === 'stuck'
  
  const validationStatus = isValidating ? (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="text-sm text-text-secondary mb-2">Validation in progress...</div>
      <div className="h-1 bg-bg-tertiary rounded overflow-hidden">
        <div className="h-full bg-accent-primary animate-pulse" style={{ width: '60%' }} />
      </div>
    </div>
  ) : undefined
  
  return (
    <SessionLayout validationStatus={validationStatus}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h2 className="font-semibold">Agent Execution</h2>
        <div className="flex gap-2">
          {!hasEvents && isExecuting && (
            <Button variant="primary" onClick={startAgent}>
              Start Agent
            </Button>
          )}
          {isDone && isExecuting && (
            <Button variant="primary" onClick={startValidation}>
              Validate Results
            </Button>
          )}
          {isStuck && (
            <Button variant="secondary" onClick={startAgent}>
              Retry
            </Button>
          )}
        </div>
      </div>
      
      <AgentStream events={agentEvents} />
    </SessionLayout>
  )
}
