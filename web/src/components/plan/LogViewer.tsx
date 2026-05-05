import { memo, useEffect, useRef } from 'react'
import { Modal } from '../shared/Modal'
import { LogRenderer } from '../shared/LogRenderer'

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
      <LogRenderer logs={logs} preRef={logRef} preClassName={preClassName} />
    </Modal>
  )
})
