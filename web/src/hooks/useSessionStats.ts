import { useMemo } from 'react'
import { computeSessionStats } from '../../../src/shared/stats.js'
import type { Message, SessionStats } from '../../../src/shared/types.js'

/**
 * Hook to compute aggregated session stats from messages.
 * Memoized to only recompute when messages change.
 * 
 * Returns null if no messages have stats.
 */
export function useSessionStats(messages: Message[]): SessionStats | null {
  return useMemo(() => computeSessionStats(messages), [messages])
}
