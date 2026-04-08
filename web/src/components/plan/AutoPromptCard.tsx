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

  const agentInfo = message.agentInfo
  const agentColor = agentInfo?.color ?? '#6b7280'
  const agentName = agentInfo?.name ?? 'Agent'
  const agentId = agentInfo?.id ?? 'unknown'

  return (
    <>
      <div className="flex items-center justify-center gap-1.5 text-[10px] text-text-muted font-mono mt-3 mb-4">
        <span className="flex-1 h-px bg-border" />
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0 cursor-pointer"
          style={{ backgroundColor: agentColor }}
          onClick={() => setIsModalOpen(true)}
        />
        <span
          className="cursor-pointer hover:text-text-secondary transition-colors"
          style={{ color: agentColor }}
          onClick={() => setIsModalOpen(true)}
        >
          {agentName}
        </span>
        <span>·</span>
        <span
          className="cursor-pointer hover:text-text-secondary transition-colors"
          onClick={() => setIsModalOpen(true)}
        >
          definition injected
        </span>
        <span className="flex-1 h-px bg-border" />
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={`${agentName} Prompt Definition`}
        size="lg"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: agentColor }}
            />
            <span className="text-sm text-text-primary font-medium">
              {agentName}
            </span>
            <span className="text-xs text-text-muted">({agentId})</span>
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