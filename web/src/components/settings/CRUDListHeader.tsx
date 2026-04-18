import { Button } from '../shared/Button'

interface CRUDListHeaderProps {
  description: string
  modifiedCount: number
  onRestoreAll: () => void
  isConfirmingRestoreAll: boolean
  onCancelRestoreAll: () => void
  onNew: () => void
  newLabel?: string
}

export function CRUDListHeader({
  description,
  modifiedCount,
  onRestoreAll,
  isConfirmingRestoreAll,
  onCancelRestoreAll,
  onNew,
  newLabel = '+ New',
}: CRUDListHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-4">
      <p className="text-text-secondary text-sm">{description}</p>
      <div className="flex items-center gap-2 flex-shrink-0 ml-3">
        {modifiedCount > 0 && (
          <div className="flex items-center gap-2 text-xs">
            {isConfirmingRestoreAll ? (
              <>
                <span className="text-accent-warning">Confirm restore all?</span>
                <button onClick={onCancelRestoreAll} className="text-text-muted hover:text-text-primary">Cancel</button>
                <button onClick={onRestoreAll} className="text-accent-error hover:text-accent-error/80">Confirm</button>
              </>
            ) : (
              <button
                onClick={onRestoreAll}
                className="text-accent-warning hover:text-accent-warning/80 transition-colors"
              >
                Restore defaults ({modifiedCount})
              </button>
            )}
          </div>
        )}
        <Button variant="primary" size="sm" onClick={onNew}>
          {newLabel}
        </Button>
      </div>
    </div>
  )
}