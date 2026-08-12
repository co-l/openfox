import { memo } from 'react'
import type { ReactNode } from 'react'
import type { ToolCall, MetadataEntry } from '@shared/types.js'
import { Markdown } from './Markdown'
import { MetadataStatusIcon } from './MetadataStatusIcon'
import { formatMetadataKeyLabel } from '../../lib/metadata-keys'

interface CriteriaGroupDisplayProps {
  toolCalls: ToolCall[]
  criteria?: MetadataEntry[] // For looking up criterion descriptions by ID
}

type CriterionMutation = 'add' | 'update' | 'remove' | 'complete' | 'pass' | 'fail'

const actionConfig: Record<CriterionMutation, { icon: string; color: string }> = {
  add: { icon: '○', color: 'text-text-muted' },
  update: { icon: '○', color: 'text-text-muted' },
  remove: { icon: '○', color: 'text-text-muted' },
  complete: { icon: '◉', color: 'text-purple-400' },
  pass: { icon: '✓', color: 'text-accent-success' },
  fail: { icon: '✗', color: 'text-accent-error' },
}

// Actions that read metadata instead of mutating an item. Their result output
// is rendered directly rather than forced into an item row.
const READ_ACTIONS = new Set(['get', 'list', 'schema'])

interface DisplayCriterion {
  id: string
  description: string
}

interface DisplayRow {
  key: string
  node: ReactNode
}

export const CriteriaGroupDisplay = memo(function CriteriaGroupDisplay({
  toolCalls,
  criteria,
}: CriteriaGroupDisplayProps) {
  if (toolCalls.length === 0) return null

  // Build a map for fast criterion lookup by ID
  const criteriaMap = new Map(criteria?.map((c) => [c.id, c]) ?? [])

  const isSessionMetadata = toolCalls.some((tc) => tc.name === 'session_metadata')

  // Expand each tool call into one or more display rows, preserving order
  const rows = toolCalls.flatMap((tc) =>
    READ_ACTIONS.has(String(tc.arguments['action'])) ? readRows(tc) : [itemRow(tc, criteriaMap)],
  )

  const headerTitle = (() => {
    if (!isSessionMetadata) return 'Acceptance Criteria'
    const keys = new Set(toolCalls.map((tc) => tc.arguments['key'] as string | undefined).filter(Boolean))
    if (keys.size === 1) {
      const key = keys.values().next().value
      return key ? formatMetadataKeyLabel(key) : 'Session Data'
    }
    return 'Session Data'
  })()

  return (
    <div className="my-1 rounded border border-border bg-secondary overflow-hidden">
      {/* Header */}
      <div className="px-2 py-1.5 border-b border-border bg-secondary">
        <span className="text-xs font-medium text-text-muted">{headerTitle}</span>
      </div>

      {/* Criteria list */}
      <div className="bg-primary">
        {rows.map((row, index) => (
          <div
            key={row.key}
            className={`flex items-start gap-2 px-2 py-1.5 ${index > 0 ? 'border-t border-border' : ''}`}
          >
            {row.node}
          </div>
        ))}
      </div>
    </div>
  )
})

function itemRow(tc: ToolCall, criteriaMap: Map<string, MetadataEntry>): DisplayRow {
  return {
    key: tc.id,
    node: <SingleCriterionRow tc={tc} criteriaMap={criteriaMap} />,
  }
}

// Expand a read-style session_metadata call (get/list/schema) into display
// rows. Result output is shown directly instead of being shoehorned into an
// item row; failed or output-less reads still leave a trace.
function readRows(tc: ToolCall): DisplayRow[] {
  const output = tc.result?.output

  if (tc.result && !tc.result.success) {
    return [
      {
        key: `${tc.id}-error`,
        node: <span className="text-text-muted text-sm">{tc.result.error ?? 'Read failed.'}</span>,
      },
    ]
  }

  if (!tc.result?.success || !output) {
    return [
      {
        key: `${tc.id}-empty`,
        node: <span className="text-text-muted text-sm">No output.</span>,
      },
    ]
  }

  if (tc.arguments['action'] === 'get') {
    try {
      const parsed: unknown = JSON.parse(output)
      if (Array.isArray(parsed)) {
        return parsed.map((entry, idx) => ({
          key: `${tc.id}-${idx}`,
          node: (
            <>
              <span className="text-text-muted text-sm leading-tight flex-shrink-0">○</span>
              <div className="flex-1 min-w-0">
                <Markdown content={`[${(entry as DisplayCriterion).id}] ${(entry as DisplayCriterion).description}`} />
              </div>
            </>
          ),
        }))
      }
    } catch {
      // Not JSON — fall through to raw output below
    }
  }

  if (tc.arguments['action'] === 'schema') {
    const key = tc.arguments['key'] as string | undefined
    return [
      {
        key: tc.id,
        node: (
          <>
            <span className="text-accent-success text-sm leading-tight flex-shrink-0">✓</span>
            <div className="flex-1 min-w-0 text-sm">
              {key ? `Schema loaded for '${key}' metadata` : 'Schema loaded.'}
            </div>
          </>
        ),
      },
    ]
  }

  return [
    {
      key: tc.id,
      node: (
        <>
          <span className="text-text-muted text-sm leading-tight flex-shrink-0">○</span>
          <div className="flex-1 min-w-0">
            <Markdown content={output} />
          </div>
        </>
      ),
    },
  ]
}

interface SingleCriterionRowProps {
  tc: ToolCall
  criteriaMap: Map<string, MetadataEntry>
}

function SingleCriterionRow({ tc, criteriaMap }: SingleCriterionRowProps) {
  const action = tc.arguments['action'] as CriterionMutation | undefined
  const args = tc.arguments

  const isSessionMetadata = tc.name === 'session_metadata'
  const isRemoved = action === 'remove'
  const criterionId = args['id'] as string | undefined
  const argDescription = args['description'] as string | undefined
  const lookedUpCriterion = criterionId ? criteriaMap.get(criterionId) : undefined

  const actionPastTense: Partial<Record<CriterionMutation, string>> = {
    add: 'Added',
    update: 'Updated',
    remove: 'Removed',
    complete: 'Completed',
    pass: 'Passed',
    fail: 'Failed',
  }
  const fallback = isSessionMetadata ? `${(action && actionPastTense[action]) ?? 'Managed'} item` : 'Criterion updated'
  const displayText =
    argDescription ?? lookedUpCriterion?.description ?? (isRemoved && criterionId ? `[${criterionId}]` : fallback)

  const reason = args['reason'] as string | undefined
  const isFailed = action === 'fail'

  return (
    <>
      {isSessionMetadata ? (
        <MetadataStatusIcon status={args['status'] as string} className="text-sm leading-tight flex-shrink-0" />
      ) : (
        (() => {
          const config = action && actionConfig[action] ? actionConfig[action] : { icon: '○', color: 'text-text-muted' }
          return <span className={`${config.color} text-sm leading-tight flex-shrink-0`}>{config.icon}</span>
        })()
      )}
      <div className="flex-1 min-w-0">
        <div className={isRemoved ? 'line-through text-text-muted' : ''}>
          <Markdown content={displayText} />
        </div>

        {/* Show reason for complete/pass/fail */}
        {reason && (
          <div className={`mt-1 text-sm ${isFailed ? 'text-accent-error' : 'text-text-muted'}`}>
            <span className="text-text-muted">└ </span>"{reason}"
          </div>
        )}
      </div>
    </>
  )
}

// Type guard to check if a tool name is a criterion tool
export function isCriterionTool(tool: string): boolean {
  return tool === 'criterion' || tool === 'session_metadata'
}
