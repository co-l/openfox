import { ScrollArea } from '../shared/ScrollArea'
import type { OverlayScrollbarsComponentRef } from 'overlayscrollbars-react'
import { useState, useEffect, useRef, memo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useDevServerStore } from '../../stores/dev-server'
import { GearIcon, StopIcon, OpenExternalIcon, CopyIcon, CheckIcon } from '../shared/icons'
import { DevServerConfigModal } from './DevServerConfigModal'
import { LogViewer } from './LogViewer'
import { LogRenderer } from '../shared/LogRenderer'
import { AutoScrollToggle } from '../shared/AutoScrollToggle'
import { useAutoScroll, scrollbarGestureToEnable } from '../../hooks/useAutoScroll'
import type { ScrollbarGestureKind } from '../../hooks/useAutoScroll'
import { ansiToReact } from '../../lib/ansiParser'
import type { TailscalePreview } from '@shared/dev-server.js'

interface DevServerFooterProps {
  workdir?: string
  compact?: boolean
  onExpand?: () => void
  onConfigure?: () => void
}

const LogHoverExpand = memo(function LogHoverExpand({
  logs,
  anchorRef,
  isHiding,
  isAutoScrollActive,
  onSetAutoScroll,
}: {
  logs: { stream: 'stdout' | 'stderr'; content: string }[]
  anchorRef: React.RefObject<HTMLDivElement | null>
  isHiding: boolean
  isAutoScrollActive: boolean
  onSetAutoScroll: (enabled: boolean) => void
}) {
  const [pos, setPos] = useState<{ bottom: number; right: number; width: number; height: number } | null>(null)
  const osRef = useRef<OverlayScrollbarsComponentRef<'div'>>(null)
  const onSetAutoScrollRef = useRef(onSetAutoScroll)
  onSetAutoScrollRef.current = onSetAutoScroll

  const handleGesture = useCallback(
    (kind: ScrollbarGestureKind, gapToEndPx: number | null) => {
      onSetAutoScroll(scrollbarGestureToEnable(kind, gapToEndPx))
    },
    [onSetAutoScroll],
  )

  const getViewport = useCallback(() => {
    return osRef.current?.osInstance()?.elements().viewport ?? null
  }, [])

  useEffect(() => {
    const rect = anchorRef.current?.getBoundingClientRect()
    if (rect) {
      setPos({
        bottom: window.innerHeight - rect.bottom,
        right: window.innerWidth - rect.right,
        width: rect.width,
        height: rect.height,
      })
    }
  }, [anchorRef])

  useEffect(() => {
    const el = getViewport()
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        onSetAutoScrollRef.current(false)
        return
      }
      if (e.deltaY > 0) {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const distance = el.scrollHeight - el.scrollTop - el.offsetHeight
            if (distance < 100) {
              onSetAutoScrollRef.current(true)
            }
          }),
        )
      }
    }

    el.addEventListener('wheel', onWheel, { passive: true })
    return () => el.removeEventListener('wheel', onWheel)
  }, [getViewport])

  useEffect(() => {
    const viewport = getViewport()
    if (viewport && isAutoScrollActive) {
      viewport.scrollTop = viewport.scrollHeight
    }
  }, [logs, isAutoScrollActive, pos, getViewport])

  return (
    <div className={`relative ${!pos ? 'hidden' : ''}`}>
      <ScrollArea
        ref={osRef}
        className="fixed z-40 text-sm font-mono text-text-primary bg-bg-primary p-2 rounded border border-border transition-all duration-150 ease-out select-text"
        onScrollbarGesture={handleGesture}
        style={
          pos
            ? {
                bottom: pos.bottom,
                right: pos.right,
                width: pos.width * 2,
                maxHeight: pos.height * 3,
                transformOrigin: 'bottom right',
                transform: isHiding ? 'scale(0.01)' : 'scale(1)',
                opacity: isHiding ? 0 : 1,
              }
            : undefined
        }
      >
        <pre className="text-sm font-mono">
          {logs.map((chunk, i) => (
            <span key={i} className={chunk.stream === 'stderr' ? 'text-accent-warning' : ''}>
              {ansiToReact(chunk.content)}
            </span>
          ))}
        </pre>
      </ScrollArea>
    </div>
  )
})

export const DevServerFooter = memo(function DevServerFooter({
  workdir,
  compact,
  onExpand,
  onConfigure,
}: DevServerFooterProps) {
  const setWorkdir = useDevServerStore((s) => s.setWorkdir)
  const status = useDevServerStore((s) => s.status)
  const config = useDevServerStore((s) => s.config)
  const logs = useDevServerStore((s) => s.logs)
  const start = useDevServerStore((s) => s.start)
  const stop = useDevServerStore((s) => s.stop)
  const fetchLogs = useDevServerStore((s) => s.fetchLogs)
  const clearLogs = useDevServerStore((s) => s.clearLogs)
  const insertMarker = useDevServerStore((s) => s.insertMarker)
  const [previewCopied, setPreviewCopied] = useState(false)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleClearLogs = () => {
    if (window.confirm('Clear all dev server logs?')) {
      clearLogs()
    }
  }

  const [showConfigModal, setShowConfigModal] = useState(false)
  const [showExpandModal, setShowExpandModal] = useState(false)
  const [isHoveringLogs, setIsHoveringLogs] = useState(false)
  const [isHidingLogs, setIsHidingLogs] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)
  const logOsRef = useRef<OverlayScrollbarsComponentRef<'div'>>(null)
  const getLogViewport = useCallback(() => {
    return logOsRef.current?.osInstance()?.elements().viewport ?? null
  }, [])
  const { isAutoScrollActive, setAutoScroll, handleScrollbarGesture } = useAutoScroll(logOsRef, null, getLogViewport)
  const showTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const logContainerRef = useRef<HTMLDivElement>(null)

  const openInspectWindow = () => {
    const proxyPort = status?.inspectProxyPort
    if (!proxyPort) {
      if (status?.url) window.open(status.url, '_blank')
      return
    }
    const base = `${window.location.protocol}//${window.location.hostname}:${proxyPort}`
    window.open(base, '_blank')
  }

  const handleCopyPreview = useCallback(async (url: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url)
      }
      setPreviewCopied(true)
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
      copyTimeoutRef.current = setTimeout(() => setPreviewCopied(false), 1500)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    }
  }, [])

  const state = status?.state ?? 'off'
  const hasConfig = config !== null
  const isAlive = state === 'running' || state === 'warning'

  // Set workdir in store
  useEffect(() => {
    setWorkdir(workdir ?? null)
  }, [workdir, setWorkdir])

  // Fetch full log buffer when server starts
  useEffect(() => {
    if (isAlive) {
      fetchLogs()
    }
  }, [isAlive, fetchLogs])

  const handleAction = () => {
    if (isAlive) {
      stop()
    } else {
      start()
    }
  }

  return (
    <div className={`space-y-3 ${compact ? '' : 'mt-2 pt-3 border-t border-border'}`}>
      {/* Header row: [dot] Dev Server ... [settings] */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${
              state === 'running'
                ? 'bg-accent-success'
                : state === 'warning'
                  ? 'bg-accent-warning'
                  : state === 'error'
                    ? 'bg-accent-error'
                    : 'bg-text-muted'
            }`}
          />
          <h3 className="text-sm font-semibold text-text-primary">Dev Server</h3>
        </div>
        <button
          onClick={() => {
            if (onConfigure) onConfigure()
            else setShowConfigModal(true)
          }}
          className="p-1.5 rounded hover:bg-bg-tertiary transition-colors text-text-muted"
          title="Configure dev server"
        >
          <GearIcon />
        </button>
      </div>

      {hasConfig ? (
        <>
          {state === 'running' || state === 'warning' ? (
            /* Stop + Open side by side */
            <div className="flex gap-2">
              <button
                onClick={handleAction}
                className="flex-1 flex items-center justify-center gap-1.5 rounded font-medium text-sm px-3 py-1.5 bg-bg-tertiary text-text-primary hover:bg-border transition-colors"
              >
                <StopIcon />
                Stop
              </button>
              {status?.url && (
                <button
                  onClick={() => openInspectWindow()}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded font-medium text-sm px-3 py-1.5 bg-accent-primary/25 text-text-primary hover:bg-accent-primary/40 transition-colors"
                  title={status.url}
                >
                  <OpenExternalIcon />
                  Open
                </button>
              )}
            </div>
          ) : (
            /* Start button — full width */
            <button
              onClick={handleAction}
              className="w-full rounded font-medium text-sm px-3 py-1.5 bg-accent-primary/25 text-text-primary hover:bg-accent-primary/40 transition-colors"
            >
              Start
            </button>
          )}

          {/* Tailscale preview — secondary information only. No controls. */}
          {(state === 'running' || state === 'warning') && (
            <TailscalePreviewInfo
              preview={status?.tailscalePreview}
              onCopy={handleCopyPreview}
              copied={previewCopied}
            />
          )}
        </>
      ) : (
        <button
          onClick={() => {
            if (onConfigure) onConfigure()
            else setShowConfigModal(true)
          }}
          className="w-full rounded font-medium text-sm px-3 py-1.5 bg-bg-tertiary text-text-muted hover:bg-border transition-colors"
        >
          Configure
        </button>
      )}

      {/* Log panel — always mounted so useAutoScroll can attach, hidden when not alive+configured */}
      <div
        ref={logContainerRef}
        className={`relative ${hasConfig && isAlive ? '' : 'hidden'}`}
        onMouseEnter={() => {
          if (!hasConfig || !isAlive || compact) return
          if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current)
          showTimeoutRef.current = setTimeout(() => {
            setIsHoveringLogs(true)
            setIsHidingLogs(false)
          }, 500)
        }}
        onMouseLeave={() => {
          if (showTimeoutRef.current) clearTimeout(showTimeoutRef.current)
          setIsHidingLogs(true)
          hideTimeoutRef.current = setTimeout(() => setIsHoveringLogs(false), 150)
        }}
      >
        <LogRenderer
          logs={logs}
          preRef={logRef}
          preClassName="text-sm bg-bg-primary p-2 rounded max-h-[200px] border border-border"
          scrollAreaRef={logOsRef}
          onScrollbarGesture={handleScrollbarGesture}
        />

        {hasConfig && isAlive && (
          <>
            <div className="absolute bottom-1 right-1 z-50 flex items-center gap-1">
              {!compact && (isHoveringLogs || isHidingLogs) && (
                <AutoScrollToggle
                  isActive={isAutoScrollActive}
                  onToggle={setAutoScroll}
                  className="text-xs text-text-muted hover:text-text-primary flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-bg-tertiary transition-colors"
                />
              )}
              <button
                onClick={() => (compact ? onExpand?.() : setShowExpandModal(true))}
                className="px-2 py-0.5 rounded text-xs font-medium bg-accent-primary/30 text-text-primary hover:bg-accent-primary/50 transition-colors"
              >
                Expand
              </button>
            </div>

            {/* Hover expansion portal — only in sidebar */}
            {!compact &&
              (isHoveringLogs || isHidingLogs) &&
              logContainerRef.current &&
              createPortal(
                <LogHoverExpand
                  logs={logs}
                  anchorRef={logContainerRef}
                  isHiding={isHidingLogs}
                  isAutoScrollActive={isAutoScrollActive}
                  onSetAutoScroll={setAutoScroll}
                />,
                document.body,
              )}
          </>
        )}
      </div>

      {!onConfigure && <DevServerConfigModal isOpen={showConfigModal} onClose={() => setShowConfigModal(false)} />}

      {showExpandModal && (
        <LogViewer
          title="Dev Server Logs"
          logs={logs}
          onClose={() => setShowExpandModal(false)}
          onClear={handleClearLogs}
          onInsertMarker={insertMarker}
        />
      )}
    </div>
  )
})

interface TailscalePreviewInfoProps {
  preview: TailscalePreview | undefined
  onCopy: (url: string) => void
  copied: boolean
}

/**
 * Read-only secondary info about the Tailscale preview. No controls:
 * - active → Tailnet <url> with a small Copy button
 * - error → one-line "Tailnet Preview unavailable — <short reason>"
 * - starting / idle / off → nothing
 */
const TailscalePreviewInfo = memo(function TailscalePreviewInfo({
  preview,
  onCopy,
  copied,
}: TailscalePreviewInfoProps) {
  const status = preview?.status ?? 'idle'

  if (status === 'active' && preview?.url) {
    return (
      <div className="rounded border border-border bg-bg-primary p-2">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-text-primary">Tailnet</span>
          <button
            onClick={() => onCopy(preview.url!)}
            className="text-text-muted hover:text-text-primary flex items-center gap-1 px-1 py-0.5 rounded hover:bg-bg-tertiary transition-colors"
            title="Copy URL"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
        <div className="font-mono text-xs text-text-primary break-all select-all mt-1">{preview.url}</div>
      </div>
    )
  }

  if (status === 'error') {
    const shortReason = (preview?.error ?? 'unavailable').split('\n')[0] ?? 'unavailable'
    return (
      <div className="text-[10px] text-text-muted" title={preview?.error ?? ''}>
        Tailnet Preview unavailable — {shortReason}
      </div>
    )
  }

  return null
})
