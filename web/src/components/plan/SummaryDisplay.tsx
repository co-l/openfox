import { useState } from 'react'
import { useSessionStats } from '../../hooks/useSessionStats'
import { useCurrentBranch } from '../../hooks/useCurrentBranch'
import { useSessionStore } from '../../stores/session'
import { formatTime, formatSpeed } from '../../lib/format-stats'
import { StatsModal } from './StatsModal'
import { CriteriaProgressSummary } from '../shared/CriteriaProgressSummary'
import type { Message } from '@shared/types.js'

interface SummaryDisplayProps {
  summary: string | null
  messages: Message[]
  workdir?: string
}

export function SummaryDisplay({ summary, messages, workdir }: SummaryDisplayProps) {
  const [showStatsModal, setShowStatsModal] = useState(false)
  const stats = useSessionStats(messages)
  const { branch } = useCurrentBranch(workdir)
  const session = useSessionStore(state => state.currentSession)

  return (
    <div className="flex flex-col h-full">
      {/* AI Stats at the top */}
      {stats && (
        <div className="mb-4">
          <button
            onClick={() => setShowStatsModal(true)}
            className="w-full flex items-center justify-center px-3 py-2 rounded bg-bg-tertiary hover:bg-bg-secondary transition-colors"
            title="View detailed response and call-level stats"
          >
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <span className="text-text-secondary">{formatTime(stats.aiTime)}</span>
              <span className="w-px h-3 bg-border" />
              <span className="text-text-secondary">{formatSpeed(stats.avgPrefillSpeed)}</span>
              <span>pp</span>
              <span className="w-px h-3 bg-border" />
              <span className="text-text-secondary">{formatSpeed(stats.avgGenerationSpeed)}</span>
              <span>tg</span>
            </div>
          </button>
          
          {/* Stats Modal */}
          <StatsModal
            isOpen={showStatsModal}
            onClose={() => setShowStatsModal(false)}
            stats={stats}
          />
        </div>
      )}
      
      {/* Summary section */}
      <div className="flex flex-col flex-1 overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-text-primary">Summary</h3>
        </div>
        
        {summary ? (
          <p className="text-sm text-text-primary leading-relaxed">{summary}</p>
        ) : (
          <div className="text-text-muted text-sm text-center py-2">
            No summary yet
          </div>
        )}

        {/* Progress section */}
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-text-primary mb-2">Progress</h3>
          <CriteriaProgressSummary criteria={session?.criteria ?? []} />
        </div>
      </div>

      {/* Branch info footer */}
      {branch && (
        <div className="mt-4 pt-3 border-t border-border flex items-center gap-2 text-xs text-text-muted">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M11.5 7V4a1 1 0 011 1v14a1 1 0 01-1-1v-3c-1.65 0-3.15.5-4.5 1.5V19a1 1 0 01-1-1V5a1 1 0 011 1v3c1.35-1 2.85-1.5 4.5-1.5zm6 0a1 1 0 011 1v11a1 1 0 01-1 1v-3c-1.65 0-3.15.5-4.5 1.5V19a1 1 0 01-1-1V5a1 1 0 011 1v3c1.35-1 2.85-1.5 4.5-1.5z"
              clipRule="evenodd"
            />
          </svg>
          <span className="truncate">{branch}</span>
        </div>
      )}
    </div>
  )
}
