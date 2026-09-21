/**
 * Composer text-insertion helpers shared by the chat composer and the task
 * editor, so both honor the same slash-command / @-mention splice semantics.
 */

import { readAllWorkflows, readCommands } from './resources'
import { dedupById } from './modal-utils'

export interface SuggestionInsertion {
  newText: string
  newCursorPos: number
}

/**
 * Replace the text between `startIndex` (e.g. the start of a partial `/cmd`
 * or `@path` token) and the cursor with `replacement`, and return the new
 * text plus the cursor position right after the replacement.
 */
export function insertSuggestionAtCursor(
  text: string,
  cursorPos: number,
  startIndex: number,
  replacement: string,
): SuggestionInsertion {
  const beforeCursor = text.slice(0, startIndex)
  const afterCursor = text.slice(cursorPos)
  return {
    newText: `${beforeCursor}${replacement}${afterCursor}`,
    newCursorPos: startIndex + replacement.length,
  }
}

/** Place the caret after a suggestion insertion and return focus to the textarea. */
export function focusTextareaAt(textarea: HTMLTextAreaElement | null, cursorPos: number): void {
  if (!textarea) return
  textarea.selectionStart = cursorPos
  textarea.selectionEnd = cursorPos
  textarea.focus()
}

/**
 * Resolve the inline parameter hints (names, in order) for a slash suggestion.
 * Workflows contribute their declared parameters; commands contribute their
 * server-computed param names. Identical for the chat composer and the task
 * editor so both render the same hints.
 */
export function resolveSlashParamIds(
  suggestion: { type: string; id: string; scope?: unknown },
  workdir?: string,
): string[] {
  if (suggestion.type === 'workflow') {
    const wf = readAllWorkflows(workdir).find((w) => w.id === suggestion.id && w.scope === suggestion.scope)
    return (wf?.parameters ?? []).map((p) => p.id)
  }
  const data = readCommands(workdir)
  const cmd = data
    ? dedupById(dedupById(data.defaults, data.userItems), data.projectItems).find((c) => c.id === suggestion.id)
    : undefined
  return cmd?.paramNames ?? []
}
