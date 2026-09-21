import { OptionalScrollArea } from './OptionalScrollArea'
import { memo } from 'react'
import { tryParseResult } from './tryParseResult'
import { useT } from '../../hooks/useT'
import type { Translation } from '@shared/i18n/index.js'

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
}

export const DevServerView = memo(function DevServerView({ result, action }: DevServerViewProps) {
  const t = useT()
  const result_ = tryParseResult(result, 'DevServerView')
  if (!result_.success) return result_.error
  const parsed = result_.parsed

  if (action === 'logs') {
    return renderLogs(parsed as LogsData, t)
  }

  return renderStatus(parsed as StatusData, t)
})

type TFunc = (tx: Translation, vars?: Record<string, string | number>) => string

function renderLogs(data: LogsData, t: TFunc) {
  if (!data.logs) {
    return (
      <div className="text-xs text-text-muted italic">{t({ en: 'No log output', fr: 'Aucune sortie de journal' })}</div>
    )
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
          {t(
            { en: 'Showing {{shown}} of {{total}} lines', fr: 'Affichage de {{shown}} sur {{total}} lignes' },
            { shown: data.limit ?? 0, total: data.total ?? 0 },
          )}
        </div>
      )}
    </div>
  )
}

function renderStatus(data: StatusData, t: TFunc) {
  const state = String(data.state ?? '')
  const url = String(data.url ?? '')
  const errorMsg = data.error ? String(data.error) : undefined

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
        <span className="text-text-muted">{t({ en: 'State:', fr: 'État :' })}</span>
        <span className={`font-medium ${stateColor}`}>{state}</span>
      </div>
      {url && url !== 'undefined' && (
        <div className="flex items-center gap-2">
          <span className="text-text-muted">{t({ en: 'URL:', fr: 'URL :' })}</span>
          <a href={url} className="text-accent-primary hover:underline" target="_blank" rel="noopener noreferrer">
            {url}
          </a>
        </div>
      )}
      {errorMsg && <div className="text-accent-error bg-accent-error/10 p-2 rounded">{errorMsg}</div>}
    </div>
  )
}
