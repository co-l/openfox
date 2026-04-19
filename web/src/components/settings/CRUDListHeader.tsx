import { Button } from '../shared/Button'

interface CRUDListHeaderProps {
  description: string
  onNew: () => void
  newLabel?: string
}

export function CRUDListHeader({
  description,
  onNew,
  newLabel = '+ New',
}: CRUDListHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-4">
      <p className="text-text-secondary text-sm">{description}</p>
      <div className="flex items-center gap-2 flex-shrink-0 ml-3">
        <Button variant="primary" size="sm" onClick={onNew}>
          {newLabel}
        </Button>
      </div>
    </div>
  )
}