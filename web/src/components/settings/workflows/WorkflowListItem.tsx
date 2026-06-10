import type { ReactNode } from 'react'

interface WorkflowListItemProps {
  name: string
  id: string
  color: string
  description?: string
  isBuiltIn?: boolean
  actions: ReactNode
}

export function WorkflowListItem({ name, id, color, description, isBuiltIn, actions }: WorkflowListItemProps) {
  return (
    <div className="flex items-center justify-between bg-bg-secondary rounded-lg p-4 border border-border">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
          <span className="text-text-primary text-sm font-medium">{name}</span>
          <span className="text-text-muted text-xs font-mono">{id}</span>
          {isBuiltIn && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-bg-primary text-text-muted">
              Built-in
            </span>
          )}
        </div>
        {description && <p className="text-text-secondary text-xs mt-0.5 truncate">{description}</p>}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0 ml-3">{actions}</div>
    </div>
  )
}

interface WorkflowListSectionProps {
  title: string
  items: Array<{ id: string; name: string; color?: string; description?: string }>
  renderActions: (item: { id: string }) => ReactNode
}

export function WorkflowListSection({ title, items, renderActions }: WorkflowListSectionProps) {
  if (items.length === 0) return null
  return (
    <div>
      <h3 className="text-xs font-medium text-text-secondary mb-2 uppercase tracking-wide">{title}</h3>
      <div className="space-y-2">
        {items.map((item) => (
          <WorkflowListItem
            key={item.id}
            name={item.name}
            id={item.id}
            color={item.color ?? '#3b82f6'}
            description={item.description}
            actions={renderActions(item)}
          />
        ))}
      </div>
    </div>
  )
}
