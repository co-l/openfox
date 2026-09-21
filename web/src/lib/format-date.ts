import type { SessionSummary } from '@shared/types.js'
import { t, getLocale } from '@shared/i18n/index.js'
import { formatTime as formatDuration } from './format-stats.js'

const RELATIVE_LABELS = {
  today: { en: 'today {{time}}', fr: "aujourd'hui {{time}}" },
  yesterday: { en: 'yesterday {{time}}', fr: 'hier {{time}}' },
  daysAgo: {
    en: { one: '{{count}} day ago {{time}}', other: '{{count}} days ago {{time}}' },
    fr: { one: 'il y a {{count}} jour à {{time}}', other: 'il y a {{count}} jours à {{time}}' },
  },
} as const

function weekdayName(date: Date): string {
  // Locale-sensitive: rebuild the formatter when the active locale changes.
  return new Intl.DateTimeFormat(getLocale(), { weekday: 'long' }).format(date)
}

/**
 * Format a date string to "Dayname YYYY/MM/DD" format
 * Example: "Monday 2024/01/15"
 * The weekday name follows the active locale (e.g. "lundi" in fr); the numeric
 * part stays in the locale-neutral YYYY/MM/DD layout.
 * Uses local time to match user's timezone.
 */
export function formatDateHeader(isoString: string): string {
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return ''
  const dayName = weekdayName(date)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${dayName} ${year}/${month}/${day}`
}

/**
 * Format a date string to "HH:MM" 24-hour format
 * Example: "14:30"
 * Uses local time to match user's timezone.
 */
export function formatTime(isoString: string): string {
  const date = new Date(isoString)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/**
 * Format the elapsed time since an ISO timestamp, relative to now.
 * Example: "3s", "45s", "2m 0s", "1h 12m 0s"
 * Uses the shared duration formatter (integer seconds); never negative for
 * future timestamps.
 */
export function formatTimeSince(isoString: string, now = Date.now()): string {
  const date = new Date(isoString).getTime()
  if (Number.isNaN(date)) return ''
  const seconds = Math.max(0, Math.floor((now - date) / 1000))
  return formatDuration(seconds, false)
}

/**
 * Format a date string to "YYYY/MM/DD HH:MM" 24-hour format
 * Example: "2026/08/16 14:44"
 * Uses local time to match user's timezone. No AM/PM.
 */
export function formatDateTime(isoString: string): string {
  const date = new Date(isoString)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}/${month}/${day} ${formatTime(isoString)}`
}

/**
 * Format a date string to relative format:
 * - "today HH:MM" if today
 * - "yesterday HH:MM" if yesterday
 * - "X days ago HH:MM" if within 7 days
 * - "YYYY/MM/DD HH:MM" otherwise
 * The relative label follows the active locale (e.g. "aujourd'hui" in fr).
 * Uses local time to match user's timezone.
 */
export function formatRelativeDate(isoString: string, now = Date.now()): string {
  const date = new Date(isoString)
  const nowDate = new Date(now)

  const startOfToday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate())
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  const daysDiff = Math.floor((startOfToday.getTime() - startOfDate.getTime()) / (1000 * 60 * 60 * 24))
  const time = formatTime(isoString)

  if (daysDiff === 0) {
    return t(RELATIVE_LABELS.today, { time })
  } else if (daysDiff === 1) {
    return t(RELATIVE_LABELS.yesterday, { time })
  } else if (daysDiff < 7) {
    return t(RELATIVE_LABELS.daysAgo, { count: daysDiff, time })
  } else {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}/${month}/${day} ${time}`
  }
}

export function extractDateComponents(isoString: string) {
  const date = new Date(isoString)
  return {
    year: date.getFullYear(),
    month: String(date.getMonth() + 1).padStart(2, '0'),
    day: String(date.getDate()).padStart(2, '0'),
  }
}

export function extractDateKey(isoString: string): string {
  const { year, month, day } = extractDateComponents(isoString)
  return `${year}-${month}-${day}`
}

/**
 * Group sessions by date and sort them according to requirements:
 * - Groups sorted by date (newest first)
 * - Sessions within each group sorted by time (latest first)
 */
export function groupSessionsByDate(sessions: SessionSummary[]): Map<string, SessionSummary[]> {
  // Group sessions by date key
  const groups = new Map<string, SessionSummary[]>()

  for (const session of sessions) {
    const dateKey = extractDateKey(session.updatedAt)
    if (!groups.has(dateKey)) {
      groups.set(dateKey, [])
    }
    groups.get(dateKey)!.push(session)
  }

  // Sort sessions within each group by time (latest to earliest)
  for (const [_dateKey, groupSessions] of groups) {
    groupSessions.sort((a, b) => {
      const timeA = new Date(a.updatedAt).getTime()
      const timeB = new Date(b.updatedAt).getTime()
      return timeB - timeA // Descending order (latest first)
    })
  }

  // Sort the date keys (newest first)
  const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
    return b.localeCompare(a) // Descending order (newest first)
  })

  // Create a new map with sorted keys
  const sortedGroups = new Map<string, SessionSummary[]>()
  for (const key of sortedKeys) {
    sortedGroups.set(key, groups.get(key)!)
  }

  return sortedGroups
}
