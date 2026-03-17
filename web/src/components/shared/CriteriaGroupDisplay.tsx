import { memo } from 'react'
import type { ToolCall, Criterion } from '../../../src/shared/types.js'

interface CriteriaGroupDisplayProps {
  toolCalls: ToolCall[]
  criteria?: Criterion[]  // For looking up criterion descriptions by ID
}

type CriterionTool = 
  | 'add_criterion'
  | 'update_criterion'
  | 'remove_criterion'
  | 'complete_criterion'
  | 'pass_criterion'
  | 'fail_criterion'

const toolConfig: Record<CriterionTool, { icon: string; color: string }> = {
  add_criterion: { icon: '○', color: 'text-text-muted' },
  update_criterion: { icon: '○', color: 'text-text-muted' },
  remove_criterion: { icon: '○', color: 'text-text-muted' },
  complete_criterion: { icon: '◉', color: 'text-purple-400' },
  pass_criterion: { icon: '✓', color: 'text-accent-success' },
  fail_criterion: { icon: '✗', color: 'text-accent-error' },
}

export const CriteriaGroupDisplay = memo(function CriteriaGroupDisplay({ toolCalls, criteria }: CriteriaGroupDisplayProps) {
  if (toolCalls.length === 0) return null

  // Build a map for fast criterion lookup by ID
  const criteriaMap = new Map(criteria?.map(c => [c.id, c]) ?? [])

  return (
    <div className="my-1 rounded border border-border bg-bg-tertiary overflow-hidden">
      {/* Header */}
      <div className="px-2 py-1.5 border-b border-border bg-bg-secondary">
        <span className="text-xs font-medium text-text-muted">Acceptance Criteria</span>
      </div>
      
      {/* Criteria list */}
      <div>
        {toolCalls.map((tc, index) => {
          const tool = tc.name as CriterionTool
          const config = toolConfig[tool] ?? { icon: '○', color: 'text-text-muted' }
          const args = tc.arguments
          
          // Get description from args (add_criterion) or look up by ID (complete/pass/fail)
          const criterionId = args['id'] as string | undefined
          const argDescription = args['description'] as string | undefined
          const lookedUpCriterion = criterionId ? criteriaMap.get(criterionId) : undefined
          const displayText = argDescription ?? lookedUpCriterion?.description ?? 'Criterion updated'
          
          const reason = args['reason'] as string | undefined
          const isRemoved = tool === 'remove_criterion'
          const isFailed = tool === 'fail_criterion'
          
          return (
            <div
              key={tc.id ?? index}
              className={`flex items-start gap-2 px-2 py-1.5 ${
                index > 0 ? 'border-t border-border' : ''
              }`}
            >
              <span className={`${config.color} text-sm leading-tight flex-shrink-0`}>
                {config.icon}
              </span>
              <div className="flex-1 min-w-0">
                <span className={`text-sm leading-tight ${
                  isRemoved ? 'line-through text-text-muted' : 'text-text-primary'
                }`}>
                  {displayText}
                </span>
                
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
        })}
      </div>
    </div>
  )
})

// Type guard to check if a tool name is a criterion tool
export function isCriterionTool(tool: string): tool is CriterionTool {
  return [
    'add_criterion',
    'update_criterion', 
    'remove_criterion',
    'complete_criterion',
    'pass_criterion',
    'fail_criterion',
  ].includes(tool)
}
