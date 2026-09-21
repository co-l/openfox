import { getLocale } from '@shared/i18n/index.js'

/**
 * Format token count with space as thousand separator (e.g., 125000 -> "125 000").
 * Digit grouping follows the active locale via Intl.NumberFormat; the group
 * separator is normalized to a regular space (project-wide display choice).
 */
export function formatTokens(tokens: number): string {
  return new Intl.NumberFormat(getLocale())
    .format(tokens)
    .replace(/[\s\u00a0\u202f]/g, ' ')
    .replace(/,/g, ' ')
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
 * - < 10s    → "7.8s" (one decimal) or "8s" when decimals=false
 * - 10-59s   → "41s"  (integer)
 * - 60-3599  → "31m 41s"
 * - ≥ 3600   → "1h 35m 42s"
 */
export function formatTime(seconds: number, decimals = true): string {
  if (!Number.isFinite(seconds)) return '0s'

  // Sub-10: show raw value with one decimal (or integer when decimals=false)
  if (seconds < 10) {
    return decimals ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`
  }

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
