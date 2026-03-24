import { memo } from 'react'
import type { Criterion } from '../../../src/shared/types.js'

interface CriteriaProgressSummaryProps {
  criteria: Criterion[]
}

type StatusConfig = {
  icon: string
  color: string
  label: string
  animate?: boolean
}

const statusConfig: Record<Criterion['status']['type'], StatusConfig> = {
  pending: { icon: '○', color: 'text-text-muted', label: 'Pending' },
  in_progress: { icon: '●', color: 'text-accent-warning', label: 'In Progress', animate: true },
  completed: { icon: '◉', color: 'text-purple-400', label: 'Completed' },
  passed: { icon: '✓', color: 'text-accent-success', label: 'Passed' },
  failed: { icon: '✗', color: 'text-accent-error', label: 'Failed' },
}

export const CriteriaProgressSummary = memo(function CriteriaProgressSummary({ criteria }: CriteriaProgressSummaryProps) {
  // Handle empty criteria
  if (criteria.length === 0) {
    return (
      <div className="text-text-muted text-sm text-center py-2">
        No criteria yet
      </div>
    )
  }

  // Count criteria by status
  const counts = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    passed: 0,
    failed: 0,
  }

  for (const criterion of criteria) {
    const statusType = criterion.status.type
    if (statusType in counts) {
      counts[statusType as keyof typeof counts]++
    }
  }

  // Only show statuses that have criteria
  const statusesToShow = (Object.keys(counts) as Array<keyof typeof counts>).filter(
    status => counts[status] > 0
  )

  return (
    <div className="space-y-1">
      {/* Total count */}
      <div className="flex items-center gap-2 text-sm">
        <span className="font-semibold text-text-primary">Total:</span>
        <span className="text-text-secondary">{criteria.length}</span>
      </div>

      {/* Status breakdown */}
      <div className="space-y-1">
        {statusesToShow.map(status => {
          const config = statusConfig[status]
          return (
            <div key={status} className="flex items-center gap-2 text-sm">
              <span className={`${config.color} ${config.animate ? 'animate-pulse' : ''} text-sm leading-tight`}>
                {config.icon}
              </span>
              <span className="text-text-muted">{config.label}:</span>
              <span className="text-text-primary font-medium">{counts[status]}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
})
