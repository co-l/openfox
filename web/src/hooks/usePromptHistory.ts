import { useState, useCallback, useMemo } from 'react'
import type { Message, SessionSummary } from '../../../src/shared/types.js'
import { 
  buildCrossSessionHistoryFromStorage,
  formatTimestampLocal as formatTimestamp,
  trimContent
} from '../lib/cross-session-history'

export { formatTimestamp, trimContent }

const MAX_HISTORY_SIZE = 10
const MAX_CONTENT_LENGTH = 150

export interface PromptHistoryItem {
  id: string
  content: string
  timestamp: string
  formattedTimestamp: string
  trimmedContent: string
  sessionId?: string
}

export function extractUserMessages(messages: Message[]): Message[] {
  return messages
    .filter(msg => msg.role === 'user')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
}

/**
 * Build prompt history from messages, limited to maxCount items
 * Returns history with oldest first (newest at the end/bottom)
 */
export function buildHistoryFromMessages(messages: Message[], maxCount: number): PromptHistoryItem[] {
  // Get user messages sorted by timestamp (oldest first)
  const userMessages = messages
    .filter(msg => msg.role === 'user')
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  
  const history: PromptHistoryItem[] = []
  
  for (const msg of userMessages.slice(0, maxCount)) {
    history.push({
      id: msg.id,
      content: msg.content,
      timestamp: msg.timestamp,
      formattedTimestamp: formatTimestamp(msg.timestamp),
      trimmedContent: trimContent(msg.content, MAX_CONTENT_LENGTH),
    })
  }
  
  return history
}

/**
 * Build cross-session prompt history
 * When current session has no user messages, fetch from stored history
 */
export function buildCrossSessionHistory(
  _currentMessages: Message[],
  _allSessions: SessionSummary[],
  _currentSessionId: string | null
): PromptHistoryItem[] {
  // Use the cross-session history from localStorage
  // This contains user prompts from all sessions, ordered from newest to oldest
  const storedHistory = buildCrossSessionHistoryFromStorage()
  
  // Convert to our PromptHistoryItem format (they should already match)
  return storedHistory.slice(0, MAX_HISTORY_SIZE)
}

interface UsePromptHistoryReturn {
  history: PromptHistoryItem[]
  selectedIndex: number
  showHistory: boolean
  openHistory: () => void
  closeHistory: () => void
  navigateUp: () => void
  navigateDown: () => void
  selectCurrent: () => string | null
}

export function usePromptHistory(
  messages: Message[],
  sessions: SessionSummary[] = [],
  currentSessionId: string | null = null
): UsePromptHistoryReturn {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [showHistory, setShowHistory] = useState(false)
  
  const history = useMemo(() => {
    // Check if current session has any user messages
    const currentUserMessages = messages.filter(m => m.role === 'user')
    
    if (currentUserMessages.length > 0) {
      // Use current session messages
      return buildHistoryFromMessages(messages, MAX_HISTORY_SIZE)
    }
    
    // Current session is empty - try cross-session history
    if (sessions.length > 0 && currentSessionId) {
      return buildCrossSessionHistory(messages, sessions, currentSessionId)
    }
    
    // Fallback to current messages (even if empty)
    return buildHistoryFromMessages(messages, MAX_HISTORY_SIZE)
  }, [messages, sessions, currentSessionId])
  
  const openHistory = useCallback(() => {
    if (history.length > 0) {
      setSelectedIndex(0)
      setShowHistory(true)
    }
  }, [history])
  
  const closeHistory = useCallback(() => {
    setShowHistory(false)
    setSelectedIndex(0)
  }, [])
  
  const navigateUp = useCallback(() => {
    setSelectedIndex(prev => {
      if (history.length === 0) return prev
      return prev === 0 ? history.length - 1 : prev - 1
    })
  }, [history.length])
  
  const navigateDown = useCallback(() => {
    setSelectedIndex(prev => {
      if (history.length === 0) return prev
      return prev === history.length - 1 ? 0 : prev + 1
    })
  }, [history.length])
  
  const selectCurrent = useCallback((): string | null => {
    if (history.length === 0 || !showHistory) return null
    const item = history[selectedIndex]
    return item?.content ?? null
  }, [history, selectedIndex, showHistory])
  
  return {
    history,
    selectedIndex,
    showHistory,
    openHistory,
    closeHistory,
    navigateUp,
    navigateDown,
    selectCurrent,
  }
}
