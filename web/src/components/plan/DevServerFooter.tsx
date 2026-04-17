import { useState, useEffect, useRef, memo } from 'react'
import { createPortal } from 'react-dom'
import { useDevServerStore } from '../../stores/dev-server'
import { DevServerConfigModal } from './DevServerConfigModal'
import { ansiToReact } from '../../lib/ansiParser'

interface DevServerFooterProps {
  workdir?: string
}

const ExpandLogsModal = memo(function ExpandLogsModal({
  logs,
  onClose,
}: {
  logs: { stream: 'stdout' | 'stderr'; content: string }[]
  onClose: () => void
}) {
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="relative w-[90vw] h-[90vh] bg-bg-primary rounded-lg border border-border flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-3 border-b border-border">
          <h3 className="text-sm font-semibold text-text-primary">Dev Server Logs</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-bg-tertiary transition-colors text-text-muted"
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        <pre
          ref={logRef}
          className="flex-1 overflow-auto p-4 text-sm font-mono text-text-primary"
        >
          {logs.length === 0 ? (
            <span className="text-text-muted">No output yet</span>
          ) : (
            logs.map((chunk, i) => (
              <span key={i} className={chunk.stream === 'stderr' ? 'text-accent-warning' : ''}>
                {ansiToReact(chunk.content)}
              </span>
            ))
          )}
        </pre>
      </div>
    </div>
  )
})

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
        className="fixed z-50 px-2 py-1 rounded text-xs font-medium bg-accent-primary/30 text-white hover:bg-accent-primary/50 transition-colors duration-150"
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

  const gearIcon = (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.1-.303c.652-.18 1.37.008 1.755.653a8.043 8.043 0 0 1 .683 1.18c.227.568.096 1.26-.378 1.726l-.812.804a.312.312 0 0 0-.081.283c.024.166.04.335.04.507s-.016.341-.04.507a.312.312 0 0 0 .08.283l.813.804c.474.466.605 1.158.378 1.726a8.07 8.07 0 0 1-.683 1.18c-.385.645-1.103.833-1.755.653l-1.1-.303c-.066-.019-.176-.011-.299.071a5.1 5.1 0 0 1-.668.386c-.133.066-.194.158-.211.224l-.29 1.107c-.168.645-.714 1.196-1.458 1.26a8.094 8.094 0 0 1-1.402 0c-.744-.064-1.29-.615-1.458-1.26l-.29-1.107a.426.426 0 0 0-.211-.224 5.11 5.11 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.1.303c-.652.18-1.37-.008-1.755-.653a8.044 8.044 0 0 1-.683-1.18c-.227-.568-.096-1.26.378-1.726l.812-.804a.312.312 0 0 0 .081-.283A5.18 5.18 0 0 1 2.3 8c0-.172.016-.341.04-.507a.312.312 0 0 0-.08-.283l-.813-.804C.973 5.94.842 5.248 1.069 4.68c.181-.452.395-.882.683-1.18.385-.645 1.103-.833 1.755-.653l1.1.303c.066.019.176.011.299-.071.214-.143.437-.272.668-.386a.426.426 0 0 0 .211-.224l.29-1.107C6.009.645 6.556.095 7.299.03 7.53.01 7.764 0 8 0Zm0 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" />
    </svg>
  )

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
          {gearIcon}
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
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="3" y="3" width="10" height="10" rx="1" />
                </svg>
                Stop
              </button>
              {status?.url && (
                <button
                  onClick={() => window.open(status?.url ?? '', '_blank')}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded font-medium text-sm px-3 py-1.5 bg-accent-primary/25 text-white hover:bg-accent-primary/40 transition-colors"
                  title={status.url}
                >
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6.5 3.5H3a1 1 0 0 0-1 1V13a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1V9.5" />
                    <path d="M9.5 2h4.5v4.5" />
                    <path d="M14 2L7.5 8.5" />
                  </svg>
                  Open
                </button>
              )}
            </div>
          ) : (
            /* Start button — full width */
            <button
              onClick={handleAction}
              className="w-full rounded font-medium text-sm px-3 py-1.5 bg-accent-primary/25 text-white hover:bg-accent-primary/40 transition-colors"
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
        <ExpandLogsModal logs={logs} onClose={() => setShowExpandModal(false)} />
      )}
    </div>
  )
})
