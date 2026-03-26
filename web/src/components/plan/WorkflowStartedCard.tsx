import { memo } from 'react'
import { useWorkflowsStore } from '../../stores/workflows'

interface WorkflowStartedData {
  workflowName: string
  workflowId: string
  workflowColor?: string
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

export const WorkflowStartedCard = memo(function WorkflowStartedCard({ data }: { data: WorkflowStartedData }) {
  const workflows = useWorkflowsStore(state => state.workflows)
  const color = workflows.find(w => w.id === data.workflowId)?.color ?? data.workflowColor ?? '#6b7280'

  return (
    <div
      className="feed-item flex items-center gap-2 px-3 py-2 rounded border"
      style={{ borderColor: hexToRgba(color, 0.3), backgroundColor: hexToRgba(color, 0.08) }}
    >
      <svg className="w-3 h-3 shrink-0" fill={color} viewBox="0 0 24 24">
        <path d="M8 5v14l11-7z" />
      </svg>
      <span className="text-sm font-medium" style={{ color }}>{data.workflowName}</span>
      <span className="text-text-muted text-sm">started</span>
    </div>
  )
})
