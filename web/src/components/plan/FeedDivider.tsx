import type { ReactNode } from 'react'

/**
 * Feed divider used to mark context boundaries (compaction): a centered label
 * between two horizontal rules. Shared by the main feed (window rotation) and
 * the sub-agent window (compaction boundary).
 */
export function FeedDivider({ label, testId, className }: { label: ReactNode; testId?: string; className?: string }) {
  return (
    <div data-testid={testId} className={`flex items-center gap-2 my-2 ${className ?? ''}`}>
      <div className="flex-1 border-t border-border" />
      <span className="text-[10px] text-text-muted font-medium px-2">{label}</span>
      <div className="flex-1 border-t border-border" />
    </div>
  )
}
