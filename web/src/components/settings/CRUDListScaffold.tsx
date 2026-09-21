import type { ReactNode } from 'react'
import { CRUDListHeader } from './CRUDListHeader'
import { CRUDListView } from './CRUDListView'

interface CRUDListScaffoldProps {
  description: string
  onNew: () => void
  loading: boolean
  hasItems: boolean
  loadingLabel: string
  emptyLabel?: string
  children: ReactNode
}

export function CRUDListScaffold({
  description,
  onNew,
  loading,
  hasItems,
  loadingLabel,
  emptyLabel,
  children,
}: CRUDListScaffoldProps) {
  return (
    <>
      <CRUDListHeader description={description} onNew={onNew} />
      <CRUDListView loading={loading} hasItems={hasItems} loadingLabel={loadingLabel} emptyLabel={emptyLabel}>
        {children}
      </CRUDListView>
    </>
  )
}
