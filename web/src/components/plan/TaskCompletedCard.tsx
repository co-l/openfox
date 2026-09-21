import { memo } from 'react'
import type { TaskCompletedPayload } from '@shared/protocol.js'
import { useWorkflows } from '../../hooks/useWorkflows'
import { useSessionWorkdir } from '../../hooks/useSessionWorkdir'
import { resolveEffectiveWorkflow } from '../../lib/workflow-scope'
import { hexToRgba } from '../../lib/colors'
import { TaskCheckIcon } from '../shared/icons'
import { formatTime } from '../../lib/format-stats'
import { useT } from '../../hooks/useT'

interface TaskCompletedCardProps {
  data: TaskCompletedPayload
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export const TaskCompletedCard = memo(function TaskCompletedCard({ data }: TaskCompletedCardProps) {
  const { workflows } = useWorkflows(useSessionWorkdir())
  const t = useT()
  const color =
    (data.workflowId ? resolveEffectiveWorkflow(workflows, data.workflowId)?.color : undefined) ??
    data.workflowColor ??
    '#8b949e'

  return (
    <div
      data-testid="task-completed-card"
      className="feed-item rounded p-3 border"
      style={{ borderColor: hexToRgba(color, 0.3), backgroundColor: hexToRgba(color, 0.08) }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <TaskCheckIcon color={color} />
        <span className="text-sm font-medium" style={{ color }}>
          {data.workflowName ?? t({ en: 'Task Completed', fr: 'Tâche terminée' })}
        </span>
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
