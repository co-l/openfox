import { useState } from 'react'
import { ToolIcon } from './ToolIcon'
import { formatToolArgs, formatToolArgsFull } from '../../lib/formatToolArgs'

type ToolStatus = 'pending' | 'success' | 'error'

interface ToolCallDisplayProps {
  tool: string
  args: Record<string, unknown>
  status: ToolStatus
  variant?: 'compact' | 'expandable'
  // For expandable variant
  result?: string
  error?: string
  durationMs?: number
}

const statusConfig = {
  pending: {
    icon: '●',
    color: 'text-accent-warning',
    animate: true,
  },
  success: {
    icon: '✓',
    color: 'text-accent-success',
    animate: false,
  },
  error: {
    icon: '✗',
    color: 'text-accent-error',
    animate: false,
  },
}

export function ToolCallDisplay({
  tool,
  args,
  status,
  variant = 'compact',
  result,
  error,
  durationMs,
}: ToolCallDisplayProps) {
  const [expanded, setExpanded] = useState(false)
  const config = statusConfig[status]
  
  // Compact variant - single line, no expansion
  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-2 text-sm bg-bg-tertiary rounded px-3 py-2">
        <ToolIcon tool={tool} />
        <span className="text-accent-primary font-medium">{tool}</span>
        <span className="text-text-muted truncate flex-1">
          {formatToolArgs(tool, args)}
        </span>
        <span className={`${config.color} ${config.animate ? 'animate-pulse' : ''}`}>
          {status === 'pending' ? '...' : 'done'}
        </span>
      </div>
    )
  }
  
  // Expandable variant - clickable with details
  return (
    <div className="border border-border rounded-lg overflow-hidden my-2">
      <button
        className="w-full flex items-center gap-2 p-3 bg-bg-tertiary hover:bg-bg-tertiary/80 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`${config.color} ${config.animate ? 'animate-pulse' : ''}`}>
          {config.icon}
        </span>
        <span className="font-mono text-accent-primary">{tool}</span>
        <span className="text-text-muted text-sm flex-1 truncate">
          {formatToolArgs(tool, args)}
        </span>
        <span className="text-text-muted">{expanded ? '▼' : '▶'}</span>
      </button>
      
      {expanded && (
        <div className="p-3 bg-bg-secondary border-t border-border">
          <div className="mb-2">
            <div className="text-xs text-text-muted mb-1">Arguments:</div>
            <pre className="text-sm bg-bg-primary p-2 rounded overflow-x-auto">
              {formatToolArgsFull(args)}
            </pre>
          </div>
          
          {status === 'success' && result !== undefined && (
            <div>
              <div className="text-xs text-text-muted mb-1">
                Result{durationMs !== undefined && ` (${durationMs}ms)`}:
              </div>
              <pre className="text-sm bg-bg-primary p-2 rounded overflow-x-auto max-h-48">
                {result || 'No output'}
              </pre>
            </div>
          )}
          
          {status === 'error' && error && (
            <div>
              <div className="text-xs text-accent-error mb-1">Error:</div>
              <pre className="text-sm bg-bg-primary p-2 rounded text-accent-error">
                {error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
