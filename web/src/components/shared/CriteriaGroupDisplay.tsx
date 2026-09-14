import { memo } from 'react'
import type { ReactNode } from 'react'
import type { ToolCall, MetadataEntry, PreparingToolCall } from '@shared/types.js'
import { Markdown } from './Markdown'
import { MetadataStatusIcon } from './MetadataStatusIcon'
import { formatMetadataKeyLabel } from '../../lib/metadata-keys'
import { parseSessionMetadataArgs, isMetadataAddPreparing } from '../../lib/session-metadata'
import { useT } from '../../hooks/useT'
import type { Translation } from '@shared/i18n/index.js'

interface CriteriaGroupDisplayProps {
  toolCalls: ToolCall[]
  /** In-flight session_metadata "add" calls, rendered as live rows while streaming. */
  preparing?: PreparingToolCall[]
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
  preparing,
  criteria,
}: CriteriaGroupDisplayProps) {
  const t = useT()

  // In-flight metadata adds render as live rows (pulsing status icon)
  const preparingAdds = (preparing ?? [])
    .filter(isMetadataAddPreparing)
    .map((ptc) => ({ ptc, parsed: parseSessionMetadataArgs(ptc.arguments) }))
    .filter((p): p is { ptc: PreparingToolCall; parsed: NonNullable<ReturnType<typeof parseSessionMetadataArgs>> } =>
      Boolean(p.parsed),
    )

  if (toolCalls.length === 0 && preparingAdds.length === 0) return null

  // Build a map for fast criterion lookup by ID
  const criteriaMap = new Map(criteria?.map((c) => [c.id, c]) ?? [])

  const isSessionMetadata = toolCalls.some((tc) => tc.name === 'session_metadata') || preparingAdds.length > 0

  // Expand each tool call into one or more display rows, preserving order
  const rows = toolCalls.flatMap((tc) =>
    READ_ACTIONS.has(String(tc.arguments['action'])) ? readRows(tc, t) : [itemRow(tc, criteriaMap, t)],
  )
  for (const add of preparingAdds) {
    rows.push(preparingRow(add.ptc, add.parsed))
  }

  const headerTitle = (() => {
    if (!isSessionMetadata) return t({ en: 'Acceptance Criteria', fr: 'Critères d’acceptation' })
    const keys = new Set([
      ...toolCalls.map((tc) => tc.arguments['key'] as string | undefined).filter(Boolean),
      ...preparingAdds.map((p) => p.parsed.key),
    ])
    if (keys.size === 1) {
      const key = keys.values().next().value
      return key ? formatMetadataKeyLabel(key) : t({ en: 'Session Data', fr: 'Données de session' })
    }
    return t({ en: 'Session Data', fr: 'Données de session' })
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

function itemRow(tc: ToolCall, criteriaMap: Map<string, MetadataEntry>, t: TFunc): DisplayRow {
  return {
    key: tc.id,
    node: <SingleCriterionRow tc={tc} criteriaMap={criteriaMap} t={t} />,
  }
}

// Live row for an in-flight session_metadata "add": same layout as a completed
// add row, with a pulsing status icon to signal it is still streaming.
function preparingRow(
  ptc: PreparingToolCall,
  parsed: NonNullable<ReturnType<typeof parseSessionMetadataArgs>>,
): DisplayRow {
  return {
    key: `preparing-${ptc.index}`,
    node: (
      <>
        <MetadataStatusIcon status="pending" className="text-sm leading-tight flex-shrink-0 animate-pulse" />
        <div className="flex-1 min-w-0">
          <Markdown content={parsed.description ?? ''} />
        </div>
      </>
    ),
  }
}

type TFunc = (tx: Translation, vars?: Record<string, string | number>) => string

// Expand a read-style session_metadata call (get/list/schema) into display
// rows. Result output is shown directly instead of being shoehorned into an
// item row; failed or output-less reads still leave a trace.
function readRows(tc: ToolCall, t: TFunc): DisplayRow[] {
  const output = tc.result?.output

  if (tc.result && !tc.result.success) {
    return [
      {
        key: `${tc.id}-error`,
        node: (
          <span className="text-text-muted text-sm">
            {tc.result.error ?? t({ en: 'Read failed.', fr: 'Lecture impossible.' })}
          </span>
        ),
      },
    ]
  }

  if (!tc.result?.success || !output) {
    return [
      {
        key: `${tc.id}-empty`,
        node: <span className="text-text-muted text-sm">{t({ en: 'No output.', fr: 'Aucune sortie.' })}</span>,
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
              {key
                ? t({ en: `Schema loaded for '${key}' metadata`, fr: `Schéma chargé pour les métadonnées « ${key} »` })
                : t({ en: 'Schema loaded.', fr: 'Schéma chargé.' })}
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
  t: TFunc
}

function SingleCriterionRow({ tc, criteriaMap, t }: SingleCriterionRowProps) {
  const action = tc.arguments['action'] as CriterionMutation | undefined
  const args = tc.arguments

  const isSessionMetadata = tc.name === 'session_metadata'
  const isRemoved = action === 'remove'
  const criterionId = args['id'] as string | undefined
  const argDescription = args['description'] as string | undefined
  const lookedUpCriterion = criterionId ? criteriaMap.get(criterionId) : undefined

  const actionPastTense: Partial<Record<CriterionMutation, string>> = {
    add: t({ en: 'Added', fr: 'Ajouté' }),
    update: t({ en: 'Updated', fr: 'Mis à jour' }),
    remove: t({ en: 'Removed', fr: 'Supprimé' }),
    complete: t({ en: 'Completed', fr: 'Terminé' }),
    pass: t({ en: 'Passed', fr: 'Réussi' }),
    fail: t({ en: 'Failed', fr: 'Échoué' }),
  }
  const fallback = isSessionMetadata
    ? `${(action && actionPastTense[action]) ?? t({ en: 'Managed', fr: 'Géré' })} ${t({ en: 'item', fr: 'élément' })}`
    : t({ en: 'Criterion updated', fr: 'Critère mis à jour' })
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
            <span className="text-text-muted">└ </span>
            {t({ en: '“{{reason}}”', fr: '« {{reason}} »' }, { reason: reason ?? '' })}
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
