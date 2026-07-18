import { memo } from 'react'

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
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(result) as Record<string, unknown>
  } catch {
    return <pre className="text-xs bg-bg-primary p-1.5 rounded overflow-x-auto max-h-[60vh] break-words">{result}</pre>
  }

  switch (action) {
    case 'list':
      return renderList(parsed as ListData)
    case 'switch':
    case 'delete':
      return renderActionResult(parsed as ActionResultData)
    default:
      return (
        <pre className="text-xs bg-bg-primary p-1.5 rounded overflow-x-auto max-h-[60vh] break-words">{result}</pre>
      )
  }
})

function renderList(data: ListData) {
  const workspaces = data.workspaces ?? []
  if (workspaces.length === 0) {
    return <div className="text-xs text-text-muted italic">No workspaces found</div>
  }

  return (
    <div className="space-y-1 text-xs">
      <div className="text-text-muted mb-1">Workspaces:</div>
      {workspaces.map((ws) => (
        <div key={ws.name} className="flex items-center gap-2 font-mono">
          <span className={ws.active ? 'text-accent-success' : 'text-text-muted'}>{ws.active ? '●' : '○'}</span>
          <span className={ws.active ? 'text-text-primary font-medium' : 'text-text-secondary'}>{ws.name}</span>
          {ws.branch && <span className="text-text-muted">· {ws.branch}</span>}
          {ws.active && <span className="text-[10px] text-accent-primary">(current)</span>}
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

function renderActionResult(data: ActionResultData) {
  return (
    <div className="space-y-2 text-xs">
      {data.message && <div className="text-text-primary">{data.message}</div>}
      {data.workspace && <FieldRow label="Name" value={data.workspace} mono />}
      {data.path && <FieldRow label="Path" value={data.path} mono />}
      {data.branch && <FieldRow label="Branch" value={data.branch} mono />}
    </div>
  )
}
