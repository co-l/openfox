import { memo } from 'react'
import type { Diagnostic } from '@shared/types.js'

interface DiagnosticsViewProps {
  diagnostics: Diagnostic[]
}

const severityConfig = {
  error: { 
    icon: '\u2717',  // ✗
    color: 'text-accent-error', 
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
  },
  warning: { 
    icon: '\u26A0',  // ⚠
    color: 'text-accent-warning', 
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/30',
  },
  info: { 
    icon: '\u2139',  // ℹ
    color: 'text-accent-info', 
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
  },
  hint: { 
    icon: '\u{1F4A1}',  // lightbulb emoji fallback
    color: 'text-text-muted', 
    bg: 'bg-gray-500/10',
    border: 'border-gray-500/30',
  },
}

export const DiagnosticsView = memo(function DiagnosticsView({ diagnostics }: DiagnosticsViewProps) {
  if (diagnostics.length === 0) return null
  
  const errors = diagnostics.filter(d => d.severity === 'error')
  const warnings = diagnostics.filter(d => d.severity === 'warning')
  const infos = diagnostics.filter(d => d.severity === 'info' || d.severity === 'hint')
  
  return (
    <div className="rounded border border-border overflow-hidden mt-2">
      {/* Header with counts */}
      <div className="flex items-center gap-3 px-2 py-1.5 bg-bg-tertiary border-b border-border">
        <span className="text-xs font-medium text-text-secondary">LSP Diagnostics</span>
        {errors.length > 0 && (
          <span className="text-xs text-accent-error font-medium">
            {errors.length} error{errors.length !== 1 ? 's' : ''}
          </span>
        )}
        {warnings.length > 0 && (
          <span className="text-xs text-accent-warning font-medium">
            {warnings.length} warning{warnings.length !== 1 ? 's' : ''}
          </span>
        )}
        {infos.length > 0 && (
          <span className="text-xs text-text-muted">
            {infos.length} info
          </span>
        )}
      </div>
      
      {/* Diagnostic list */}
      <div className="max-h-48 overflow-y-auto">
        {diagnostics.map((d, i) => {
          const config = severityConfig[d.severity]
          return (
            <div 
              key={i} 
              className={`flex items-start gap-2 px-2 py-1.5 ${config.bg} border-b border-border last:border-b-0`}
            >
              <span className={`${config.color} text-xs flex-shrink-0 w-4 text-center`}>
                {config.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-text-muted font-mono">
                    Ln {d.range.start.line + 1}:{d.range.start.character + 1}
                  </span>
                  {d.code && (
                    <span className="text-[10px] text-text-muted font-mono">
                      [{d.code}]
                    </span>
                  )}
                </div>
                <div className="text-xs text-text-primary break-words">{d.message}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
})
