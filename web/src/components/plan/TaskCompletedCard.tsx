import { memo } from 'react'
import type { TaskCompletedPayload } from '@shared/protocol.js'
import { useWorkflowsStore } from '../../stores/workflows'
import { hexToRgba } from '../../lib/colors'
import { TaskCheckIcon } from '../shared/icons'

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

export const TaskCompletedCard = memo(function TaskCompletedCard({ data }: TaskCompletedCardProps) {
  const workflowDefaults = useWorkflowsStore(state => state.defaults)
  const workflowUserItems = useWorkflowsStore(state => state.userItems)
  const workflows = [...workflowDefaults, ...workflowUserItems]
  const color = workflows.find(w => w.id === data.workflowId)?.color ?? data.workflowColor ?? '#8b949e'

  return (
    <div
      className="feed-item rounded p-3 border"
      style={{ borderColor: hexToRgba(color, 0.3), backgroundColor: hexToRgba(color, 0.08) }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <TaskCheckIcon color={color} />
        <span className="text-sm font-medium" style={{ color }}>{data.workflowName ?? 'Task Completed'}</span>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        <Stat label="Iterations" value={String(data.iterations)} />
        <Stat label="Total time" value={formatTime(data.totalTimeSeconds)} />
        <Stat label="Tool calls" value={String(data.totalToolCalls)} />
        <Stat label="Tokens" value={formatTokens(data.totalTokensGenerated)} />
        <Stat label="Speed" value={data.avgGenerationSpeed > 0 ? `${data.avgGenerationSpeed} tok/s` : '-'} />
      </div>
    </div>
  )
})

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-primary/50 rounded px-2 py-1">
      <div className="text-sm text-text-muted">{label}</div>
      <div className="text-sm text-text-primary font-medium">{value}</div>
    </div>
  )
}
