import stripAnsi from 'strip-ansi'
import { sanitizeUtf8 } from '../utils/utf8.js'

// Safety net for tool results that exceed the context budget. Built-in tools
// self-truncate via OUTPUT_LIMITS (50-100 KB); this catches anything that
// slips through — most notably MCP tools that return large payloads (e.g. a
// full symbol list). Must stay deterministic so the live path and the
// history-fold path produce byte-identical strings (KV-cache prefix stability).
const MAX_TOOL_RESULT_CHARS = 100_000

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
  const clean = sanitizeUtf8(stripAnsi(raw)).clean
  return truncateForContext(clean)
}

function truncateForContext(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text
  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n\n[Output truncated: ${text.length} characters total, showing first ${MAX_TOOL_RESULT_CHARS}]`
}
