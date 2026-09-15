/**
 * Line-addressed edits on a newline-joined setting value.
 *
 * A setting such as `global_instructions` is really a small line database: the
 * agent appends facts, replaces a line it reworded, or deletes an obsolete one.
 * Doing that by rewriting the whole value risks dropping everything around the
 * edit, so every verb here works on the split value and re-joins it, meaning a
 * line is only ever touched when it matches exactly - headings, blank lines and
 * trailing markdown hard breaks survive byte-for-byte.
 *
 * Lines carry no numeric address on purpose: the caller names the line it means.
 */

export interface LineEditResult {
  changed: boolean
  matched: number
  lineCount: number
  removed: string[]
  added: string[]
  value: string
  message: string
}

export function validateLine(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return 'a non-empty single line is required'
  }
  if (/[\n\r]/.test(value)) {
    return 'a single line is required (no newlines) - send one line per request'
  }
  return null
}

export function lineCount(value: string): number {
  return value.split('\n').filter((line) => line.trim() !== '').length
}

function sameLine(candidate: string, target: string): boolean {
  return candidate.trim() === target.trim() && target.trim() !== ''
}

function unchanged(value: string, matched: number, message: string): LineEditResult {
  return { changed: false, matched, lineCount: lineCount(value), removed: [], added: [], value, message }
}

export function appendLine(value: string, line: string): LineEditResult {
  const matches = value.split('\n').filter((candidate) => sameLine(candidate, line)).length
  if (matches > 0) {
    return unchanged(value, matches, `Line already present (${matches} occurrence(s)) - nothing appended`)
  }
  const lines = value.trim() === '' ? [] : value.split('\n')
  let insertAt = lines.length
  while (insertAt > 0 && lines[insertAt - 1]!.trim() === '') insertAt--
  lines.splice(insertAt, 0, line)
  const next = lines.join('\n')
  return {
    changed: true,
    matched: 0,
    lineCount: lineCount(next),
    removed: [],
    added: [line],
    value: next,
    message: `Appended 1 line (${lineCount(next)} total)`,
  }
}

export function replaceLine(value: string, match: string, line: string): LineEditResult {
  const removed: string[] = []
  const next = value
    .split('\n')
    .map((candidate) => {
      if (!sameLine(candidate, match)) return candidate
      removed.push(candidate)
      return line
    })
    .join('\n')
  if (removed.length === 0) {
    return unchanged(value, 0, `No line matched "${match.trim()}" - GET the setting to list current lines`)
  }
  return {
    changed: true,
    matched: removed.length,
    lineCount: lineCount(next),
    removed,
    added: removed.map(() => line),
    value: next,
    message: `Replaced ${removed.length} occurrence(s)`,
  }
}

export function deleteLine(value: string, line: string): LineEditResult {
  if (line.trim() === '') {
    return unchanged(value, 0, 'A blank line cannot be addressed - name the line to delete')
  }
  const removed: string[] = []
  const next = value
    .split('\n')
    .filter((candidate) => {
      if (!sameLine(candidate, line)) return true
      removed.push(candidate)
      return false
    })
    .join('\n')
  if (removed.length === 0) {
    return unchanged(value, 0, `No line matched "${line.trim()}" - GET the setting to list current lines`)
  }
  return {
    changed: true,
    matched: removed.length,
    lineCount: lineCount(next),
    removed,
    added: [],
    value: next,
    message: `Removed ${removed.length} line(s)`,
  }
}
