import { memo } from 'react'
import type { TaskCompletedPayload } from '@shared/protocol.js'

interface TaskCompletedCardProps {
  data: TaskCompletedPayload
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'passed') {
    return (
      <svg className="w-3.5 h-3.5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    )
  }
  if (status === 'failed') {
    return (
      <svg className="w-3.5 h-3.5 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    )
  }
  return (
    <svg className="w-3.5 h-3.5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  )
}

export const TaskCompletedCard = memo(function TaskCompletedCard({ data }: TaskCompletedCardProps) {
  return (
    <div className="feed-item bg-emerald-500/10 border border-emerald-500/30 rounded p-3">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-emerald-400 text-sm font-medium">Task Completed</span>
      </div>

      {/* Summary */}
      {data.summary && (
        <p className="text-text-secondary text-xs mb-3 leading-relaxed">{data.summary}</p>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-3">
        <Stat label="Prompts" value={String(data.responseCount)} />
        <Stat label="Total time" value={formatTime(data.totalTimeSeconds)} />
        <Stat label="Tool calls" value={String(data.totalToolCalls)} />
        <Stat label="Tokens" value={formatTokens(data.totalTokensGenerated)} />
        <Stat label="Speed" value={data.avgGenerationSpeed > 0 ? `${data.avgGenerationSpeed} tok/s` : '-'} />
      </div>

      {/* Acceptance criteria */}
      {data.criteria.length > 0 && (
        <div className="border-t border-emerald-500/20 pt-2">
          <div className="text-[10px] text-text-muted uppercase tracking-wide mb-1.5">Acceptance Criteria</div>
          <ul className="space-y-1">
            {data.criteria.map(c => (
              <li key={c.id} className="flex items-start gap-1.5 text-xs text-text-secondary">
                <StatusIcon status={c.status} />
                <span>{c.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
})

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-primary/50 rounded px-2 py-1">
      <div className="text-[10px] text-text-muted">{label}</div>
      <div className="text-xs text-text-primary font-medium">{value}</div>
    </div>
  )
}
