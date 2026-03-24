import { useState, useCallback, useMemo } from 'react'
import type { Message, SessionSummary } from '../../../src/shared/types.js'
import { 
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
  sessionName?: string
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
  // Get user messages sorted by timestamp descending (newest first)
  const userMessages = messages
    .filter(msg => msg.role === 'user')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  
  // Take the maxCount most recent messages
  const recentMessages = userMessages.slice(0, maxCount)
  
  // Reverse to get oldest-first order for display (newest at bottom)
  recentMessages.reverse()
  
  const history: PromptHistoryItem[] = []
  
  for (const msg of recentMessages) {
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
 * Build cross-session prompt history from all sessions in the store
 * Aggregates recentUserPrompts from all sessions, sorts by timestamp descending, returns top 10
 */
export function buildFromSessions(sessions: SessionSummary[]): PromptHistoryItem[] {
  // Aggregate all recentUserPrompts from all sessions
  const allPrompts: Array<{ id: string, content: string, timestamp: string, sessionId: string, sessionName?: string }> = []
  
  for (const session of sessions) {
    if (session.recentUserPrompts) {
      for (const prompt of session.recentUserPrompts) {
        allPrompts.push({
          id: prompt.id,
          content: prompt.content,
          timestamp: prompt.timestamp,
          sessionId: session.id,
          sessionName: session.title || session.id,
        })
      }
    }
  }
  
  // Sort by timestamp descending (newest first)
  allPrompts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  
  // Take top 10 most recent prompts
  const recentPrompts = allPrompts.slice(0, MAX_HISTORY_SIZE)
  
  // Reverse to get oldest-first order for display (newest at bottom)
  recentPrompts.reverse()
  
  const history: PromptHistoryItem[] = []
  for (const prompt of recentPrompts) {
    history.push({
      id: prompt.id,
      content: prompt.content,
      timestamp: prompt.timestamp,
      formattedTimestamp: formatTimestamp(prompt.timestamp),
      trimmedContent: trimContent(prompt.content, MAX_CONTENT_LENGTH),
      sessionId: prompt.sessionId,
      sessionName: prompt.sessionName,
    })
  }
  
  return history
}

/**
 * Build combined history from current session messages and all other sessions
 * Always returns the 10 most recent prompts across all sources
 */
export function buildCombinedHistory(
  messages: Message[],
  sessions: SessionSummary[],
  currentSessionId: string | null
): PromptHistoryItem[] {
  const allPrompts: Array<{ id: string, content: string, timestamp: string, sessionId: string | null, sessionName?: string }> = []
  
  // Add current session messages
  const currentUserMessages = messages.filter(msg => msg.role === 'user')
  for (const msg of currentUserMessages) {
    allPrompts.push({
      id: msg.id,
      content: msg.content,
      timestamp: msg.timestamp,
      sessionId: currentSessionId,
      sessionName: 'This session',
    })
  }
  
  // Add prompts from other sessions
  for (const session of sessions) {
    // Skip the current session (we already added its messages)
    if (currentSessionId && session.id === currentSessionId) {
      continue
    }
    
    if (session.recentUserPrompts) {
      for (const prompt of session.recentUserPrompts) {
        allPrompts.push({
          id: prompt.id,
          content: prompt.content,
          timestamp: prompt.timestamp,
          sessionId: session.id,
          sessionName: session.title || session.id,
        })
      }
    }
  }
  
  // Sort by timestamp descending (newest first)
  allPrompts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  
  // Take top 10 most recent prompts
  const recentPrompts = allPrompts.slice(0, MAX_HISTORY_SIZE)
  
  // Reverse to get oldest-first order for display (newest at bottom)
  recentPrompts.reverse()
  
  const history: PromptHistoryItem[] = []
  for (const prompt of recentPrompts) {
    history.push({
      id: prompt.id,
      content: prompt.content,
      timestamp: prompt.timestamp,
      formattedTimestamp: formatTimestamp(prompt.timestamp),
      trimmedContent: trimContent(prompt.content, MAX_CONTENT_LENGTH),
      sessionId: prompt.sessionId || undefined,
      sessionName: prompt.sessionName,
    })
  }
  
  return history
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
    // Always combine current session messages with all other sessions
    // and return the 10 most recent prompts
    return buildCombinedHistory(messages, sessions, currentSessionId)
  }, [messages, sessions, currentSessionId])
  
  const openHistory = useCallback(() => {
    if (history.length > 0) {
      setSelectedIndex(history.length - 1) // Select the newest (last) item
      setShowHistory(true)
    }
  }, [history.length])
  
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
