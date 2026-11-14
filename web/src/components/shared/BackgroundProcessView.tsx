import { OptionalScrollArea } from './OptionalScrollArea'
import { memo } from 'react'
import type { BackgroundProcess, LogLine } from '@shared/protocol.js'
import { tryParseResult } from './tryParseResult'
import { useT } from '../../hooks/useT'

interface BackgroundProcessViewProps {
  result: string
  action: string
}

export const BackgroundProcessView = memo(function BackgroundProcessView({
  result,
  action,
}: BackgroundProcessViewProps) {
  const t = useT()
  const result_ = tryParseResult(result, 'BackgroundProcessView')
  if (!result_.success) return result_.error
  const parsed = result_.parsed

  if (action === 'logs') {
    return renderLogs(parsed, t)
  }

  if (action === 'list') {
    return renderProcessList(parsed, t)
  }

  if (action === 'status') {
    return renderProcessStatus(parsed, t)
  }

  if (action === 'start' || action === 'stop') {
    return renderStartStop(parsed, t)
  }

  if (action === 'wait') {
    return renderWait(parsed, result, t)
  }

  // Unknown action
  return (
    <div className="space-y-2 text-xs">
      <div className="text-accent-warning">
        {t({ en: 'Unknown action: {{action}}', fr: 'Action inconnue : {{action}}' }, { action })}
      </div>
      <OptionalScrollArea horizontal className="max-h-[60vh]">
        <pre className="text-xs bg-bg-primary p-1.5 rounded break-words">{result}</pre>
      </OptionalScrollArea>
    </div>
  )
})

function renderLogs(
  parsed: Record<string, unknown>,
  t: (tx: import('@shared/i18n/index.js').Translation, vars?: Record<string, string | number>) => string,
) {
  const lines = parsed.lines as LogLine[] | undefined
  const hasMore = parsed.hasMore as boolean | undefined
  const totalLines = parsed.totalLines as number | undefined

  if (!lines || lines.length === 0) {
    return (
      <div className="text-xs text-text-muted italic">{t({ en: 'No log output', fr: 'Aucune sortie de journal' })}</div>
    )
  }

  return (
    <div className="space-y-2">
      <OptionalScrollArea className="text-xs font-mono whitespace-pre-wrap bg-bg-primary p-2 rounded max-h-[60vh] break-words">
        {lines.map((line, i) => (
          <div key={i} className={line.stream === 'stderr' ? 'text-accent-warning' : ''}>
            {line.content}
          </div>
        ))}
      </OptionalScrollArea>
      {hasMore && totalLines != null && (
        <div className="text-[10px] text-text-muted">
          {t(
            { en: 'Showing {{shown}} of {{total}} lines', fr: 'Affichage de {{shown}} sur {{total}} lignes' },
            { shown: lines.length, total: totalLines },
          )}
        </div>
      )}
    </div>
  )
}

function renderProcessList(
  parsed: Record<string, unknown>,
  t: (tx: import('@shared/i18n/index.js').Translation, vars?: Record<string, string | number>) => string,
) {
  const processes = parsed.processes as BackgroundProcess[] | undefined
  const currentCount = parsed.currentCount as number | undefined
  const maxPerSession = parsed.maxPerSession as number | undefined

  if (!processes || processes.length === 0) {
    return (
      <div className="text-xs text-text-muted italic">
        {t({ en: 'No background processes', fr: 'Aucun processus en arrière-plan' })}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {processes.map((proc) => (
        <ProcessCard key={proc.id} process={proc} />
      ))}
      {currentCount != null && maxPerSession != null && (
        <div className="text-[10px] text-text-muted">
          {t(
            { en: '{{count}} of {{max}} slots used', fr: '{{count}} sur {{max}} emplacements utilisés' },
            { count: currentCount, max: maxPerSession },
          )}
        </div>
      )}
    </div>
  )
}

function renderProcessStatus(
  parsed: Record<string, unknown>,
  t: (tx: import('@shared/i18n/index.js').Translation, vars?: Record<string, string | number>) => string,
) {
  const proc = parsed.process as BackgroundProcess | undefined
  const uptime = parsed.uptime as number | null | undefined

  if (!proc) {
    return (
      <div className="text-xs text-text-muted italic">
        {t({ en: 'Process not found', fr: 'Processus introuvable' })}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <ProcessCard process={proc} />
      {uptime != null && (
        <div className="text-[10px] text-text-muted">
          {t(
            { en: 'Uptime: {{duration}}', fr: 'Temps de fonctionnement : {{duration}}' },
            { duration: formatDuration(uptime) },
          )}
        </div>
      )}
    </div>
  )
}

function renderStartStop(
  parsed: Record<string, unknown>,
  t: (tx: import('@shared/i18n/index.js').Translation, vars?: Record<string, string | number>) => string,
) {
  const procId = parsed.processId as string | undefined
  const procName = parsed.name as string | undefined
  const pid = parsed.pid as number | undefined
  const procStatus = parsed.status as string | undefined

  const statusColor =
    procStatus === 'running'
      ? 'text-accent-success'
      : procStatus === 'removed' || procStatus === 'exited'
        ? 'text-text-muted'
        : 'text-text-muted'

  return (
    <div className="space-y-2 text-xs">
      {procName && (
        <div className="flex items-center gap-2">
          <span className="text-text-muted">{t({ en: 'Name:', fr: 'Nom :' })}</span>
          <span className="font-medium">{procName}</span>
        </div>
      )}
      {procId && (
        <div className="flex items-center gap-2">
          <span className="text-text-muted">{t({ en: 'ID:', fr: 'ID :' })}</span>
          <span className="font-mono">{procId}</span>
        </div>
      )}
      {pid != null && (
        <div className="flex items-center gap-2">
          <span className="text-text-muted">{t({ en: 'PID:', fr: 'PID :' })}</span>
          <span className="font-mono">{pid}</span>
        </div>
      )}
      {procStatus && (
        <div className="flex items-center gap-2">
          <span className="text-text-muted">{t({ en: 'Status:', fr: 'Statut :' })}</span>
          <span className={`font-medium ${statusColor}`}>{procStatus}</span>
        </div>
      )}
    </div>
  )
}

function ProcessCard({ process }: { process: BackgroundProcess }) {
  const t = useT()
  const statusColor =
    process.status === 'running'
      ? 'text-accent-success'
      : process.status === 'exited'
        ? 'text-text-muted'
        : 'text-text-muted'

  return (
    <div className="border border-border rounded p-2 space-y-1 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-medium">{process.name}</span>
        <span className={`${statusColor}`}>{process.status}</span>
      </div>
      {process.pid != null && (
        <div className="text-text-muted">
          {t({ en: 'PID:', fr: 'PID :' })} <span className="font-mono">{process.pid}</span>
        </div>
      )}
      {process.command && <div className="text-text-muted font-mono truncate">{process.command}</div>}
    </div>
  )
}

function renderWait(
  parsed: Record<string, unknown>,
  rawResult: string,
  t: (tx: import('@shared/i18n/index.js').Translation, vars?: Record<string, string | number>) => string,
) {
  const status = parsed.status as string | undefined
  const reason = parsed.reason as string | undefined

  if (!status && !reason) {
    return (
      <OptionalScrollArea horizontal className="max-h-[60vh]">
        <pre className="text-xs bg-bg-primary p-1.5 rounded break-words">{rawResult}</pre>
      </OptionalScrollArea>
    )
  }

  const exitCode = parsed.exitCode as number | null | undefined
  const signal = parsed.signal as string | null | undefined
  const timedOut = parsed.timedOut as boolean | undefined
  const durationMs = parsed.durationMs as number | undefined
  const detail = parsed.detail as string | undefined

  const reasonColor =
    reason === 'success'
      ? 'text-accent-success'
      : reason === 'failed' || reason === 'signalled' || reason === 'error'
        ? 'text-accent-error'
        : reason === 'timeout'
          ? 'text-accent-warning'
          : 'text-text-muted'

  return (
    <div className="space-y-2 text-xs">
      {reason && (
        <div className="flex items-center gap-2">
          <span className="text-text-muted">{t({ en: 'Outcome:', fr: 'Résultat :' })}</span>
          <span className={`font-medium ${reasonColor}`}>{reason}</span>
        </div>
      )}
      {status && (
        <div className="flex items-center gap-2">
          <span className="text-text-muted">{t({ en: 'Status:', fr: 'Statut :' })}</span>
          <span className="font-medium">{status}</span>
        </div>
      )}
      {exitCode != null && (
        <div className="flex items-center gap-2">
          <span className="text-text-muted">{t({ en: 'Exit code', fr: 'Code de sortie' })}</span>
          <span className="font-mono">{exitCode}</span>
        </div>
      )}
      {signal && (
        <div className="flex items-center gap-2">
          <span className="text-text-muted">{t({ en: 'Signal:', fr: 'Signal :' })}</span>
          <span className="font-mono">{signal}</span>
        </div>
      )}
      {durationMs != null && (
        <div className="flex items-center gap-2">
          <span className="text-text-muted">{t({ en: 'Waited:', fr: 'Attente :' })}</span>
          <span>{formatDuration(durationMs)}</span>
        </div>
      )}
      {timedOut && (
        <div className="text-accent-warning">
          {t(
            {
              en: 'The wait timed out; the process is still running.',
              fr: "L'attente a expiré ; le processus tourne toujours.",
            },
            {},
          )}
        </div>
      )}
      {detail && <div className="text-text-muted italic">{detail}</div>}
    </div>
  )
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}
