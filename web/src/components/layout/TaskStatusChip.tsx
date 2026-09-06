import type { TaskStatus } from '@shared/types.js'
import { columnMeta } from '../tasks/column-meta'

interface TaskStatusChipProps {
  status: TaskStatus
  label: string
}

/**
 * Small status square shown on a session card linked to a board task: border +
 * monospace label in the column color. The session→status mapping is computed
 * server-side (boardResource payload `sessionStatus`); the client only renders.
 */
export function TaskStatusChip({ status, label }: TaskStatusChipProps) {
  const meta = columnMeta(status)
  return (
    <span
      data-testid="task-status-chip"
      data-status={status}
      className="ml-auto inline-flex items-center px-1 py-px rounded border font-mono text-[10px] leading-tight"
      style={{ color: meta.stripeHex, borderColor: meta.stripeHex }}
    >
      {label.toLowerCase()}
    </span>
  )
}
