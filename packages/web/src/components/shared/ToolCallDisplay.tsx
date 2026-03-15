import { useState } from 'react'
import type { Diagnostic } from '@openfox/shared'
import { ToolIcon } from './ToolIcon'
import { DiffView, FilePreview } from './DiffView'
import { DiagnosticsView } from './DiagnosticsView'
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
  diagnostics?: Diagnostic[]  // LSP diagnostics for file operations
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
  diagnostics,
}: ToolCallDisplayProps) {
  // Auto-expand file operations so diffs are immediately visible
  const isFileOperation = tool === 'edit_file' || tool === 'write_file'
  const [expanded, setExpanded] = useState(isFileOperation)
  const config = statusConfig[status]
  
  // Compact variant - single line, no expansion
  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-1.5 text-xs bg-bg-tertiary rounded px-2 py-1.5">
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
  
  return (
    <div className="border border-border rounded overflow-hidden my-1">
      <button
        className="w-full flex items-center gap-1.5 p-2 bg-bg-tertiary hover:bg-bg-tertiary/80 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`${config.color} ${config.animate ? 'animate-pulse' : ''}`}>
          {config.icon}
        </span>
        <span className="font-mono text-accent-primary text-sm">{tool}</span>
        <span className="text-text-muted text-xs flex-1 truncate">
          {formatToolArgs(tool, args)}
        </span>
        <span className="text-text-muted text-xs">{expanded ? '▼' : '▶'}</span>
      </button>
      
      {expanded && (
        <div className="p-2 bg-bg-secondary border-t border-border space-y-2">
          {/* Specialized rendering for file edit operations */}
          {tool === 'edit_file' && status === 'success' && (
            <>
              <DiffView
                oldString={String(args.old_string ?? '')}
                newString={String(args.new_string ?? '')}
                filePath={String(args.path ?? '')}
              />
              {diagnostics && diagnostics.length > 0 && (
                <DiagnosticsView diagnostics={diagnostics} />
              )}
            </>
          )}
          
          {/* Specialized rendering for file write operations */}
          {tool === 'write_file' && status === 'success' && (
            <>
              <FilePreview
                content={String(args.content ?? '')}
                filePath={String(args.path ?? '')}
              />
              {diagnostics && diagnostics.length > 0 && (
                <DiagnosticsView diagnostics={diagnostics} />
              )}
            </>
          )}
          
          {/* Show arguments for non-file operations or errors */}
          {(tool !== 'edit_file' && tool !== 'write_file') || status !== 'success' ? (
            <div>
              <div className="text-[10px] text-text-muted mb-0.5">Arguments:</div>
              <pre className="text-xs bg-bg-primary p-1.5 rounded overflow-x-auto">
                {formatToolArgsFull(args)}
              </pre>
            </div>
          ) : null}
          
          {/* Show result for non-file operations */}
          {status === 'success' && result !== undefined && tool !== 'edit_file' && tool !== 'write_file' && (
            <div>
              <div className="text-[10px] text-text-muted mb-0.5">
                Result{durationMs !== undefined && ` (${durationMs}ms)`}:
              </div>
              <pre className="text-xs bg-bg-primary p-1.5 rounded overflow-x-auto max-h-32">
                {result || 'No output'}
              </pre>
            </div>
          )}
          
          {/* Duration badge for file operations */}
          {status === 'success' && (tool === 'edit_file' || tool === 'write_file') && durationMs !== undefined && (
            <div className="text-[10px] text-text-muted">
              Completed in {durationMs}ms
            </div>
          )}
          
          {status === 'error' && error && (
            <div>
              <div className="text-[10px] text-accent-error mb-0.5">Error:</div>
              <pre className="text-xs bg-bg-primary p-1.5 rounded text-accent-error">
                {error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
