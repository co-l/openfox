import { useState } from 'react'
import type { Message } from '@shared/types.js'
import { Modal } from '../shared/Modal'

interface AutoPromptCardProps {
  message: Message
}

export function AutoPromptCard({ message }: AutoPromptCardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)

  if (message.messageKind !== 'auto-prompt') {
    return null
  }

  const metadata = message.metadata
  const metaColor = metadata?.color ?? '#6b7280'
  const metaName = metadata?.name ?? 'Agent'
  const metaType = metadata?.type ?? 'agent'

  const typeLabels: Record<string, string> = {
    agent: 'definition injected',
    workflow: 'instructions',
    compaction: 'prompt injected',
    subagent: 'instructions',
  }
  const label = typeLabels[metaType] ?? 'injected'

  const showContentDirectly = metaType === 'workflow' || metaType === 'subagent'

  return (
    <>
      <div className="flex items-center justify-center gap-1.5 text-[10px] text-text-muted font-mono mt-3 mb-4">
        <span className="flex-1 h-px bg-border" />
        <span
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${!showContentDirectly ? 'cursor-pointer' : ''}`}
          style={{ backgroundColor: metaColor }}
          onClick={() => !showContentDirectly && setIsModalOpen(true)}
        />
        <span
          className={!showContentDirectly ? 'cursor-pointer hover:text-text-secondary transition-colors' : ''}
          style={{ color: metaColor }}
          onClick={() => !showContentDirectly && setIsModalOpen(true)}
        >
          {metaName}
        </span>
        <span>·</span>
        <span
          className={!showContentDirectly ? 'cursor-pointer hover:text-text-secondary transition-colors' : ''}
          onClick={() => !showContentDirectly && setIsModalOpen(true)}
        >
          {label}
        </span>
        <span className="flex-1 h-px bg-border" />
      </div>

      {showContentDirectly && (
        <div className="flex justify-center feed-item mb-4">
          <div
            className="max-w-[75%] rounded p-3 bg-bg-tertiary/50 text-text-secondary text-sm"
            style={{ borderLeft: `3px solid ${metaColor}` }}
          >
            <pre className="whitespace-pre-wrap font-mono text-xs">{message.content}</pre>
          </div>
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={`${metaName} Prompt`}
        size="lg"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: metaColor }}
            />
            <span className="text-sm text-text-primary font-medium">
              {metaName}
            </span>
            <span className="text-xs text-text-muted">({metaType})</span>
          </div>

          <div className="h-full min-h-96">
            <pre className="text-sm text-text-secondary whitespace-pre-wrap bg-bg-tertiary rounded p-4 h-full min-h-96 overflow-auto font-mono">
              {message.content}
            </pre>
          </div>
        </div>
      </Modal>
    </>
  )
}