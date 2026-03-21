/**
 * Format token count with space as thousand separator (e.g., 125000 -> "125 000")
 */
export function formatTokens(tokens: number): string {
  return tokens.toLocaleString('en-US').replace(/,/g, ' ')
}

/**
 * Format speed with k suffix
 */
export function formatSpeed(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toFixed(1)
}

/**
 * Format seconds to compact time
 */
export function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return `${mins}m${secs}s`
}
