import type { Criterion } from '@openfox/shared'

interface CriteriaEditorProps {
  criteria: Criterion[]
}

export function CriteriaEditor({ criteria }: CriteriaEditorProps) {
  const getStatusIcon = (status: Criterion['status']) => {
    switch (status.type) {
      case 'passed':
        return <span className="text-accent-success text-base">✓</span>
      case 'completed':
        return <span className="text-purple-400 text-base">◉</span>
      case 'failed':
        return <span className="text-accent-error text-base">✗</span>
      case 'in_progress':
        return <span className="text-accent-warning text-base animate-pulse">●</span>
      default:
        return <span className="text-text-muted text-base">○</span>
    }
  }
  
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-text-primary">Acceptance Criteria</h3>
        <span className="text-sm text-text-muted">
          {criteria.filter(c => c.status.type === 'passed').length}/{criteria.length} done
        </span>
      </div>
      
      <div className="flex-1 overflow-y-auto space-y-2">
        {criteria.length === 0 ? (
          <div className="text-text-muted text-sm text-center py-4">
            No criteria yet. Start chatting to generate them.
          </div>
        ) : (
          criteria.map((criterion, index) => (
            <div
              key={criterion.id}
              className="bg-bg-tertiary rounded-lg p-3 border border-border"
            >
              <div className="flex items-start gap-2">
                <span className="text-text-muted text-sm">{index + 1}.</span>
                {getStatusIcon(criterion.status)}
                <p className="flex-1 text-sm leading-relaxed">{criterion.description}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
