import { useState } from 'react'
import type { Criterion } from '@openfox/shared'
import { Button } from '../shared/Button'

interface CriteriaEditorProps {
  criteria: Criterion[]
  editable: boolean
  onUpdate: (criteria: Criterion[]) => void
  onAccept: () => void
}

export function CriteriaEditor({ criteria, editable, onUpdate, onAccept }: CriteriaEditorProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  
  const startEdit = (criterion: Criterion) => {
    setEditingId(criterion.id)
    setEditValue(criterion.description)
  }
  
  const saveEdit = () => {
    if (!editingId) return
    
    onUpdate(
      criteria.map(c =>
        c.id === editingId ? { ...c, description: editValue } : c
      )
    )
    setEditingId(null)
    setEditValue('')
  }
  
  const removeCriterion = (id: string) => {
    onUpdate(criteria.filter(c => c.id !== id))
  }
  
  const addCriterion = () => {
    const newCriterion: Criterion = {
      id: `criterion-${Date.now()}`,
      description: 'New criterion',
      status: { type: 'pending' },
      attempts: [],
    }
    onUpdate([...criteria, newCriterion])
    startEdit(newCriterion)
  }
  
  const getStatusIcon = (status: Criterion['status']) => {
    switch (status.type) {
      case 'passed':
        return <span className="text-accent-success text-base">✓</span>
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
                
                {editingId === criterion.id ? (
                  <div className="flex-1">
                    <textarea
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="w-full bg-bg-secondary border border-border rounded p-2 text-sm resize-none"
                      rows={3}
                      autoFocus
                    />
                    <div className="flex gap-2 mt-2">
                      <Button size="sm" variant="primary" onClick={saveEdit}>
                        Save
                      </Button>
                      <Button size="sm" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1">
                    <p className="text-sm leading-relaxed">{criterion.description}</p>
                    {editable && (
                      <div className="flex items-center gap-3 mt-1.5">
                        <button
                          className="text-xs text-text-muted hover:text-text-primary"
                          onClick={() => startEdit(criterion)}
                        >
                          Edit
                        </button>
                        <button
                          className="text-xs text-accent-error/70 hover:text-accent-error"
                          onClick={() => removeCriterion(criterion.id)}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      
      {editable && (
        <div className="mt-3 pt-3 border-t border-border space-y-2">
          <Button
            size="sm"
            className="w-full"
            onClick={addCriterion}
          >
            + Add Criterion
          </Button>
          <Button
            variant="primary"
            className="w-full"
            onClick={onAccept}
            disabled={criteria.length === 0}
          >
            Accept & Start Execution
          </Button>
        </div>
      )}
    </div>
  )
}
