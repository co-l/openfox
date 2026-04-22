import { memo } from 'react'
import type { ToolCall, Criterion } from '@shared/types.js'
import { Markdown } from './Markdown'

interface CriteriaGroupDisplayProps {
  toolCalls: ToolCall[]
  criteria?: Criterion[]  // For looking up criterion descriptions by ID
}

type CriterionAction = 'add' | 'update' | 'remove' | 'complete' | 'pass' | 'fail' | 'get'

const actionConfig: Record<CriterionAction, { icon: string; color: string }> = {
  add: { icon: '○', color: 'text-text-muted' },
  update: { icon: '○', color: 'text-text-muted' },
  remove: { icon: '○', color: 'text-text-muted' },
  complete: { icon: '◉', color: 'text-purple-400' },
  pass: { icon: '✓', color: 'text-accent-success' },
  fail: { icon: '✗', color: 'text-accent-error' },
  get: { icon: '○', color: 'text-text-muted' },
}

interface DisplayCriterion {
  id: string
  description: string
}

export const CriteriaGroupDisplay = memo(function CriteriaGroupDisplay({ toolCalls, criteria }: CriteriaGroupDisplayProps) {
  if (toolCalls.length === 0) return null

  // Build a map for fast criterion lookup by ID
  const criteriaMap = new Map(criteria?.map(c => [c.id, c]) ?? [])

  const getAction = toolCalls.find(tc => tc.arguments['action'] === 'get' && tc.result?.success && tc.result?.output)

  return (
    <div className="my-1 rounded border border-border bg-secondary overflow-hidden">
      {/* Header */}
      <div className="px-2 py-1.5 border-b border-border bg-secondary">
        <span className="text-xs font-medium text-text-muted">Acceptance Criteria</span>
      </div>
      
      {/* Criteria list */}
      <div className="bg-primary">
        {getAction ? (
          (() => {
            const output = getAction.result!.output!
            if (output === 'No criteria defined yet.') {
              return (
                <div className="flex items-start gap-2 px-2 py-1.5">
                  <span className="text-text-muted text-sm leading-tight flex-shrink-0">○</span>
                  <div className="flex-1 min-w-0 text-text-muted text-sm">
                    No criteria defined yet.
                  </div>
                </div>
              )
            }
            try {
              const resultCriteria: DisplayCriterion[] = JSON.parse(output)
              return resultCriteria.map((c, idx) => (
                <div key={c.id ?? idx} className={`flex items-start gap-2 px-2 py-1.5 ${idx > 0 ? 'border-t border-border' : ''}`}>
                  <span className="text-text-muted text-sm leading-tight flex-shrink-0">○</span>
                  <div className="flex-1 min-w-0">
                    <Markdown content={`[${c.id}] ${c.description}`} />
                  </div>
                </div>
              ))
            } catch {
              return toolCalls.map((tc, index) => <SingleCriterionRow key={tc.id ?? index} tc={tc} index={index} criteriaMap={criteriaMap} />)
            }
          })()
        ) : (
          toolCalls.map((tc, index) => (
            <SingleCriterionRow key={tc.id ?? index} tc={tc} index={index} criteriaMap={criteriaMap} />
          ))
        )}
      </div>
    </div>
  )
})

interface SingleCriterionRowProps {
  tc: ToolCall
  index: number
  criteriaMap: Map<string, Criterion>
}

function SingleCriterionRow({ tc, index, criteriaMap }: SingleCriterionRowProps) {
  const action = tc.arguments['action'] as CriterionAction | undefined
  const config = action && actionConfig[action] ? actionConfig[action] : { icon: '○', color: 'text-text-muted' }
  const args = tc.arguments
  
  const isRemoved = action === 'remove'
  const criterionId = args['id'] as string | undefined
  const argDescription = args['description'] as string | undefined
  const lookedUpCriterion = criterionId ? criteriaMap.get(criterionId) : undefined
  const displayText = argDescription ?? lookedUpCriterion?.description ?? (isRemoved && criterionId ? `[${criterionId}]` : 'Criterion updated')
  
  const reason = args['reason'] as string | undefined
  const isFailed = action === 'fail'
  
  return (
    <div
      className={`flex items-start gap-2 px-2 py-1.5 ${index > 0 ? 'border-t border-border' : ''}`}
    >
      <span className={`${config.color} text-sm leading-tight flex-shrink-0`}>
        {config.icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className={isRemoved ? 'line-through text-text-muted' : ''}>
          <Markdown content={displayText} />
        </div>
        
        {/* Show reason for complete/pass/fail */}
        {reason && (
          <div className={`mt-1 text-sm ${isFailed ? 'text-accent-error' : 'text-text-muted'}`}>
            <span className="text-text-muted">└ </span>
            "{reason}"
          </div>
        )}
      </div>
    </div>
  )
}

// Type guard to check if a tool name is a criterion tool
export function isCriterionTool(tool: string): boolean {
  return tool === 'criterion'
}
