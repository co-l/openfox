import { memo } from 'react'
import { LogViewer } from './LogViewer'

interface ProcessLogModalProps {
  isOpen: boolean
  onClose: () => void
  processName: string
  logs: { content: string; stream: 'stdout' | 'stderr' }[]
}

export const ProcessLogModal = memo(function ProcessLogModal({
  isOpen,
  onClose,
  processName,
  logs,
}: ProcessLogModalProps) {
  if (!isOpen) return null

  return (
    <LogViewer
      title={processName}
      logs={logs}
      onClose={onClose}
      preClassName="flex-1 overflow-auto p-4 text-sm font-mono text-text-primary whitespace-pre-wrap"
    />
  )
})