/**
 * Format an LLM error string for display in the error detail modal.
 * JSON payloads are re-indented for readability; anything else is kept as-is.
 */
export function prettyPrintError(error: string): string {
  const trimmed = error.trim()
  if (!trimmed) return error
  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed === 'string') return parsed
    return JSON.stringify(parsed, null, 2)
  } catch {
    return error
  }
}
