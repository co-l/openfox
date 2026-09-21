import { memo, useMemo, useState, useCallback } from 'react'
import type { MetadataEntry } from '@shared/types.js'
import { MetadataStatusIcon, statusOrder, decodeHtmlEntities } from './MetadataStatusIcon'
import { TrashIcon } from './icons'
import { useT } from '../../hooks/useT'

interface MetadataEntriesProps {
  entries: MetadataEntry[]
  title?: string
  onClearAll?: () => Promise<void> | void
}

export function MetadataSectionHeader({ entries, title }: { entries: MetadataEntry[]; title: string }) {
  const counts = useMemo(() => {
    return entries.reduce<Record<string, number>>((acc, e) => {
      acc[e.status] = (acc[e.status] ?? 0) + 1
      return acc
    }, {})
  }, [entries])

  return (
    <h3 className="text-sm font-semibold text-text-primary mb-2 flex items-center justify-between">
      <span>{title}</span>
      {Object.keys(counts).length > 0 && (
        <span className="font-normal text-xs flex items-center gap-1.5">
          {statusOrder.map((status) => {
            const count = counts[status]
            if (!count) return null
            return (
              <span key={status} className="flex items-center gap-0.5">
                <MetadataStatusIcon status={status} />
                <span>{count}</span>
              </span>
            )
          })}
        </span>
      )}
    </h3>
  )
}

export const MetadataEntries = memo(function MetadataEntries({ entries, title, onClearAll }: MetadataEntriesProps) {
  const t = useT()
  const [clearConfirm, setClearConfirm] = useState(false)

  const handleClear = useCallback(() => {
    setClearConfirm(false)
    onClearAll?.()
  }, [onClearAll])

  if (entries.length === 0) return null

  return (
    <div className="my-1 rounded border border-border bg-secondary overflow-hidden">
      {title && (
        <div className="px-1.5 py-1 border-b border-border bg-secondary">
          <span className="text-xs font-medium text-text-muted">{title}</span>
        </div>
      )}
      <div className="bg-primary">
        {entries.map((entry, idx) => (
          <div
            key={entry.id ?? idx}
            className={`flex items-start gap-1 px-1.5 py-1 ${idx > 0 ? 'border-t border-border' : ''}`}
          >
            <MetadataStatusIcon status={entry.status} />
            <div className="flex-1 min-w-0 text-xs truncate">
              <span className="text-text-muted">[{entry.id}]</span> {decodeHtmlEntities(entry.description)}
            </div>
          </div>
        ))}
      </div>
      {onClearAll && (
        <>
          <div className="px-1.5 py-1 border-t border-border bg-secondary flex items-center gap-2">
            <button
              onClick={() => setClearConfirm(true)}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-accent-error transition-colors ml-auto cursor-pointer"
              title={t({ en: 'Clear all', fr: 'Tout effacer' })}
            >
              <TrashIcon className="w-3 h-3" />
              {t({ en: 'Clear all', fr: 'Tout effacer' })}
            </button>
          </div>
          {clearConfirm && (
            <div className="px-1.5 py-1 border-t border-border bg-secondary">
              <div className="flex items-center gap-2 justify-between">
                <span className="text-xs text-accent-error">{t({ en: 'Clear all?', fr: 'Tout effacer ?' })}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleClear}
                    className="text-xs text-accent-error hover:text-accent-error/70 transition-colors cursor-pointer"
                  >
                    {t({ en: 'Yes', fr: 'Oui' })}
                  </button>
                  <button
                    onClick={() => setClearConfirm(false)}
                    className="text-xs text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                  >
                    {t({ en: 'No', fr: 'Non' })}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
})
