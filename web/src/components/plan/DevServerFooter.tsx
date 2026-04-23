import { useState, useEffect, useRef, memo } from 'react'
import { createPortal } from 'react-dom'
import { useDevServerStore } from '../../stores/dev-server'
import { GearIcon, StopIcon, OpenExternalIcon } from '../shared/icons'
import { DevServerConfigModal } from './DevServerConfigModal'
import { LogViewer } from './LogViewer'
import { ansiToReact } from '../../lib/ansiParser'

interface DevServerFooterProps {
  workdir?: string
}

const LogHoverExpand = memo(function LogHoverExpand({
  logs,
  anchorRef,
  isHiding,
  onExpand,
  onClose,
}: {
  logs: { stream: 'stdout' | 'stderr'; content: string }[]
  anchorRef: React.RefObject<HTMLDivElement | null>
  isHiding: boolean
  onExpand: () => void
  onClose: () => void
}) {
  const [pos, setPos] = useState<{ bottom: number; right: number; width: number; height: number } | null>(null)
  const preRef = useRef<HTMLPreElement>(null)

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
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight
    }
  }, [logs])

  if (!pos) return null

  return (
    <div className="relative">
      <pre
        ref={preRef}
        className="fixed z-50 text-sm font-mono text-text-primary bg-bg-primary p-2 rounded border border-border overflow-auto transition-all duration-150 ease-out select-text"
        style={{
          bottom: pos.bottom,
          right: pos.right,
          width: pos.width * 2,
          maxHeight: pos.height * 3,
          transformOrigin: 'bottom right',
          transform: isHiding ? 'scale(0.01)' : 'scale(1)',
          opacity: isHiding ? 0 : 1,
        }}
      >
        {logs.map((chunk, i) => (
          <span key={i} className={chunk.stream === 'stderr' ? 'text-accent-warning' : ''}>
            {ansiToReact(chunk.content)}
          </span>
        ))}
      </pre>
      <button
        onClick={() => { onClose(); onExpand() }}
        className="fixed z-50 px-2 py-1 rounded text-xs font-medium bg-accent-primary/30 text-text-primary hover:bg-accent-primary/50 transition-colors duration-150"
        style={{
          bottom: pos.bottom + 8,
          right: pos.right + 8,
        }}
      >
        Expand
      </button>
    </div>
  )
})

export const DevServerFooter = memo(function DevServerFooter({ workdir }: DevServerFooterProps) {
  const setWorkdir = useDevServerStore(s => s.setWorkdir)
  const status = useDevServerStore(s => s.status)
  const config = useDevServerStore(s => s.config)
  const logs = useDevServerStore(s => s.logs)
  const start = useDevServerStore(s => s.start)
  const stop = useDevServerStore(s => s.stop)
  const fetchLogs = useDevServerStore(s => s.fetchLogs)

  const [showConfigModal, setShowConfigModal] = useState(false)
  const [showExpandModal, setShowExpandModal] = useState(false)
  const [isHoveringLogs, setIsHoveringLogs] = useState(false)
  const [isHidingLogs, setIsHidingLogs] = useState(false)
  const showTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const logRef = useRef<HTMLPreElement>(null)
  const logContainerRef = useRef<HTMLDivElement>(null)

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

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current && isAlive) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs, isAlive])

  const handleAction = () => {
    if (isAlive) {
      stop()
    } else {
      start()
    }
  }

  return (
    <div className="mt-2 pt-3 border-t border-border space-y-3">
      {/* Header row: [dot] Dev Server ... [settings] */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${
            state === 'running' ? 'bg-accent-success' :
            state === 'warning' ? 'bg-accent-warning' :
            state === 'error' ? 'bg-accent-error' :
            'bg-text-muted'
          }`} />
          <h3 className="text-sm font-semibold text-text-primary">Dev Server</h3>
        </div>
        <button
          onClick={() => setShowConfigModal(true)}
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
                <a
                  href={status.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 rounded font-medium text-sm px-3 py-1.5 bg-accent-primary/25 text-text-primary hover:bg-accent-primary/40 transition-colors"
                  title={status.url}
                >
                  <OpenExternalIcon />
                  Open
                </a>
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

          {/* Log panel — always visible when running */}
          {isAlive && (
            <div
              ref={logContainerRef}
              className="relative"
              onMouseEnter={() => {
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
              <pre
                ref={logRef}
                className="text-sm bg-bg-primary p-2 rounded overflow-auto max-h-[200px] border border-border"
              >
                {logs.length === 0 ? (
                  <span className="text-text-muted">No output yet</span>
                ) : (
                  logs.map((chunk, i) => (
                    <span
                      key={i}
                      className={chunk.stream === 'stderr' ? 'text-accent-warning' : ''}
                    >
                      {ansiToReact(chunk.content)}
                    </span>
                  ))
                )}
              </pre>

              {/* Hover expansion portal */}
              {(isHoveringLogs || isHidingLogs) && logContainerRef.current && createPortal(
                <LogHoverExpand
                  logs={logs}
                  anchorRef={logContainerRef}
                  isHiding={isHidingLogs}
                  onExpand={() => setShowExpandModal(true)}
                  onClose={() => setIsHoveringLogs(false)}
                />,
                document.body
              )}
            </div>
          )}
        </>
      ) : (
        <button
          onClick={() => setShowConfigModal(true)}
          className="w-full rounded font-medium text-sm px-3 py-1.5 bg-bg-tertiary text-text-muted hover:bg-border transition-colors"
        >
          Configure
        </button>
      )}

      <DevServerConfigModal
        isOpen={showConfigModal}
        onClose={() => setShowConfigModal(false)}
      />

      {showExpandModal && (
        <LogViewer
          title="Dev Server Logs"
          logs={logs}
          onClose={() => setShowExpandModal(false)}
        />
      )}
    </div>
  )
})
