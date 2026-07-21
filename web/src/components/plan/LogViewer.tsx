import { memo, useRef } from 'react'
import { Modal } from '../shared/Modal'
import { LogRenderer } from '../shared/LogRenderer'
import { AutoScrollToggle } from '../shared/AutoScrollToggle'
import { useAutoScroll } from '../../hooks/useAutoScroll'

interface LogViewerProps {
  title: string
  logs: { stream: 'stdout' | 'stderr'; content: string }[]
  onClose: () => void
  preClassName?: string
}

export const LogViewer = memo(function LogViewer({ title, logs, onClose, preClassName }: LogViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { isAutoScrollActive, setAutoScroll } = useAutoScroll(scrollRef, null)

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={title}
      size="full"
      headerRight={
        <AutoScrollToggle
          isActive={isAutoScrollActive}
          onToggle={setAutoScroll}
          className="text-xs text-text-muted hover:text-text-primary flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-bg-tertiary transition-colors"
        />
      }
    >
      <div ref={scrollRef} className="h-full overflow-y-auto scrollbar-stable">
        <LogRenderer logs={logs} preClassName={preClassName} />
      </div>
    </Modal>
  )
})
