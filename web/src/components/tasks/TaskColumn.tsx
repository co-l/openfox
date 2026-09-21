import type { ReactNode } from 'react'
import type { ProjectTask } from '@shared/types.js'
import type { AgentInfo } from '../../lib/agents-actions'
import { TaskCard, type TaskDragHandlers, type TaskCallbacks } from './TaskCard'
import { useT } from '../../hooks/useT'

type TaskColumnCallbacks = TaskCallbacks & { onDropOnColumn: () => void }

interface TaskColumnProps extends TaskDragHandlers, TaskColumnCallbacks {
  title: string
  accentClass: string
  hint?: string
  tasks: ProjectTask[]
  projectId: string
  agents: AgentInfo[]
  queuePositionOf: (task: ProjectTask) => number | undefined
  /** Optional controls in the column header (e.g. Gates on the Done column). */
  headerAction?: ReactNode
  /** Optional controls pinned to the bottom of the column (e.g. queue settings). */
  footer?: ReactNode
}

export function TaskColumn({
  title,
  accentClass,
  hint,
  tasks,
  projectId,
  agents,
  queuePositionOf,
  headerAction,
  footer,
  onEdit,
  onMove,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onDelete,
  onDragStart,
  onDropOnColumn,
  onDropOnCard,
  onOpenSession,
}: TaskColumnProps) {
  const t = useT()
  return (
    <section
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDropOnColumn()
      }}
      className="flex flex-col min-w-64 w-72 max-w-72 bg-bg-secondary/60 border border-border rounded-lg overflow-hidden"
    >
      {/* 51px: the tallest column action is the To Do "New Task" button — keep
          every column header the same height so the card grids align. */}
      <header className={`flex items-center gap-2 min-h-[51px] px-3 py-2 border-b border-border ${accentClass}`}>
        <div className="flex items-center gap-2 flex-1 min-w-0 text-left">
          <span className="text-sm font-semibold uppercase tracking-wide text-text-primary">{title}</span>
          <span className="text-xs text-text-muted bg-bg-tertiary px-1.5 py-0.5 rounded-full">{tasks.length}</span>
        </div>
        {headerAction}
      </header>

      {hint && <p className="px-3 pt-2 text-sm text-text-muted italic">{hint}</p>}

      <div className="p-2 space-y-2 overflow-y-auto flex-1 min-h-24">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            projectId={projectId}
            agents={agents}
            queuePosition={queuePositionOf(task)}
            onEdit={onEdit}
            onMove={onMove}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
            onDragStart={onDragStart}
            onDropOnCard={onDropOnCard}
            onOpenSession={onOpenSession}
          />
        ))}
        {tasks.length === 0 && (
          <div className="text-sm text-text-muted text-center py-6 border border-dashed border-border rounded-lg">
            {t({ en: 'Empty', fr: 'Vide' })}
          </div>
        )}
      </div>

      {footer && <div className="border-t border-border">{footer}</div>}
    </section>
  )
}
