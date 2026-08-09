import { OptionalScrollArea } from './OptionalScrollArea'
import { memo } from 'react'
import { tryParseResult } from './tryParseResult'

interface DevServerViewProps {
  result: string
  action: string
}

interface LogsData {
  logs?: string
  total?: number
  offset?: number
  limit?: number
  hasMore?: boolean
}

interface StatusData {
  state?: string
  url?: string
  error?: string
  tailscalePreview?: {
    status?: string
    url?: string
    error?: string
  }
}

export const DevServerView = memo(function DevServerView({ result, action }: DevServerViewProps) {
  const result_ = tryParseResult(result, 'DevServerView')
  if (!result_.success) return result_.error
  const parsed = result_.parsed

  if (action === 'logs') {
    return renderLogs(parsed as LogsData)
  }

  return renderStatus(parsed as StatusData)
})

function renderLogs(data: LogsData) {
  if (!data.logs) {
    return <div className="text-xs text-text-muted italic">No log output</div>
  }

  const lines = data.logs.split('\n')
  return (
    <div className="space-y-2">
      <OptionalScrollArea className="text-xs font-mono whitespace-pre-wrap bg-bg-primary p-2 rounded max-h-[60vh] break-words">
        {lines.map((line, i) => {
          const isStderr = line.startsWith('[stderr] ')
          return (
            <div key={i} className={isStderr ? 'text-accent-warning' : ''}>
              {isStderr ? line.slice('[stderr] '.length) : line}
            </div>
          )
        })}
      </OptionalScrollArea>
      {data.hasMore && (
        <div className="text-[10px] text-text-muted">
          Showing {data.limit} of {data.total} lines
        </div>
      )}
    </div>
  )
}

function renderStatus(data: StatusData) {
  const state = String(data.state ?? '')
  const url = String(data.url ?? '')
  const errorMsg = data.error ? String(data.error) : undefined
  const preview = data.tailscalePreview

  const stateColor =
    state === 'running'
      ? 'text-accent-success'
      : state === 'stopped'
        ? 'text-text-muted'
        : state === 'error'
          ? 'text-accent-error'
          : 'text-text-muted'

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-text-muted">State:</span>
        <span className={`font-medium ${stateColor}`}>{state}</span>
      </div>
      {url && url !== 'undefined' && (
        <div className="flex items-center gap-2">
          <span className="text-text-muted">URL:</span>
          <a href={url} className="text-accent-primary hover:underline" target="_blank" rel="noopener noreferrer">
            {url}
          </a>
        </div>
      )}
      {preview && preview.status === 'active' && preview.url && (
        <div className="flex items-center gap-2">
          <span className="text-text-muted">Tailnet:</span>
          <a
            href={preview.url}
            className="text-accent-primary hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {preview.url}
          </a>
        </div>
      )}
      {preview && preview.status === 'error' && (
        <div className="text-accent-error bg-accent-error/10 p-2 rounded text-[10px]">
          Tailscale: {preview.error ?? 'preview failed'}
        </div>
      )}
      {errorMsg && <div className="text-accent-error bg-accent-error/10 p-2 rounded">{errorMsg}</div>}
    </div>
  )
}
