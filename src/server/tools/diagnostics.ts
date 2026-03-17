import type { Diagnostic } from '../../shared/types.js'

/**
 * Format diagnostics for LLM consumption (plain text in output).
 * This is appended to tool output so the LLM can see and respond to errors.
 */
export function formatDiagnosticsForLLM(diagnostics: Diagnostic[]): string {
  if (diagnostics.length === 0) return ''
  
  const errors = diagnostics.filter(d => d.severity === 'error')
  const warnings = diagnostics.filter(d => d.severity === 'warning')
  
  let output = '\n\nLSP found '
  const parts: string[] = []
  if (errors.length > 0) parts.push(`${errors.length} error(s)`)
  if (warnings.length > 0) parts.push(`${warnings.length} warning(s)`)
  output += parts.join(', ') + ':\n'
  
  // Limit to 10 most severe diagnostics
  const sorted = [...diagnostics].sort((a, b) => {
    const severityOrder = { error: 0, warning: 1, info: 2, hint: 3 }
    return severityOrder[a.severity] - severityOrder[b.severity]
  })
  
  for (const d of sorted.slice(0, 10)) {
    output += `- Line ${d.range.start.line + 1}: [${d.severity}] ${d.message}\n`
  }
  
  if (diagnostics.length > 10) {
    output += `... and ${diagnostics.length - 10} more\n`
  }
  
  return output
}
