export interface StripTailResult {
  command: string
  tailLines: number
}

const TAIL_END_RE = /^(.*?)\s*\|\s*tail\s+(?:-n\s+)?-?(\d+)\s*$/

function hasTopLevelStatementSeparator(command: string): boolean {
  let quote: "'" | '"' | '`' | null = null
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!
    if (ch === '\\') {
      i++
      continue
    }
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === ';' || ch === '\n') return true
    if ((ch === '&' || ch === '|') && command[i + 1] === ch) return true
  }
  return false
}

export function stripTailPipe(command: string): StripTailResult | null {
  const trimmed = command.trim()
  if (!trimmed) return null

  if (hasTopLevelStatementSeparator(trimmed)) return null

  const match = trimmed.match(TAIL_END_RE)
  if (!match) return null

  const beforeTail = match[1]!
  const tailLines = Number.parseInt(match[2]!, 10)

  if (tailLines <= 0) return null

  return { command: beforeTail.trim(), tailLines }
}
