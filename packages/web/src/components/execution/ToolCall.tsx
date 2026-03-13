import { useState } from 'react'
import type { AgentToolCallEvent, AgentToolResultEvent, AgentToolErrorEvent } from '@openfox/shared/protocol'

interface ToolCallProps {
  call: AgentToolCallEvent
  result?: AgentToolResultEvent
  error?: AgentToolErrorEvent
}

export function ToolCall({ call, result, error }: ToolCallProps) {
  const [expanded, setExpanded] = useState(false)
  
  const isSuccess = result?.result.success
  const isPending = !result && !error
  
  const statusColor = isPending
    ? 'text-accent-warning'
    : isSuccess
    ? 'text-accent-success'
    : 'text-accent-error'
  
  const statusIcon = isPending ? '●' : isSuccess ? '✓' : '✗'
  
  return (
    <div className="border border-border rounded-lg overflow-hidden my-2">
      <button
        className="w-full flex items-center gap-2 p-3 bg-bg-tertiary hover:bg-bg-tertiary/80 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`${statusColor} ${isPending ? 'animate-pulse' : ''}`}>
          {statusIcon}
        </span>
        <span className="font-mono text-accent-primary">{call.tool}</span>
        <span className="text-text-muted text-sm flex-1 truncate">
          {JSON.stringify(call.args).slice(0, 50)}...
        </span>
        <span className="text-text-muted">{expanded ? '▼' : '▶'}</span>
      </button>
      
      {expanded && (
        <div className="p-3 bg-bg-secondary border-t border-border">
          <div className="mb-2">
            <div className="text-xs text-text-muted mb-1">Arguments:</div>
            <pre className="text-sm bg-bg-primary p-2 rounded overflow-x-auto">
              {JSON.stringify(call.args, null, 2)}
            </pre>
          </div>
          
          {result && (
            <div>
              <div className="text-xs text-text-muted mb-1">
                Result ({result.result.durationMs}ms):
              </div>
              <pre className="text-sm bg-bg-primary p-2 rounded overflow-x-auto max-h-48">
                {result.result.output ?? result.result.error ?? 'No output'}
              </pre>
            </div>
          )}
          
          {error && (
            <div>
              <div className="text-xs text-accent-error mb-1">Error:</div>
              <pre className="text-sm bg-bg-primary p-2 rounded text-accent-error">
                {error.error}
              </pre>
              {error.willRetry && (
                <div className="text-xs text-accent-warning mt-1">Will retry...</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
