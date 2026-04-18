import { describe, expect, it } from 'vitest'
import { 
  buildHistoryFromMessages, 
  formatTimestamp, 
  extractUserMessages, 
  buildFromSessions,
  buildCombinedHistory
} from './usePromptHistory'

import type { Message, SessionSummary } from '@shared/types'

function mockSession(partial: Partial<SessionSummary> & Pick<SessionSummary, 'id'>): SessionSummary {
  return {
    projectId: 'proj-1',
    workdir: '/tmp',
    mode: 'builder',
    phase: 'build',
    isRunning: false,
    createdAt: '2026-03-24T10:00:00Z',
    updatedAt: '2026-03-24T10:00:00Z',
    criteriaCount: 0,
    criteriaCompleted: 0,
    messageCount: 0,
    ...partial,
  }
}

describe('usePromptHistory helpers', () => {
  describe('formatTimestamp', () => {
    it('formats ISO timestamp to YYYY/MM/DD HH:MM in local time', () => {
      // note: this will use local timezone, so the actual hour depends on the test environment
      const result = formatTimestamp('2026-03-24T16:30:45Z')
      expect(result).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/)
    })

    it('pads single digit months and days', () => {
      expect(formatTimestamp('2026-03-05T10:05:00Z')).toMatch(/2026\/03\/05/)
    })
  })

  

  describe('extractUserMessages', () => {
    it('filters only user messages', () => {
      const messages: Message[] = [
        { id: '1', role: 'user', content: 'User 1', timestamp: '2026-03-24T16:30:00Z' },
        { id: '2', role: 'assistant', content: 'Assistant', timestamp: '2026-03-24T16:31:00Z' },
        { id: '3', role: 'user', content: 'User 2', timestamp: '2026-03-24T14:15:00Z' },
        { id: '4', role: 'system', content: 'System', timestamp: '2026-03-24T10:00:00Z' },
        { id: '5', role: 'tool', content: 'Tool result', timestamp: '2026-03-24T10:01:00Z' },
      ] as Message[]

      const result = extractUserMessages(messages)
      
      expect(result).toHaveLength(2)
      expect(result[0]!.content).toBe('User 1')
      expect(result[1]!.content).toBe('User 2')
    })

    it('orders by timestamp descending (newest first)', () => {
      const messages: Message[] = [
        { id: '1', role: 'user', content: 'Oldest', timestamp: '2026-03-24T10:00:00Z' },
        { id: '2', role: 'user', content: 'Newest', timestamp: '2026-03-24T16:30:00Z' },
        { id: '3', role: 'user', content: 'Middle', timestamp: '2026-03-24T14:15:00Z' },
      ] as Message[]

      const result = extractUserMessages(messages)
      
      expect(result[0]!.content).toBe('Newest')
      expect(result[1]!.content).toBe('Middle')
      expect(result[2]!.content).toBe('Oldest')
    })
  })

  describe('buildHistoryFromMessages', () => {
    it('builds history with correct format', () => {
      const messages: Message[] = [
        { id: '1', role: 'user', content: 'Test prompt', timestamp: '2026-03-24T16:30:00Z' },
      ] as Message[]

      const result = buildHistoryFromMessages(messages, 10)
      
      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe('1')
      expect(result[0]!.content).toBe('Test prompt')
      // Check format matches YYYY/MM/DD HH:MM pattern (local time)
      expect(result[0]!.formattedTimestamp).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/)
      expect(result[0]!.trimmedContent).toBe('Test prompt')
    })

    it('orders messages from oldest to newest (newest at bottom)', () => {
      const messages: Message[] = [
        { id: '1', role: 'user', content: 'Oldest', timestamp: '2026-03-24T10:00:00Z' },
        { id: '2', role: 'user', content: 'Middle', timestamp: '2026-03-24T14:15:00Z' },
        { id: '3', role: 'user', content: 'Newest', timestamp: '2026-03-24T16:30:00Z' },
      ] as Message[]

      const result = buildHistoryFromMessages(messages, 10)
      
      expect(result[0]!.content).toBe('Oldest')
      expect(result[1]!.content).toBe('Middle')
      expect(result[2]!.content).toBe('Newest')
    })

    it('limits to 10 most recent messages', () => {
      const messages: Message[] = Array.from({ length: 15 }, (_, i) => ({
        id: `msg${i}`,
        role: 'user' as const,
        content: `Prompt ${i}`,
        timestamp: `2026-03-24T${String(10 + i).padStart(2, '0')}:00:00Z`,
      })) as Message[]

      const result = buildHistoryFromMessages(messages, 10)
      
      expect(result).toHaveLength(10)
      // Should have the 10 most recent (timestamps from 19:00 to 24:00)
      expect(result[0]!.content).toBe('Prompt 5') // oldest of the top 10
      expect(result[9]!.content).toBe('Prompt 14') // newest
    })

    it('trims long content to 150 characters', () => {
      const longContent = 'A'.repeat(200)
      const messages: Message[] = [
        { id: '1', role: 'user', content: longContent, timestamp: '2026-03-24T16:30:00Z' },
      ] as Message[]

      const result = buildHistoryFromMessages(messages, 10)
      
      expect(result[0]!.trimmedContent.length).toBe(153)
      expect(result[0]!.trimmedContent).toContain('...')
    })
  })

  describe('buildFromSessions', () => {
    it('aggregates prompts from all sessions and returns most recent 10', () => {
      const sessions: SessionSummary[] = [
        mockSession({
          id: 'session-1',
          title: 'Session 1',
          createdAt: '2026-03-24T10:00:00Z',
          updatedAt: '2026-03-24T10:30:00Z',
          recentUserPrompts: [
            { id: 'p1', content: 'Old prompt 1', timestamp: '2026-03-24T10:10:00Z' },
            { id: 'p2', content: 'Old prompt 2', timestamp: '2026-03-24T10:20:00Z' },
          ],
        }),
        mockSession({
          id: 'session-2',
          title: 'Session 2',
          createdAt: '2026-03-24T12:00:00Z',
          updatedAt: '2026-03-24T14:00:00Z',
          recentUserPrompts: [
            { id: 'p3', content: 'Newer prompt 1', timestamp: '2026-03-24T13:00:00Z' },
            { id: 'p4', content: 'Newer prompt 2', timestamp: '2026-03-24T13:30:00Z' },
          ],
        }),
      ]

      const result = buildFromSessions(sessions)
      
      expect(result).toHaveLength(4)
      // Should be sorted oldest to newest
      expect(result[0]!.content).toBe('Old prompt 1')
      expect(result[1]!.content).toBe('Old prompt 2')
      expect(result[2]!.content).toBe('Newer prompt 1')
      expect(result[3]!.content).toBe('Newer prompt 2')
      // Should include session info
      expect(result[0]!.sessionId).toBe('session-1')
      expect(result[3]!.sessionId).toBe('session-2')
    })

    it('limits to 10 most recent prompts across all sessions', () => {
      const sessions: SessionSummary[] = [
        mockSession({
          id: 'session-1',
          title: 'Session 1',
          createdAt: '2026-03-24T10:00:00Z',
          updatedAt: '2026-03-24T12:00:00Z',
          recentUserPrompts: Array.from({ length: 8 }, (_, i) => ({
            id: `p${i}`,
            content: `Session1 prompt ${i}`,
            timestamp: `2026-03-24T10:${String(i).padStart(2, '0')}:00Z`,
          })),
        }),
        mockSession({
          id: 'session-2',
          title: 'Session 2',
          createdAt: '2026-03-24T13:00:00Z',
          updatedAt: '2026-03-24T15:00:00Z',
          recentUserPrompts: Array.from({ length: 8 }, (_, i) => ({
            id: `p${i + 8}`,
            content: `Session2 prompt ${i}`,
            timestamp: `2026-03-24T${String(13 + Math.floor(i / 3)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`,
          })),
        }),
      ]

      const result = buildFromSessions(sessions)
      
      expect(result).toHaveLength(10)
      // Should have the 10 most recent prompts (from session-2 and the newest from session-1)
      expect(result[0]!.content).toContain('Session') // oldest of top 10
      expect(result[9]!.content).toContain('Session') // newest
    })

    it('sorts all prompts chronologically oldest to newest', () => {
      const sessions: SessionSummary[] = [
        mockSession({
          id: 'session-1',
          title: 'Session 1',
          createdAt: '2026-03-24T10:00:00Z',
          updatedAt: '2026-03-24T10:30:00Z',
          recentUserPrompts: [
            { id: 'p1', content: 'Prompt A', timestamp: '2026-03-24T10:15:00Z' },
            { id: 'p2', content: 'Prompt C', timestamp: '2026-03-24T10:25:00Z' },
          ],
        }),
        mockSession({
          id: 'session-2',
          title: 'Session 2',
          createdAt: '2026-03-24T11:00:00Z',
          updatedAt: '2026-03-24T11:30:00Z',
          recentUserPrompts: [
            { id: 'p3', content: 'Prompt B', timestamp: '2026-03-24T11:10:00Z' },
          ],
        }),
      ]

      const result = buildFromSessions(sessions)
      
      expect(result).toHaveLength(3)
      expect(result[0]!.content).toBe('Prompt A') // 10:15
      expect(result[1]!.content).toBe('Prompt C') // 10:25
      expect(result[2]!.content).toBe('Prompt B') // 11:10
    })
  })

  describe('buildCombinedHistory', () => {
    it('combines current session messages with other sessions', () => {
      const currentMessages: Message[] = [
        { id: 'curr1', role: 'user', content: 'Current session prompt 1', timestamp: '2026-03-24T14:00:00Z' },
        { id: 'curr2', role: 'user', content: 'Current session prompt 2', timestamp: '2026-03-24T15:00:00Z' },
      ] as Message[]

      const otherSessions: SessionSummary[] = [
        mockSession({
          id: 'session-1',
          title: 'Old Session',
          createdAt: '2026-03-23T10:00:00Z',
          updatedAt: '2026-03-23T12:00:00Z',
          recentUserPrompts: [
            { id: 'old1', content: 'Old prompt 1', timestamp: '2026-03-23T10:30:00Z' },
            { id: 'old2', content: 'Old prompt 2', timestamp: '2026-03-23T11:30:00Z' },
          ],
        }),
      ]

      const result = buildCombinedHistory(currentMessages, otherSessions, 'curr-session')

      expect(result).toHaveLength(4)
      // Should be sorted oldest to newest
      expect(result[0]!.content).toBe('Old prompt 1')
      expect(result[1]!.content).toBe('Old prompt 2')
      expect(result[2]!.content).toBe('Current session prompt 1')
      expect(result[3]!.content).toBe('Current session prompt 2')
      // Should have correct session names
      expect(result[0]!.sessionName).toBe('Old Session')
      expect(result[2]!.sessionName).toBe('This session')
    })

    it('limits to 10 most recent prompts across all sessions', () => {
      const currentMessages: Message[] = Array.from({ length: 8 }, (_, i) => ({
        id: `curr${i}`,
        role: 'user' as const,
        content: `Current prompt ${i}`,
        timestamp: `2026-03-24T${String(10 + i).padStart(2, '0')}:00:00Z`,
      })) as Message[]

      const otherSessions: SessionSummary[] = [
        mockSession({
          id: 'session-1',
          title: 'Old Session',
          createdAt: '2026-03-23T10:00:00Z',
          updatedAt: '2026-03-23T12:00:00Z',
          recentUserPrompts: Array.from({ length: 8 }, (_, i) => ({
            id: `old${i}`,
            content: `Old prompt ${i}`,
            timestamp: `2026-03-23T${String(10 + i).padStart(2, '0')}:00:00Z`,
          })),
        }),
      ]

      const result = buildCombinedHistory(currentMessages, otherSessions, 'curr-session')

      expect(result).toHaveLength(10)
      // Should have the 10 most recent prompts (mix of current and old)
      expect(result[0]!.sessionName).toBe('Old Session')
      expect(result[9]!.sessionName).toBe('This session')
    })

    it('excludes the current session from other sessions list', () => {
      const currentMessages: Message[] = [
        { id: 'curr1', role: 'user', content: 'Current prompt', timestamp: '2026-03-24T14:00:00Z' },
      ] as Message[]

      const otherSessions: SessionSummary[] = [
        mockSession({
          id: 'curr-session', // Same as currentSessionId - should be skipped
          title: 'Current Session Title',
          createdAt: '2026-03-24T10:00:00Z',
          updatedAt: '2026-03-24T14:00:00Z',
          recentUserPrompts: [
            { id: 'skip1', content: 'Should be skipped', timestamp: '2026-03-24T11:00:00Z' },
          ],
        }),
        mockSession({
          id: 'other-session',
          title: 'Other Session',
          createdAt: '2026-03-23T10:00:00Z',
          updatedAt: '2026-03-23T12:00:00Z',
          recentUserPrompts: [
            { id: 'other1', content: 'Other prompt', timestamp: '2026-03-23T11:00:00Z' },
          ],
        }),
      ]

      const result = buildCombinedHistory(currentMessages, otherSessions, 'curr-session')

      expect(result).toHaveLength(2)
      expect(result[0]!.content).toBe('Other prompt')
      expect(result[1]!.content).toBe('Current prompt')
      // Should not have "Should be skipped"
      expect(result.some(item => item.content === 'Should be skipped')).toBe(false)
    })
  })
})
