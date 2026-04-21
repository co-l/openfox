import { useState } from 'react'
import { useSessionStats } from '../../hooks/useSessionStats'
import { useCurrentBranch } from '../../hooks/useCurrentBranch'
import { useConfigStore } from '../../stores/config'
import { useSessionStore } from '../../stores/session'
import { formatTime, formatSpeed } from '../../lib/format-stats'
import { StatsModal } from './StatsModal'
import { CriteriaProgressSummary } from '../shared/CriteriaProgressSummary'
import { DevServerFooter } from './DevServerFooter'
import { BackgroundProcesses } from './BackgroundProcesses'
import { BranchIcon } from '../shared/icons'
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
  const version = useConfigStore(state => state.version)
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

      {/* Git branch — above separator */}
      {branch && (
        <div className="mt-4 flex items-center gap-2 text-sm">
          <BranchIcon />
          <span className="truncate text-text-secondary" title={branch}>{branch}</span>
        </div>
      )}

      {/* Dev Server — below separator */}
      <DevServerFooter workdir={workdir} />

      {/* Background Processes */}
      <BackgroundProcesses sessionId={session?.id} />

      {/* Version footer */}
      {version && (
        <div className="mt-4 pt-4 border-t border-border text-center text-xs text-text-muted">
          <a
            href="https://github.com/co-l/openfox"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-accent-primary transition-colors"
          >
            OpenFox
          </a>
          {' - '}
          <span>v{version}</span>
        </div>
      )}
    </div>
  )
}
