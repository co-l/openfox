import { memo, useEffect, useRef } from 'react'
import { Modal } from '../shared/Modal'
import { ansiToReact } from '../../lib/ansiParser'

interface LogViewerProps {
  title: string
  logs: { stream: 'stdout' | 'stderr'; content: string }[]
  onClose: () => void
  preClassName?: string
}

export const LogViewer = memo(function LogViewer({ title, logs, onClose, preClassName }: LogViewerProps) {
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  return (
    <Modal isOpen={true} onClose={onClose} title={title} size="full">
      <pre ref={logRef} className={preClassName}>
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
    </Modal>
  )
})