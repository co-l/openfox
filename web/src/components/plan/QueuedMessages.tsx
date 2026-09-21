import type { QueuedMessage } from '@shared/protocol.js'
import { CloseButton } from '../shared/CloseButton'
import { useT } from '../../hooks/useT'

interface QueuedMessagesProps {
  messages: QueuedMessage[]
  onCancel: (queueId: string) => void
}

export function QueuedMessages({ messages, onCancel }: QueuedMessagesProps) {
  const t = useT()
  if (messages.length === 0) return null

  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {messages.map((qm) => (
        <div
          key={qm.queueId}
          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
            qm.mode === 'asap'
              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
              : 'bg-blue-500/15 text-blue-300 border border-blue-500/30'
          }`}
        >
          <span className="font-medium">{qm.mode === 'asap' ? 'ASAP' : t({ en: 'Queue:', fr: 'File :' })}</span>
          <span className="truncate max-w-[200px]">{qm.content}</span>
          <CloseButton onClick={() => onCancel(qm.queueId)} size="sm" />
        </div>
      ))}
    </div>
  )
}
