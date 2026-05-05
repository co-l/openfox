import type { ReactNode } from 'react'

interface CRUDListViewProps {
  loading: boolean
  hasItems: boolean
  loadingLabel: string
  emptyLabel?: string
  children: ReactNode
}

export function CRUDListView({ loading, hasItems, loadingLabel, emptyLabel, children }: CRUDListViewProps) {
  if (loading && !hasItems) {
    return <div className="text-text-muted text-sm">{loadingLabel}</div>
  }
  if (!hasItems) {
    return emptyLabel ? <div className="text-text-muted text-sm">{emptyLabel}</div> : null
  }
  return <div className="space-y-4">{children}</div>
}

interface CRUDSectionHeaderProps {
  title: string
}

export function CRUDSectionHeader({ title }: CRUDSectionHeaderProps) {
  return <h3 className="text-xs font-medium text-text-secondary mb-2 uppercase tracking-wide">{title}</h3>
}
