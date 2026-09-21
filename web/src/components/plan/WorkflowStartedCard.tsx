import { memo } from 'react'
import { useT } from '../../hooks/useT'
import { useWorkflows } from '../../hooks/useWorkflows'
import { useSessionWorkdir } from '../../hooks/useSessionWorkdir'
import { resolveEffectiveWorkflow } from '../../lib/workflow-scope'
import { PlayIcon } from '../shared/icons'
import { hexToRgba } from '../../lib/colors'

interface WorkflowStartedData {
  workflowName: string
  workflowId: string
  workflowColor?: string
}

export const WorkflowStartedCard = memo(function WorkflowStartedCard({ data }: { data: WorkflowStartedData }) {
  const t = useT()
  const { workflows } = useWorkflows(useSessionWorkdir())
  const color = resolveEffectiveWorkflow(workflows, data.workflowId)?.color ?? data.workflowColor ?? '#6b7280'

  return (
    <div
      className="feed-item flex items-center gap-2 px-3 py-2 rounded border"
      style={{ borderColor: hexToRgba(color, 0.3), backgroundColor: hexToRgba(color, 0.08) }}
    >
      <PlayIcon className="w-3 h-3 shrink-0" color={color} />
      <span className="text-sm font-medium" style={{ color }}>
        {data.workflowName}
      </span>
      <span className="text-text-muted text-sm">{t({ en: 'started', fr: 'démarré' })}</span>
    </div>
  )
})
