import type { ProjectTask, TaskStatus } from '@shared/types.js'
import type { useT } from '../../hooks/useT'
import type { DropdownMenuItem } from '../shared/DropdownMenu'
import { COLUMN_META, COLUMN_ORDER } from './column-meta'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  EditSmallIcon,
  InfoIcon,
  MoveTargetLeftIcon,
  MoveTargetRightIcon,
  TrashIcon,
} from '../shared/icons'

type T = ReturnType<typeof useT>

/** Interaction callbacks shared by cards, columns and the card menu. */
export interface CardActionCallbacks {
  onEdit: (task: ProjectTask) => void
  onMove: (task: ProjectTask, to: TaskStatus) => void
  onMoveUp: (task: ProjectTask) => void
  onMoveDown: (task: ProjectTask) => void
  onDuplicate: (task: ProjectTask) => void
  onDelete: (task: ProjectTask) => void
}

export interface CardMenuDeps extends CardActionCallbacks {
  t: T
  task: ProjectTask
  onToggleAudit: () => void
}

/** Transitions list: the card's own column becomes a decorative position bar. */
export function buildTransitionMenuItems(deps: Pick<CardMenuDeps, 't' | 'task' | 'onMove'>): DropdownMenuItem[] {
  const { t, task, onMove } = deps
  return COLUMN_META.flatMap<DropdownMenuItem>((c) => {
    const targetIndex = COLUMN_ORDER.indexOf(c.status)
    const currentIndex = COLUMN_ORDER.indexOf(task.status)
    if (c.status === task.status) {
      // The card's own column: the no-op move entry becomes a full-width
      // horizontal position bar in the column's color, marking where the
      // task currently sits between its neighbours.
      return [{ label: '', decorativeBar: true, stripeClass: c.stripeClass }]
    }
    return [
      {
        label: t(c.title),
        icon:
          targetIndex < currentIndex ? (
            <MoveTargetLeftIcon className="w-3.5 h-3.5" />
          ) : (
            <MoveTargetRightIcon className="w-3.5 h-3.5" />
          ),
        stripeClass: c.stripeClass,
        onClick: () => onMove(task, c.status),
      },
    ]
  })
}

/** Body of the card menu (everything above Duplicate/Delete). */
export function buildCardMenuItems(deps: CardMenuDeps): DropdownMenuItem[] {
  const { t, task, onEdit, onToggleAudit, onMoveUp, onMoveDown } = deps
  return [
    {
      label: t({ en: 'Edit', fr: 'Modifier' }),
      icon: <EditSmallIcon className="w-3.5 h-3.5" />,
      onClick: () => onEdit(task),
    },
    {
      label: t({ en: 'History & evidence', fr: 'Historique et preuves' }),
      icon: <InfoIcon className="w-3.5 h-3.5" />,
      onClick: onToggleAudit,
    },
    ...buildTransitionMenuItems(deps),
    {
      label: t({ en: 'Move up', fr: 'Monter' }),
      icon: <ChevronUpIcon className="w-3.5 h-3.5" />,
      onClick: () => onMoveUp(task),
    },
    {
      label: t({ en: 'Move down', fr: 'Descendre' }),
      icon: <ChevronDownIcon className="w-3.5 h-3.5" />,
      onClick: () => onMoveDown(task),
    },
  ]
}

/** Danger-zone footer of the card menu. */
export function buildCardMenuFooterItems(deps: CardMenuDeps): DropdownMenuItem[] {
  const { t, task, onDuplicate, onDelete } = deps
  return [
    {
      label: t({ en: 'Duplicate', fr: 'Dupliquer' }),
      icon: <CopyIcon className="w-3.5 h-3.5" />,
      onClick: () => onDuplicate(task),
    },
    {
      label: t({ en: 'Delete', fr: 'Supprimer' }),
      icon: <TrashIcon className="w-3.5 h-3.5" />,
      danger: true,
      onClick: () => onDelete(task),
    },
  ]
}
