import type { ReactNode } from 'react'

interface UserItemsSectionProps {
  items: unknown[]
  label?: string
  renderItem: (item: unknown, index: number) => ReactNode
}

export function UserItemsSection({ items, label = 'Custom', renderItem }: UserItemsSectionProps) {
  if (items.length === 0) return null
  return (
    <div>
      <h3 className="text-xs font-medium text-text-secondary mb-2 uppercase tracking-wide">{label}</h3>
      <div className="space-y-2">
        {items.map(renderItem)}
      </div>
    </div>
  )
}