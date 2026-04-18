import { extractDateComponents } from './format-date.js'
import { formatTime } from './format-date.js'

export { formatTime }

export function formatTimestampLocal(isoString: string): string {
  const { year, month, day } = extractDateComponents(isoString)
  return `${year}/${month}/${day} ${formatTime(isoString)}`
}

/**
 * Trim content to max length with ellipsis
 */
export function trimContent(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content
  return content.substring(0, maxLength) + '...'
}
