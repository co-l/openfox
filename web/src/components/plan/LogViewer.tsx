import { memo, useEffect, useRef } from 'react'
import { ansiToReact } from '../../lib/ansiParser'

interface LogViewerProps {
  title: string
  logs: { stream: 'stdout' | 'stderr'; content: string }[]
  onClose: () => void
  preClassName?: string
}

export const LogViewer = memo(function LogViewer({
  title,
  logs,
  onClose,
  preClassName = 'flex-1 overflow-auto p-4 text-sm font-mono text-text-primary',
}: LogViewerProps) {
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
          <h3 className="text-sm font-semibold text-text-primary truncate">{title}</h3>
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
          className={preClassName}
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