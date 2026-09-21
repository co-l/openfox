import { ScrollArea } from '../shared/ScrollArea'
import type { OverlayScrollbarsComponentRef } from 'overlayscrollbars-react'
import { useState, useEffect, useRef, memo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useDevServerStore } from '../../stores/dev-server'
import { useDevServer } from '../../hooks/useDevServer'
import { useT } from '../../hooks/useT'
import { GearIcon, StopIcon, OpenExternalIcon } from '../shared/icons'
import { DevServerConfigModal } from './DevServerConfigModal'
import { LogViewer } from './LogViewer'
import { LogRenderer } from '../shared/LogRenderer'
import { AutoScrollToggle } from '../shared/AutoScrollToggle'
import { useAutoScroll, scrollbarGestureToEnable } from '../../hooks/useAutoScroll'
import type { ScrollbarGestureKind } from '../../hooks/useAutoScroll'
import { ansiToReact } from '../../lib/ansiParser'

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
  const t = useT()
  const { status, config, logs } = useDevServer(workdir)
  const start = useDevServerStore((s) => s.start)
  const stop = useDevServerStore((s) => s.stop)
  const clearLogs = useDevServerStore((s) => s.clearLogs)
  const insertMarker = useDevServerStore((s) => s.insertMarker)

  const handleClearLogs = () => {
    if (!workdir) return
    if (window.confirm(t({ en: 'Clear all dev server logs?', fr: 'Effacer tous les journaux du serveur de dev ?' }))) {
      clearLogs(workdir)
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

  const state = status?.state ?? 'off'
  const hasConfig = config !== null
  const isAlive = state === 'running' || state === 'warning'

  const handleAction = () => {
    if (!workdir) return
    if (isAlive) {
      stop(workdir)
    } else {
      start(workdir)
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
          <h3 className="text-sm font-semibold text-text-primary">{t({ en: 'Dev Server', fr: 'Serveur de dev' })}</h3>
        </div>
        <button
          onClick={() => {
            if (onConfigure) onConfigure()
            else setShowConfigModal(true)
          }}
          className="p-1.5 rounded hover:bg-bg-tertiary transition-colors text-text-muted"
          title={t({ en: 'Configure dev server', fr: 'Configurer le serveur de dev' })}
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
                {t({ en: 'Stop', fr: 'Arrêter' })}
              </button>
              {status?.url && (
                <button
                  onClick={() => openInspectWindow()}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded font-medium text-sm px-3 py-1.5 bg-accent-primary/25 text-text-primary hover:bg-accent-primary/40 transition-colors"
                  title={status.url}
                >
                  <OpenExternalIcon />
                  {t({ en: 'Open', fr: 'Ouvrir' })}
                </button>
              )}
            </div>
          ) : (
            /* Start button — full width */
            <button
              onClick={handleAction}
              className="w-full rounded font-medium text-sm px-3 py-1.5 bg-accent-primary/25 text-text-primary hover:bg-accent-primary/40 transition-colors"
            >
              {t({ en: 'Start', fr: 'Démarrer' })}
            </button>
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
          {t({ en: 'Configure', fr: 'Configurer' })}
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
                {t({ en: 'Expand', fr: 'Développer' })}
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

      {!onConfigure && (
        <DevServerConfigModal isOpen={showConfigModal} onClose={() => setShowConfigModal(false)} workdir={workdir} />
      )}

      {showExpandModal && (
        <LogViewer
          title={t({ en: 'Dev Server Logs', fr: 'Journaux du serveur de dev' })}
          logs={logs}
          onClose={() => setShowExpandModal(false)}
          onClear={handleClearLogs}
          onInsertMarker={() => {
            if (workdir) insertMarker(workdir)
          }}
        />
      )}
    </div>
  )
})
