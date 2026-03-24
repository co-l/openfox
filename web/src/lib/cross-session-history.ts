import type { Message } from '../../../src/shared/types.js'

const CROSS_SESSION_HISTORY_KEY = 'openfox:cross-session-history'
const MAX_CROSS_SESSION_ITEMS = 10
const MAX_CONTENT_LENGTH = 150

export interface CrossSessionPrompt {
  id: string
  content: string
  timestamp: string
  formattedTimestamp: string
  trimmedContent: string
  sessionId: string
}

/**
 * Format timestamp to local time YYYY/MM/DD HH:MM
 */
export function formatTimestampLocal(isoString: string): string {
  const date = new Date(isoString)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}/${month}/${day} ${hours}:${minutes}`
}

/**
 * Trim content to max length with ellipsis
 */
export function trimContent(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content
  return content.substring(0, maxLength) + '...'
}

/**
 * Save a user message to cross-session history
 * Called when a user message is sent
 */
export function savePromptToHistory(message: Message): void {
  if (message.role !== 'user') return
  
  const history = getCrossSessionHistory()
  
  // Add new prompt at the beginning (most recent)
  const newPrompt: CrossSessionPrompt = {
    id: message.id,
    content: message.content,
    timestamp: message.timestamp,
    formattedTimestamp: formatTimestampLocal(message.timestamp),
    trimmedContent: trimContent(message.content, MAX_CONTENT_LENGTH),
    sessionId: message.id.split('-')[0] || 'unknown', // Extract session id from message id
  }
  
  // Add to beginning and limit to MAX_CROSS_SESSION_ITEMS
  const updatedHistory = [newPrompt, ...history].slice(0, MAX_CROSS_SESSION_ITEMS)
  
  try {
    localStorage.setItem(CROSS_SESSION_HISTORY_KEY, JSON.stringify(updatedHistory))
  } catch (error) {
    console.warn('Failed to save prompt to cross-session history:', error)
  }
}

/**
 * Get all prompts from cross-session history
 * Returns prompts ordered from newest to oldest
 */
export function getCrossSessionHistory(): CrossSessionPrompt[] {
  try {
    const stored = localStorage.getItem(CROSS_SESSION_HISTORY_KEY)
    if (!stored) return []
    
    const history = JSON.parse(stored) as CrossSessionPrompt[]
    return history // Already ordered from newest to oldest
  } catch (error) {
    console.warn('Failed to load cross-session history:', error)
    return []
  }
}

/**
 * Get prompts from cross-session history, limited to maxCount
 * Returns prompts ordered from newest to oldest
 */
export function getRecentCrossSessionPrompts(maxCount: number = MAX_CROSS_SESSION_ITEMS): CrossSessionPrompt[] {
  const history = getCrossSessionHistory()
  return history.slice(0, maxCount)
}

/**
 * Clear cross-session history (useful for testing)
 */
export function clearCrossSessionHistory(): void {
  try {
    localStorage.removeItem(CROSS_SESSION_HISTORY_KEY)
  } catch (error) {
    console.warn('Failed to clear cross-session history:', error)
  }
}

/**
 * Build cross-session history from stored prompts
 * This is called when the current session has no user messages
 */
export function buildCrossSessionHistoryFromStorage(): CrossSessionPrompt[] {
  return getRecentCrossSessionPrompts(MAX_CROSS_SESSION_ITEMS)
}
