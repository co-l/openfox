import { Modal } from '../shared/Modal'

interface ProcessLogModalProps {
  isOpen: boolean
  onClose: () => void
  processName: string
  logs: { content: string; stream: 'stdout' | 'stderr' }[]
}

export function ProcessLogModal({ isOpen, onClose, processName, logs }: ProcessLogModalProps) {
  if (!isOpen) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={processName} size="lg">
      <pre className="flex-1 overflow-auto text-sm font-mono text-text-primary whitespace-pre-wrap">
        {logs.map((log, i) => (
          <span key={i} className={log.stream === 'stderr' ? 'text-accent-error' : ''}>{log.content}</span>
        ))}
      </pre>
    </Modal>
  )
}