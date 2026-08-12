import { useSessionStore } from './store'
import type { PendingQuestion, VisionFallbackItem } from './types'
import type { QueuedMessage } from '@shared/protocol.js'

// Stable references for zustand selectors: a freshly allocated array/object on
// every call makes useSyncExternalStore see a changed snapshot each render and
// loop forever ("Maximum update depth exceeded"). Only stored references or
// these module-level constants may be returned.
const EMPTY_QUEUED_MESSAGES: QueuedMessage[] = []
const EMPTY_PENDING_QUESTIONS: PendingQuestion[] = []
const EMPTY_VISION_FALLBACKS: Record<string, VisionFallbackItem> = {}

export function useIsRunning(sessionId?: string | null) {
  return useSessionStore((state) => {
    if (sessionId) {
      if (state.panes?.[sessionId]) return state.panes?.[sessionId]?.session?.isRunning ?? false
      if (state.currentSession?.id === sessionId) return state.currentSession.isRunning ?? false
      return false
    }
    return state.currentSession?.isRunning ?? false
  })
}

export function useQueuedMessages(sessionId?: string | null) {
  return useSessionStore((state) => {
    if (sessionId) {
      const pane = state.panes?.[sessionId]
      if (pane) return pane.queuedMessages ?? EMPTY_QUEUED_MESSAGES
      if (state.currentSession?.id === sessionId) return state.queuedMessages ?? EMPTY_QUEUED_MESSAGES
      return EMPTY_QUEUED_MESSAGES
    }
    return state.queuedMessages ?? EMPTY_QUEUED_MESSAGES
  })
}

export function useAbortInProgress(sessionId?: string | null) {
  return useSessionStore((state) => {
    if (sessionId) {
      if (state.panes?.[sessionId]) return state.panes?.[sessionId]?.abortInProgress ?? false
      if (state.currentSession?.id === sessionId) return state.abortInProgress
      return false
    }
    return state.abortInProgress
  })
}

export function usePendingQuestions(sessionId?: string | null): PendingQuestion[] {
  return useSessionStore((state) => {
    if (sessionId) {
      const pane = state.panes?.[sessionId]
      if (pane) return pane.pendingQuestions ?? EMPTY_PENDING_QUESTIONS
      if (state.currentSession?.id === sessionId) return state.pendingQuestions ?? EMPTY_PENDING_QUESTIONS
      return EMPTY_PENDING_QUESTIONS
    }
    return state.pendingQuestions ?? EMPTY_PENDING_QUESTIONS
  })
}

export function useVisionFallbackItems(sessionId?: string | null) {
  return useSessionStore((state) => {
    if (sessionId) {
      const pane = state.panes?.[sessionId]
      if (pane) return pane.visionFallbackByMessage ?? EMPTY_VISION_FALLBACKS
      if (state.currentSession?.id === sessionId) return state.visionFallbackByMessage ?? EMPTY_VISION_FALLBACKS
      return EMPTY_VISION_FALLBACKS
    }
    return state.visionFallbackByMessage ?? EMPTY_VISION_FALLBACKS
  })
}

export function useVisionFallbackForMessage(messageId: string, attachmentId?: string, sessionId?: string | null) {
  return useSessionStore((state) => {
    if (!attachmentId) return undefined
    const key = `${messageId}-${attachmentId}`
    if (sessionId) {
      if (state.panes?.[sessionId]) return state.panes?.[sessionId]?.visionFallbackByMessage[key]
      if (state.currentSession?.id === sessionId) return state.visionFallbackByMessage[key]
      return undefined
    }
    return state.visionFallbackByMessage[key]
  })
}
