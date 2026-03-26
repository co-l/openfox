import { memo, useEffect, useRef, useState } from 'react'
import { ansiToReact } from '../../lib/ansiParser'

interface StreamingChunk {
  stream: 'stdout' | 'stderr'
  content: string
}

interface RunCommandViewProps {
  command: string
  timeout: number  // in ms
  startedAt?: number  // timestamp when command started
  streamingOutput?: StreamingChunk[]
  status: 'pending' | 'success' | 'error' | 'interrupted'
  result?: string  // final output (shown after completion)
  error?: string
  durationMs?: number
}

/**
 * Displays a running shell command with streaming output and timeout indicator.
 */
export const RunCommandView = memo(function RunCommandView({
  command,
  timeout,
  startedAt,
  streamingOutput,
  status,
  result,
  error,
  durationMs,
}: RunCommandViewProps) {
  const outputRef = useRef<HTMLPreElement>(null)
  const [elapsed, setElapsed] = useState(0)
  
  // Auto-scroll to bottom when new output arrives
  useEffect(() => {
    if (outputRef.current && status === 'pending') {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [streamingOutput, status])
  
  // Update elapsed time while pending
  useEffect(() => {
    if (status !== 'pending' || !startedAt) return
    
    const interval = setInterval(() => {
      setElapsed(Date.now() - startedAt)
    }, 100)
    
    return () => clearInterval(interval)
  }, [status, startedAt])
  
  // Format timeout display
  const timeoutSec = timeout / 1000
  const elapsedSec = status === 'pending' 
    ? elapsed / 1000 
    : (durationMs ?? 0) / 1000
  
  // Combine streaming chunks into displayable output
  const displayOutput = status === 'pending'
    ? streamingOutput?.map(c => c.content).join('') ?? ''
    : result ?? ''
  
  return (
    <div className="space-y-2">
      {/* Command header with timeout indicator */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs flex-1 min-w-0">
          <span className="text-text-muted flex-shrink-0">$</span>
          <code className="text-text-primary break-all">{command}</code>
        </div>
        
        {/* Timeout indicator - fixed width to prevent layout shifts */}
        <div className="flex items-center gap-2 text-xs text-text-muted flex-shrink-0">
          {status === 'pending' && (
            <span className="animate-pulse text-accent-warning">running</span>
          )}
          {status === 'interrupted' && (
            <span className="text-red-400">interrupted</span>
          )}
          <span className={status === 'pending' ? 'text-text-secondary' : 'text-text-muted'}>
            {elapsedSec.toFixed(1)}s / {timeoutSec}s
          </span>
        </div>
      </div>
      
      {/* Progress bar for pending */}
      {status === 'pending' && (
        <div className="h-1 bg-bg-tertiary rounded overflow-hidden">
          <div 
            className="h-full bg-accent-warning transition-all duration-100"
            style={{ width: `${Math.min(100, (elapsed / timeout) * 100)}%` }}
          />
        </div>
      )}
      
      {/* Output display */}
      {(displayOutput || status === 'pending') && (
        <pre 
          ref={outputRef}
          className={`text-xs bg-bg-primary p-2 rounded overflow-auto max-h-64 ${
            status === 'pending' ? 'border border-accent-warning/30' : ''
          }`}
        >
          {status === 'pending' && streamingOutput ? (
            // Render streaming chunks with ANSI color parsing
            streamingOutput.map((chunk, i) => (
              <span 
                key={i} 
                className={chunk.stream === 'stderr' ? 'text-accent-warning' : ''}
              >
                {ansiToReact(chunk.content)}
              </span>
            ))
          ) : (
            // Render final output with ANSI color parsing
            ansiToReact(displayOutput)
          )}
        </pre>
      )}
      
      {/* Error display */}
      {status === 'error' && error && (
        <div className="text-xs text-accent-error bg-accent-error/10 p-2 rounded">
          {error}
        </div>
      )}
      
      {/* Completion indicator */}
      {status !== 'pending' && durationMs !== undefined && (
        <div className="text-[10px] text-text-muted">
          Completed in {(durationMs / 1000).toFixed(2)}s
        </div>
      )}
    </div>
  )
})
