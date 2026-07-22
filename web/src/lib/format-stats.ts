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
  if (!Number.isFinite(n)) return '0'
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toFixed(1)
}

/**
 * Format seconds to human-readable time
 *
 * - < 10s    → "7.8s" (one decimal)
 * - 10-59s   → "41s"  (integer)
 * - 60-3599  → "31m 41s"
 * - ≥ 3600   → "1h 35m 42s"
 */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0s'

  // Sub-10: show raw value with one decimal
  if (seconds < 10) return `${seconds.toFixed(1)}s`

  // 10+: round to nearest second then format
  const totalSecs = Math.round(seconds)

  if (totalSecs < 60) return `${totalSecs}s`

  if (totalSecs < 3600) {
    const mins = Math.floor(totalSecs / 60)
    const secs = totalSecs % 60
    return `${mins}m ${secs}s`
  }

  const hours = Math.floor(totalSecs / 3600)
  const rem = totalSecs % 3600
  const mins = Math.floor(rem / 60)
  const secs = rem % 60
  return `${hours}h ${mins}m ${secs}s`
}
