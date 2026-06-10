export interface StripTailResult {
  command: string
  tailLines: number
}

const TAIL_END_RE = /^(.*?)\s*\|\s*tail\s+(?:-n\s+)?-?(\d+)\s*$/

export function stripTailPipe(command: string): StripTailResult | null {
  const trimmed = command.trim()
  if (!trimmed) return null

  const match = trimmed.match(TAIL_END_RE)
  if (!match) return null

  const beforeTail = match[1]!
  const tailLines = Number.parseInt(match[2]!, 10)

  if (tailLines <= 0) return null

  return { command: beforeTail.trim(), tailLines }
}
