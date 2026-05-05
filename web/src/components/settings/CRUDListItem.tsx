import type { ReactNode } from 'react'
import { EditButton } from '../shared/IconButton'
import { EyeIcon } from '../shared/icons'
import { ConfirmButton, DeleteIcon, DuplicateIcon } from './CRUDModal'

export interface CRUDListItemProps {
  isBuiltIn: boolean
  isConfirmingDelete: boolean
  onView?: () => void
  onEdit?: () => void
  onDuplicate: () => void
  onDelete?: () => void
  children?: ReactNode
}

export function CRUDListItem({
  isBuiltIn,
  isConfirmingDelete,
  onView,
  onEdit,
  onDuplicate,
  onDelete,
  children,
}: CRUDListItemProps) {
  return (
    <div className="flex items-center justify-between p-3 rounded border border-border bg-bg-tertiary">
      <div className="min-w-0 flex-1 mr-3">{children}</div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {isBuiltIn && onView && (
          <button
            onClick={onView}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-primary transition-colors"
            title="View"
          >
            <EyeIcon />
          </button>
        )}
        <DuplicateIcon onClick={onDuplicate} />
        {!isBuiltIn && onEdit && <EditButton onClick={onEdit} />}
        {!isBuiltIn &&
          (isConfirmingDelete ? (
            <ConfirmButton
              onConfirm={() => {
                onDelete?.()
              }}
              onCancel={() => {}}
            />
          ) : (
            <DeleteIcon onClick={() => onDelete?.()} />
          ))}
      </div>
    </div>
  )
}

export interface CRUDListItemSimpleProps {
  id: string
  name: string
  description?: string
  isBuiltIn: boolean
  isConfirmingDelete: boolean
  onView?: () => void
  onEdit?: () => void
  onDuplicate: () => void
  onDelete?: () => void
}

export function CRUDListItemSimple({
  id,
  name,
  description,
  isBuiltIn,
  isConfirmingDelete,
  onView,
  onEdit,
  onDuplicate,
  onDelete,
}: CRUDListItemSimpleProps) {
  return (
    <CRUDListItem
      isBuiltIn={isBuiltIn}
      isConfirmingDelete={isConfirmingDelete}
      onView={onView}
      onEdit={onEdit}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
    >
      <div className="flex items-center gap-2">
        <span className="text-text-primary text-sm font-medium">{name}</span>
        <span className="text-text-muted text-xs font-mono">{id}</span>
      </div>
      {description && <p className="text-text-muted text-xs truncate">{description}</p>}
    </CRUDListItem>
  )
}
