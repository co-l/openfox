import { useState } from 'react'
import { Link } from 'wouter'
import type { ProjectTask, TaskStatus } from '@shared/types.js'
import type { AgentInfo } from '../../stores/agents'
import { getAgentColor } from '../../stores/agents'
import { DropdownMenu, type DropdownMenuItem } from '../shared/DropdownMenu'
import {
  EllipsisIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PlayIcon,
  PauseIcon,
  CopyIcon,
  TrashIcon,
  EditSmallIcon,
  OpenExternalIcon,
  InfoIcon,
} from '../shared/icons'

/** Drag-and-drop callbacks shared by cards and columns. */
export interface TaskDragHandlers {
  onDragStart: (task: ProjectTask) => void
}

/** Interaction callbacks shared by cards and columns (columns forward them to cards). */
export interface TaskCallbacks {
  onEdit: (task: ProjectTask) => void
  onMove: (task: ProjectTask, to: TaskStatus) => void
  onMoveUp: (task: ProjectTask) => void
  onMoveDown: (task: ProjectTask) => void
  onDuplicate: (task: ProjectTask) => void
  onDelete: (task: ProjectTask) => void
  onDropOnCard: (task: ProjectTask) => void
  /** Invoked when a card's session link is opened (lets a host modal dismiss itself). */
  onOpenSession?: (sessionId: string) => void
}

interface TaskCardProps extends TaskDragHandlers, TaskCallbacks {
  task: ProjectTask
  projectId: string
  agents: AgentInfo[]
  queuePosition?: number
}

export function TaskCard({
  task,
  projectId,
  agents,
  queuePosition,
  onEdit,
  onMove,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onDelete,
  onDragStart,
  onDropOnCard,
  onOpenSession,
}: TaskCardProps) {
  const [showAudit, setShowAudit] = useState(false)

  const agent = agents.find((a) => a.id === task.agentId)
  const agentColor = task.agentId ? getAgentColor(agents, task.agentId) : undefined
  const images = task.attachments.filter((a) => a.mimeType.startsWith('image/'))
  const sessionToOpen = task.activeSessionId ?? task.sessionIds[task.sessionIds.length - 1]

  const menuItems: DropdownMenuItem[] = [
    { label: 'Edit', icon: <EditSmallIcon className="w-3.5 h-3.5" />, onClick: () => onEdit(task) },
    {
      label: 'History & evidence',
      icon: <InfoIcon className="w-3.5 h-3.5" />,
      onClick: () => setShowAudit((prev) => !prev),
    },
    {
      label: <div className="px-3 py-2 text-text-muted text-xs font-medium cursor-default">Move to…</div>,
      onClick: () => {},
    },
    { label: 'To Do', onClick: () => onMove(task, 'todo') },
    { label: 'In Progress', onClick: () => onMove(task, 'in_progress') },
    { label: 'Done', onClick: () => onMove(task, 'done') },
    { label: 'Move up', icon: <ChevronUpIcon className="w-3.5 h-3.5" />, onClick: () => onMoveUp(task) },
    { label: 'Move down', icon: <ChevronDownIcon className="w-3.5 h-3.5" />, onClick: () => onMoveDown(task) },
  ]

  const menuFooterItems: DropdownMenuItem[] = [
    { label: 'Duplicate', icon: <CopyIcon className="w-3.5 h-3.5" />, onClick: () => onDuplicate(task) },
    { label: 'Delete', icon: <TrashIcon className="w-3.5 h-3.5" />, danger: true, onClick: () => onDelete(task) },
  ]

  return (
    <div
      draggable
      onClick={() => onEdit(task)}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        onDragStart(task)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDropOnCard(task)
      }}
      className={`group relative cursor-pointer bg-bg-tertiary border border-border rounded-lg p-2.5 hover:border-accent-primary/40 transition-colors ${
        task.status === 'in_progress' ? 'ring-1 ring-inset ring-accent-primary/20' : ''
      }`}
    >
      {task.status === 'in_progress' && (
        <span
          className={`mb-1.5 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
            task.runState === 'running' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'
          }`}
        >
          {task.runState === 'running' ? <PlayIcon className="w-2.5 h-2.5" /> : <PauseIcon className="w-2.5 h-2.5" />}
          {task.runState === 'running'
            ? 'Running'
            : `Queued${queuePosition !== undefined ? ` · ${queuePosition}` : ''}`}
        </span>
      )}

      <p className="pr-8 text-sm text-text-primary leading-relaxed line-clamp-3 break-words whitespace-pre-wrap">
        {task.prompt}
      </p>

      <div className="absolute top-2 right-2" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu
          items={menuItems}
          footerItems={menuFooterItems}
          minWidth="176px"
          align="right"
          trigger={
            <button
              type="button"
              className="p-1 rounded hover:bg-bg-secondary text-text-muted hover:text-text-primary transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
              title="Task actions"
              aria-label={`Actions for ${task.prompt.slice(0, 40)}`}
            >
              <EllipsisIcon className="w-4 h-4" />
            </button>
          }
        />
      </div>

      <div className="mt-2 flex items-center gap-2 flex-wrap">
        {task.attachments.length > 0 && (
          <span
            className="text-xs text-text-muted flex items-center gap-1"
            title={`${task.attachments.length} attachment(s)`}
          >
            📎 {task.attachments.length}
          </span>
        )}
        {images.length > 0 && (
          <span className="flex -space-x-1">
            {images.slice(0, 3).map((img) => (
              <img
                key={img.id}
                src={img.data}
                alt=""
                className="w-6 h-6 rounded object-cover ring-2 ring-bg-tertiary"
              />
            ))}
          </span>
        )}
        {task.model && (
          <span
            className="text-xs px-1.5 py-0.5 rounded bg-bg-secondary border border-border text-text-muted truncate max-w-36"
            title={task.model}
          >
            {task.model}
          </span>
        )}
        {agent && (
          <span
            className="text-xs px-1.5 py-0.5 rounded bg-bg-secondary border border-border flex items-center gap-1"
            style={{ color: agentColor }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: agentColor }} />
            {agent.name}
          </span>
        )}
        {sessionToOpen && (
          <Link
            href={`/p/${projectId}/s/${sessionToOpen}`}
            onClick={(e) => {
              e.stopPropagation()
              onOpenSession?.(sessionToOpen)
            }}
            className="ml-auto text-xs px-1.5 py-1 rounded bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20 flex items-center gap-1"
          >
            Open session <OpenExternalIcon className="w-2.5 h-2.5" />
          </Link>
        )}
      </div>

      {showAudit && task.auditTrail.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border space-y-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">History</div>
          {task.auditTrail.map((entry) => (
            <div key={entry.id} className="text-xs text-text-muted leading-relaxed">
              <span className="text-text-primary">{entry.action}</span>
              {entry.detail && <span> — {entry.detail}</span>}
              <span className="text-text-muted/70">
                {' '}
                · {entry.actor}
                {entry.actorName && entry.actorName !== entry.actor ? ` (${entry.actorName})` : ''} ·{' '}
                {new Date(entry.timestamp).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
