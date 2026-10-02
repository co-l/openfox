import { ScrollArea } from './ScrollArea'
import type { OverlayScrollbarsComponentRef } from 'overlayscrollbars-react'
import { useAutoScroll } from '../../hooks/useAutoScroll'
import { useViewport } from '../../hooks/useViewport'
import { memo, useEffect, useRef, useState } from 'react'
import { ansiToReact } from '../../lib/ansiParser'
import { useT } from '../../hooks/useT'
import { wsClient } from '../../lib/ws'
import { FAST_FORWARD_STEP_MS } from '@shared/constants.js'

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
  callId?: string // tool call id (for command.fastForward)
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
  callId,
}: RunCommandViewProps) {
  const t = useT()
  const scrollRef = useRef<OverlayScrollbarsComponentRef<'div'>>(null)
  const [elapsed, setElapsed] = useState(0)
  const [skipFeedback, setSkipFeedback] = useState(false)
  // Fast-forward offset (ms) added to the real elapsed time. Each click adds
  // one fixed step; the total (timeout) is never extended. When the displayed
  // elapsed reaches the total, the command is terminated on the server.
  const [elapsedOffset, setElapsedOffset] = useState(0)
  // Set when the server answers that no active command matches the callId —
  // further clicks would only grow the offset without any effect.
  const [ffBlocked, setFfBlocked] = useState(false)
  const elapsedRef = useRef(0)
  const ffSentIdRef = useRef<string | null>(null)
  const ffBlockedRef = useRef(false)

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
      const now = Date.now() - startedAt
      elapsedRef.current = now
      setElapsed(now)
    }, 100)

    return () => clearInterval(interval)
  }, [status, startedAt])

  // Fast-forward delivery: when the displayed elapsed has reached the total,
  // ensure the `command.fastForward` WS message is sent — retrying while the
  // socket is down (e.g. right after a server restart) and giving up with a
  // warning when the server reports no active command for this call id.
  useEffect(() => {
    if (status !== 'pending') return

    const interval = setInterval(() => {
      if (ffBlockedRef.current) return
      if (ffSentIdRef.current && !wsClient.isConnected) ffSentIdRef.current = null
      if (ffSentIdRef.current) return
      if (elapsedRef.current + elapsedOffset < timeout) return
      try {
        ffSentIdRef.current = wsClient.send('command.fastForward', { toolCallId: callId })
      } catch {
        ffSentIdRef.current = null
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [status, elapsedOffset, timeout, callId])

  // Track the fast-forward ack: success means the command is being
  // terminated; an error means no active command matched (stop the offset
  // from growing past the total without any effect).
  useEffect(() => {
    const unsubscribe = wsClient.subscribe((message) => {
      const sentId = ffSentIdRef.current
      if (!sentId || message.id !== sentId) return
      ffSentIdRef.current = null
      if (message.type === 'error') {
        ffBlockedRef.current = true
        setFfBlocked(true)
      }
    })
    return unsubscribe
  }, [])

  // Format timeout display. The total is the fixed timeout; the displayed
  // elapsed is the real elapsed plus the fast-forward offset.
  const totalMs = timeout
  const totalSec = totalMs / 1000
  const displayElapsedMs = status === 'pending' ? elapsed + elapsedOffset : (durationMs ?? 0)
  const elapsedSec = displayElapsedMs / 1000

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
          {status === 'pending' && (
            <button
              onClick={() => {
                if (!ffBlocked) {
                  const newOffset = elapsedOffset + FAST_FORWARD_STEP_MS
                  setElapsedOffset(newOffset)
                  // Once the fast-forwarded elapsed reaches the total, request
                  // termination on the server (retried by the delivery effect
                  // until the socket is up and the ack arrives).
                  if (elapsed + newOffset >= timeout && !ffSentIdRef.current) {
                    try {
                      ffSentIdRef.current = wsClient.send('command.fastForward', { toolCallId: callId })
                    } catch {
                      ffSentIdRef.current = null
                    }
                  }
                }
                setSkipFeedback(true)
                setTimeout(() => setSkipFeedback(false), 2500)
              }}
              title={
                ffBlocked
                  ? t({
                      en: 'No active command on the server — fast-forward unavailable',
                      fr: 'Aucune commande active côté serveur — fast-forward indisponible',
                    })
                  : t({
                      en: 'Fast-forward +60 s (terminates at the total)',
                      fr: 'Avancer de 60 s (termine au total)',
                    })
              }
              className="px-1.5 py-0.5 rounded border border-accent-warning/40 text-accent-warning hover:bg-accent-warning/10 transition-colors text-[10px] flex-shrink-0"
            >
              {ffBlocked
                ? t({ en: '⚠', fr: '⚠' })
                : skipFeedback
                  ? t({ en: '✓ +60 s', fr: '✓ +60 s' })
                  : t({ en: 'Skip timeout', fr: 'Passer le timeout' })}
            </button>
          )}
          {status === 'interrupted' && (
            <span className="text-red-400">{t({ en: 'interrupted', fr: 'interrompu' })}</span>
          )}
          <span className={status === 'pending' ? 'text-text-secondary' : 'text-text-muted'}>
            {`${elapsedSec.toFixed(1)}s / ${totalSec.toFixed(0)}s`}
          </span>
        </div>
      </div>

      {/* Progress bar for pending */}
      {status === 'pending' && (
        <div className="h-1 bg-bg-tertiary rounded overflow-hidden">
          <div
            className="h-full bg-accent-warning transition-all duration-100"
            style={{ width: `${Math.min(100, (displayElapsedMs / totalMs) * 100)}%` }}
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
