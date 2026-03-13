import { useSessionStore } from '../../stores/session'
import { AgentStream } from './AgentStream'
import { CriteriaEditor } from '../plan/CriteriaEditor'
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
  
  return (
    <div className="flex h-full">
      {/* Agent Output */}
      <div className="flex-1 flex flex-col">
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
      </div>
      
      {/* Criteria Progress */}
      <div className="w-80 border-l border-border p-4">
        <CriteriaEditor
          criteria={session?.criteria ?? []}
          editable={false}
          onUpdate={() => {}}
          onAccept={() => {}}
        />
        
        {isValidating && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="text-sm text-text-secondary mb-2">Validation in progress...</div>
            <div className="h-1 bg-bg-tertiary rounded overflow-hidden">
              <div className="h-full bg-accent-primary animate-pulse" style={{ width: '60%' }} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
