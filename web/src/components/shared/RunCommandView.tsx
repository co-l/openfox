import { ScrollArea } from './ScrollArea'
import type { OverlayScrollbarsComponentRef } from 'overlayscrollbars-react'
import { useAutoScroll } from '../../hooks/useAutoScroll'
import { useViewport } from '../../hooks/useViewport'
import { memo, useEffect, useRef, useState } from 'react'
import { ansiToReact } from '../../lib/ansiParser'
import { useT } from '../../hooks/useT'

interface StreamingChunk {
  stream: 'stdout' | 'stderr'
  content: string
}

interface RunCommandViewProps {
  command: string
  timeout: number // in ms
  startedAt?: number // timestamp when command started
  streamingOutput?: StreamingChunk[]
  status: 'pending' | 'success' | 'error' | 'interrupted'
  result?: string // final output (shown after completion)
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
  const t = useT()
  const scrollRef = useRef<OverlayScrollbarsComponentRef<'div'>>(null)
  const [elapsed, setElapsed] = useState(0)

  const getViewport = useViewport(scrollRef)
  const { setAutoScroll, force_scroll_to_bottom, handleScrollbarGesture } = useAutoScroll(scrollRef, null, getViewport)

  // Follow streaming output while the command is running. Completed output —
  // whether reached via a live stream or mounted directly — settles at the tail,
  // then following stops so the user can scroll freely.
  useEffect(() => {
    if (status === 'pending') {
      setAutoScroll(true)
    } else {
      force_scroll_to_bottom()
      setAutoScroll(false)
    }
  }, [status, setAutoScroll, force_scroll_to_bottom])

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
  const elapsedSec = status === 'pending' ? elapsed / 1000 : (durationMs ?? 0) / 1000

  // Combine streaming chunks into displayable output
  const displayOutput = status === 'pending' ? (streamingOutput?.map((c) => c.content).join('') ?? '') : (result ?? '')

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
            <span className="animate-pulse text-accent-warning">{t({ en: 'running', fr: 'en cours' })}</span>
          )}
          {status === 'interrupted' && (
            <span className="text-red-400">{t({ en: 'interrupted', fr: 'interrompu' })}</span>
          )}
          <span className={status === 'pending' ? 'text-text-secondary' : 'text-text-muted'}>
            {`${elapsedSec.toFixed(1)}s / ${timeoutSec}s`}
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
        <ScrollArea
          ref={scrollRef}
          onScrollbarGesture={handleScrollbarGesture}
          className={`text-xs bg-bg-primary p-2 rounded max-h-64 ${
            status === 'pending' ? 'border border-accent-warning/30' : ''
          }`}
          style={{ overflowX: 'hidden', whiteSpace: 'normal' }}
        >
          {status === 'pending' && streamingOutput
            ? // Render streaming chunks with ANSI color parsing
              streamingOutput.map((chunk, i) => (
                <span key={i} className={chunk.stream === 'stderr' ? 'text-accent-warning' : ''}>
                  {ansiToReact(chunk.content)}
                </span>
              ))
            : // Render final output with ANSI color parsing
              ansiToReact(displayOutput)}
        </ScrollArea>
      )}

      {/* Error display */}
      {status === 'error' && error && (
        <div className="text-xs text-accent-error bg-accent-error/10 p-2 rounded">{error}</div>
      )}
    </div>
  )
})
