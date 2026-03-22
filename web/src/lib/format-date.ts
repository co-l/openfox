import type { SessionSummary } from '../../../src/shared/types.js'

/**
 * Format a date string to "Dayname YYYY/MM/DD" format
 * Example: "Monday 2024/01/15"
 * Uses local time to match user's timezone
 */
export function formatDateHeader(isoString: string): string {
  const date = new Date(isoString)
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const dayName = days[date.getDay()]
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  
  return `${dayName} ${year}/${month}/${day}`
}

/**
 * Format a date string to "HH:MM" 24-hour format
 * Example: "14:30"
 * Uses local time to match user's timezone
 */
export function formatTime(isoString: string): string {
  const date = new Date(isoString)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/**
 * Extract the date part (YYYY-MM-DD) from an ISO timestamp
 * Used for grouping sessions by day
 * Uses local time to match user's timezone
 */
export function extractDateKey(isoString: string): string {
  const date = new Date(isoString)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
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
