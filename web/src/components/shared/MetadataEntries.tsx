import { memo, useMemo } from 'react'
import type { MetadataEntry } from '@shared/types.js'
import { MetadataStatusIcon, statusOrder, decodeHtmlEntities } from './MetadataStatusIcon'

interface MetadataEntriesProps {
  entries: MetadataEntry[]
  title?: string
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

export const MetadataEntries = memo(function MetadataEntries({ entries, title }: MetadataEntriesProps) {
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
    </div>
  )
})
