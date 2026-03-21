import { useState } from 'react'
import { useSessionStats } from '../../hooks/useSessionStats'
import { formatTime, formatSpeed } from '../../lib/format-stats'
import { StatsModal } from './StatsModal'
import type { Message } from '../../../src/shared/types.js'

interface SummaryDisplayProps {
  summary: string | null
  messages: Message[]
}

export function SummaryDisplay({ summary, messages }: SummaryDisplayProps) {
  const [showStatsModal, setShowStatsModal] = useState(false)
  const stats = useSessionStats(messages)
  
  return (
    <div className="flex flex-col h-full">
      {/* AI Stats at the top */}
      {stats && (
        <div className="mb-4">
          <button
            onClick={() => setShowStatsModal(true)}
            className="w-full flex items-center justify-between px-3 py-2 rounded bg-bg-tertiary hover:bg-bg-secondary transition-colors group"
            title="View detailed response and call-level stats"
          >
            <span className="text-xs font-semibold text-text-muted">AI Stats</span>
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span className="text-text-secondary">{formatTime(stats.aiTime)}</span>
              <span className="w-px h-3 bg-border" />
              <span className="text-text-secondary">{formatSpeed(stats.avgPrefillSpeed)}</span>
              <span>pp</span>
              <span className="w-px h-3 bg-border" />
              <span className="text-text-secondary">{formatSpeed(stats.avgGenerationSpeed)}</span>
              <span>tg</span>
              <span className="opacity-0 group-hover:opacity-100 transition-opacity">▼</span>
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
      </div>
    </div>
  )
}
