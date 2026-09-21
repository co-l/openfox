import { OptionalScrollArea } from './OptionalScrollArea'
import { memo } from 'react'
import { useT } from '../../hooks/useT'
import type { Translation } from '@shared/i18n/index.js'

interface WorkspaceViewProps {
  result: string
  action: string
}

interface WorkspaceEntry {
  name: string
  branch: string | null
  active: boolean
}

interface ListData {
  workspaces?: WorkspaceEntry[]
}

interface ActionResultData {
  workspace?: string
  path?: string | null
  branch?: string | null
  message?: string
}

export const WorkspaceView = memo(function WorkspaceView({ result, action }: WorkspaceViewProps) {
  const t = useT()
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(result) as Record<string, unknown>
  } catch {
    return (
      <OptionalScrollArea horizontal className="max-h-[60vh]">
        <pre className="text-xs bg-bg-primary p-1.5 rounded break-words">{result}</pre>
      </OptionalScrollArea>
    )
  }

  switch (action) {
    case 'list':
      return renderList(parsed as ListData, t)
    case 'switch':
    case 'delete':
      return renderActionResult(parsed as ActionResultData, t)
    default:
      return (
        <OptionalScrollArea horizontal className="max-h-[60vh]">
          <pre className="text-xs bg-bg-primary p-1.5 rounded break-words">{result}</pre>
        </OptionalScrollArea>
      )
  }
})

type TFunc = (tx: Translation, vars?: Record<string, string | number>) => string

function renderList(data: ListData, t: TFunc) {
  const workspaces = data.workspaces ?? []
  if (workspaces.length === 0) {
    return (
      <div className="text-xs text-text-muted italic">
        {t({ en: 'No workspaces found', fr: 'Aucun workspace trouvé' })}
      </div>
    )
  }

  return (
    <div className="space-y-1 text-xs">
      <div className="text-text-muted mb-1">{t({ en: 'Workspaces:', fr: 'Workspaces :' })}</div>
      {workspaces.map((ws) => (
        <div key={ws.name} className="flex items-center gap-2 font-mono">
          <span className={ws.active ? 'text-accent-success' : 'text-text-muted'}>{ws.active ? '●' : '○'}</span>
          <span className={ws.active ? 'text-text-primary font-medium' : 'text-text-secondary'}>{ws.name}</span>
          {ws.branch && <span className="text-text-muted">· {ws.branch}</span>}
          {ws.active && (
            <span className="text-[10px] text-accent-primary">{t({ en: '(current)', fr: '(actuel)' })}</span>
          )}
        </div>
      ))}
    </div>
  )
}

function FieldRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-text-muted">{label}:</span>
      <span className={mono ? 'font-mono text-accent-primary' : 'text-text-primary'}>{value}</span>
    </div>
  )
}

function renderActionResult(data: ActionResultData, t: TFunc) {
  return (
    <div className="space-y-2 text-xs">
      {data.message && <div className="text-text-primary">{data.message}</div>}
      {data.workspace && <FieldRow label={t({ en: 'Name', fr: 'Nom' })} value={data.workspace} mono />}
      {data.path && <FieldRow label={t({ en: 'Path', fr: 'Chemin' })} value={data.path} mono />}
      {data.branch && <FieldRow label={t({ en: 'Branch', fr: 'Branche' })} value={data.branch} mono />}
    </div>
  )
}
