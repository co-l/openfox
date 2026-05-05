interface CRUDListSectionProps {
  items: { id: string; name: string }[]
  title: string
  renderItem: (item: { id: string; name: string }, index: number) => React.ReactNode
}

export function CRUDListSection({ items, title, renderItem }: CRUDListSectionProps) {
  return (
    <div>
      <h3 className="text-xs font-medium text-text-secondary mb-2 uppercase tracking-wide">{title}</h3>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div
            key={item.id}
            className="flex items-center justify-between p-3 rounded border border-border bg-bg-tertiary"
          >
            <div className="min-w-0 flex-1 mr-3">
              <div className="flex items-center gap-2">
                <span className="text-text-primary text-sm font-medium">{item.name}</span>
              </div>
            </div>
            {renderItem(item, index)}
          </div>
        ))}
      </div>
    </div>
  )
}
