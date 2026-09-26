import stripAnsi from 'strip-ansi'
import { sanitizeUtf8 } from '../utils/utf8.js'

/**
 * LLM-facing rendering of a tool result.
 *
 * Pure and locale-independent (English only — LLM-facing strings stay English
 * per docs/I18N.md). This MUST stay the single renderer for tool content: the
 * live path (execute-tools) and the history-fold path (fold-messages) must
 * produce byte-identical strings, or the KV-cache prefix drifts between turns.
 */
export function renderToolResultContent(result: { success: boolean; output?: string; error?: string }): string {
  const raw = result.success
    ? (result.output ?? 'Success')
    : result.output
      ? `${result.output}\n\nError: ${result.error ?? ''}`
      : `Error: ${result.error ?? ''}`
  return sanitizeUtf8(stripAnsi(raw)).clean
}
