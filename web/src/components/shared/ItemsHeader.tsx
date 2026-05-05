import type { ReactNode } from 'react'

interface ItemsHeaderProps {
  label?: string
  children: ReactNode
}

export function ItemsHeader({ label = 'Custom', children }: ItemsHeaderProps) {
  return (
    <div>
      <h3 className="text-xs font-medium text-text-secondary mb-2 uppercase tracking-wide">{label}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  )
}
