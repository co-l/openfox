import type { Criterion } from '@shared/types.js'

interface CriteriaEditorProps {
  criteria: Criterion[]
}

export function CriteriaEditor({ criteria }: CriteriaEditorProps) {
  const getStatusIcon = (status: Criterion['status']) => {
    switch (status.type) {
      case 'passed':
        return <span className="text-accent-success text-sm">✓</span>
      case 'completed':
        return <span className="text-purple-400 text-sm">◉</span>
      case 'failed':
        return <span className="text-accent-error text-sm">✗</span>
      case 'in_progress':
        return <span className="text-accent-warning text-sm animate-pulse">●</span>
      default:
        return <span className="text-text-muted text-sm">○</span>
    }
  }
  
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-text-primary">Criteria</h3>
        <span className="text-sm text-text-muted">
          {criteria.filter(c => c.status.type === 'passed').length}/{criteria.length}
        </span>
      </div>
      
      <div className="flex-1 overflow-y-auto space-y-1">
        {criteria.length === 0 ? (
          <div className="text-text-muted text-sm text-center py-2">
            No criteria yet
          </div>
        ) : (
          criteria.map((criterion, index) => (
            <div
              key={criterion.id}
              className="bg-bg-tertiary rounded p-2 border border-border"
            >
              <div className="flex items-start gap-1.5">
                <span className="text-text-muted text-sm">{index + 1}.</span>
                {getStatusIcon(criterion.status)}
                <p className="flex-1 text-sm leading-tight">{criterion.description}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
