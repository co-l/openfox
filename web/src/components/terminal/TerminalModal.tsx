import { useEffect, useState, useRef, useCallback } from 'react'
import { useTerminalStore } from '../../stores/terminal'
import { useProjectStore } from '../../stores/project'
import { TerminalPane } from './TerminalPane'

interface TerminalModalProps {
  isOpen: boolean
  onClose: () => void
  onFocusChat: () => void
}

function getGridClass(count: number): string {
  if (count === 1) return 'grid-cols-1'
  if (count === 2) return 'grid-cols-1 lg:grid-cols-2'
  return 'grid-cols-1 lg:grid-cols-2 xl:grid-cols-3'
}

export function TerminalModal({ isOpen, onClose, onFocusChat }: TerminalModalProps) {
  const createSession = useTerminalStore(state => state.createSession)
  const killSession = useTerminalStore(state => state.killSession)
  const sessions = useTerminalStore(state => state.sessions)
  const setWorkdir = useTerminalStore(state => state.setWorkdir)
  const fetchSessions = useTerminalStore(state => state.fetchSessions)
  const currentProject = useProjectStore(state => state.currentProject)
  const [isLoading, setIsLoading] = useState(true)
  const terminalRef = useRef<HTMLDivElement>(null)
  const justOpenedRef = useRef(false)
  const hasAutoCreatedForOpenCycleRef = useRef(false)

  const handleClose = useCallback(() => {
    onClose()
    onFocusChat()
  }, [onClose, onFocusChat])

  useEffect(() => {
    if (currentProject?.workdir) {
      setWorkdir(currentProject.workdir)
    }
  }, [currentProject?.workdir, setWorkdir])

  useEffect(() => {
    if (isOpen) {
      setIsLoading(true)
      fetchSessions().finally(() => setIsLoading(false))
    }
  }, [isOpen, fetchSessions])

  useEffect(() => {
    if (isOpen && sessions.length === 0 && !isLoading && !hasAutoCreatedForOpenCycleRef.current) {
      hasAutoCreatedForOpenCycleRef.current = true
      createSession()
    }
  }, [isOpen, sessions.length, isLoading, createSession])

  useEffect(() => {
    if (isOpen) {
      justOpenedRef.current = true
      setTimeout(() => {
        terminalRef.current?.focus()
        setTimeout(() => {
          justOpenedRef.current = false
        }, 200)
      }, 100)
    } else {
      hasAutoCreatedForOpenCycleRef.current = false
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (justOpenedRef.current) return
      if (e.key === 'Escape' || e.key === '²' || e.key === '`') {
        e.preventDefault()
        onClose()
        onFocusChat()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, onFocusChat])

  if (!isOpen) return null

  return (
    <>
      <div
        className="fixed inset-x-0 top-[50vh] bottom-0 z-40 bg-black/40"
        style={{ pointerEvents: 'auto' }}
        onClick={handleClose}
      />
      <div
        ref={terminalRef}
        tabIndex={-1}
        className="fixed inset-x-0 top-0 z-50 h-[50vh] bg-bg-primary border-b border-border flex flex-col animate-slide-down outline-none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === '²' || e.key === '`') {
            e.preventDefault()
            handleClose()
          }
        }}
      >
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <h3 className="text-sm font-semibold text-text-primary">Terminal</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => createSession()}
            className="p-2 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title="New terminal"
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
          </button>
          <button
            onClick={() => { onClose(); onFocusChat() }}
            className="p-2 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title="Close (Esc)"
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 p-2 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-text-muted">
            Loading...
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-muted">
            <div className="text-center">
              <p className="mb-4">No terminal sessions</p>
              <button
                onClick={() => createSession()}
                className="px-4 py-2 bg-accent-primary/25 text-white rounded hover:bg-accent-primary/40 transition-colors"
              >
                Create Terminal
              </button>
            </div>
          </div>
        ) : (
          <div className={`grid ${getGridClass(sessions.length)} gap-2 h-full auto-rows-fr`}>
            {sessions.map(session => (
              <TerminalPane
                key={session.id}
                sessionId={session.id}
                onClose={() => killSession(session.id)}
                onEscape={handleClose}
                autoFocus={sessions.length === 1}
              />
            ))}
          </div>
        )}
      </div>
      </div>
    </>
  )
}