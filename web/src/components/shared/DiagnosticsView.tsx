import { OptionalScrollArea } from './OptionalScrollArea'
import { memo } from 'react'
import type { Diagnostic } from '@shared/types.js'
import { useT } from '../../hooks/useT'

interface DiagnosticsViewProps {
  diagnostics: Diagnostic[]
}

const severityConfig = {
  error: {
    icon: '\u2717', // ✗
    color: 'text-accent-error',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
  },
  warning: {
    icon: '\u26A0', // ⚠
    color: 'text-accent-warning',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/30',
  },
  info: {
    icon: '\u2139', // ℹ
    color: 'text-accent-info',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
  },
  hint: {
    icon: '\u{1F4A1}', // lightbulb emoji fallback
    color: 'text-text-muted',
    bg: 'bg-gray-500/10',
    border: 'border-gray-500/30',
  },
}

export const DiagnosticsView = memo(function DiagnosticsView({ diagnostics }: DiagnosticsViewProps) {
  const t = useT()
  if (diagnostics.length === 0) return null

  const errors = diagnostics.filter((d) => d.severity === 'error')
  const warnings = diagnostics.filter((d) => d.severity === 'warning')
  const infos = diagnostics.filter((d) => d.severity === 'info' || d.severity === 'hint')

  return (
    <div className="rounded border border-border overflow-hidden mt-2">
      {/* Header with counts */}
      <div className="flex items-center gap-3 px-2 py-1.5 bg-bg-tertiary border-b border-border">
        <span className="text-xs font-medium text-text-secondary">
          {t({ en: 'LSP Diagnostics', fr: 'Diagnostics LSP' })}
        </span>
        {errors.length > 0 && (
          <span className="text-xs text-accent-error font-medium">
            {t(
              {
                en: { one: '{{count}} error', other: '{{count}} errors' },
                fr: { one: '{{count}} erreur', other: '{{count}} erreurs' },
              },
              { count: errors.length },
            )}
          </span>
        )}
        {warnings.length > 0 && (
          <span className="text-xs text-accent-warning font-medium">
            {t(
              {
                en: { one: '{{count}} warning', other: '{{count}} warnings' },
                fr: { one: '{{count}} avertissement', other: '{{count}} avertissements' },
              },
              { count: warnings.length },
            )}
          </span>
        )}
        {infos.length > 0 && (
          <span className="text-xs text-text-muted">
            {t({ en: '{{count}} info', fr: '{{count}} info' }, { count: infos.length })}
          </span>
        )}
      </div>

      {/* Diagnostic list */}
      <OptionalScrollArea className="max-h-48">
        {diagnostics.map((d, i) => {
          const config = severityConfig[d.severity]
          return (
            <div
              key={i}
              className={`flex items-start gap-2 px-2 py-1.5 ${config.bg} border-b border-border last:border-b-0`}
            >
              <span className={`${config.color} text-xs flex-shrink-0 w-4 text-center`}>{config.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-text-muted font-mono">
                    {t(
                      { en: 'Ln {{line}}:{{col}}', fr: 'L {{line}}:{{col}}' },
                      { line: d.range.start.line + 1, col: d.range.start.character + 1 },
                    )}
                  </span>
                  {d.code && <span className="text-[10px] text-text-muted font-mono">[{d.code}]</span>}
                </div>
                <div className="text-xs text-text-primary break-words">{d.message}</div>
              </div>
            </div>
          )
        })}
      </OptionalScrollArea>
    </div>
  )
})
