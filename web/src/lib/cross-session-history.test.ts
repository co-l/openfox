import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import {
  savePromptToHistory,
  getCrossSessionHistory,
  getRecentCrossSessionPrompts,
  clearCrossSessionHistory,
  buildCrossSessionHistoryFromStorage,
  formatTimestampLocal,
  trimContent,
} from './cross-session-history'
import type { Message } from '../../../src/shared/types'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString()
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
})()

vi.stubGlobal('localStorage', localStorageMock)

describe('cross-session-history', () => {
  beforeEach(() => {
    localStorageMock.clear()
  })

  afterEach(() => {
    localStorageMock.clear()
  })

  describe('formatTimestampLocal', () => {
    it('formats ISO timestamp to YYYY/MM/DD HH:MM in local time', () => {
      const result = formatTimestampLocal('2026-03-24T16:30:45Z')
      expect(result).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/)
    })

    it('pads single digit months and days', () => {
      expect(formatTimestampLocal('2026-03-05T10:05:00Z')).toMatch(/2026\/03\/05/)
    })
  })

  describe('trimContent', () => {
    it('returns content as-is if within limit', () => {
      expect(trimContent('Short text', 150)).toBe('Short text')
    })

    it('trims to maxLength and adds ellipsis', () => {
      const result = trimContent('A'.repeat(200), 150)
      expect(result.length).toBe(153)
      expect(result).toContain('...')
    })
  })

  describe('savePromptToHistory', () => {
    it('saves user messages to localStorage', () => {
      const message: Message = {
        id: 'msg1',
        role: 'user',
        content: 'Test prompt',
        timestamp: '2026-03-24T16:30:00Z',
      } as Message

      savePromptToHistory(message)
      
      const history = getCrossSessionHistory()
      expect(history).toHaveLength(1)
      expect(history[0].content).toBe('Test prompt')
      expect(history[0].sessionId).toBeTruthy()
    })

    it('ignores non-user messages', () => {
      const message: Message = {
        id: 'msg1',
        role: 'assistant',
        content: 'Assistant response',
        timestamp: '2026-03-24T16:30:00Z',
      } as Message

      savePromptToHistory(message)
      
      const history = getCrossSessionHistory()
      expect(history).toHaveLength(0)
    })

    it('maintains order with newest first', () => {
      const msg1: Message = {
        id: 'msg1',
        role: 'user',
        content: 'First prompt',
        timestamp: '2026-03-24T10:00:00Z',
      } as Message

      const msg2: Message = {
        id: 'msg2',
        role: 'user',
        content: 'Second prompt',
        timestamp: '2026-03-24T14:00:00Z',
      } as Message

      const msg3: Message = {
        id: 'msg3',
        role: 'user',
        content: 'Third prompt',
        timestamp: '2026-03-24T16:00:00Z',
      } as Message

      savePromptToHistory(msg1)
      savePromptToHistory(msg2)
      savePromptToHistory(msg3)
      
      const history = getCrossSessionHistory()
      expect(history).toHaveLength(3)
      expect(history[0].content).toBe('Third prompt')  // Newest first
      expect(history[1].content).toBe('Second prompt')
      expect(history[2].content).toBe('First prompt')   // Oldest last
    })

    it('limits history to 10 items', () => {
      for (let i = 0; i < 15; i++) {
        const message: Message = {
          id: `msg${i}`,
          role: 'user',
          content: `Prompt ${i}`,
          timestamp: `2026-03-24T${String(10 + i).padStart(2, '0')}:00:00Z`,
        } as Message
        savePromptToHistory(message)
      }
      
      const history = getCrossSessionHistory()
      expect(history).toHaveLength(10)
      expect(history[0].content).toBe('Prompt 14')  // Most recent
      expect(history[9].content).toBe('Prompt 5')    // 10th most recent
    })

    it('trims long content to 150 characters', () => {
      const longContent = 'A'.repeat(200)
      const message: Message = {
        id: 'msg1',
        role: 'user',
        content: longContent,
        timestamp: '2026-03-24T16:30:00Z',
      } as Message

      savePromptToHistory(message)
      
      const history = getCrossSessionHistory()
      expect(history[0].trimmedContent.length).toBe(153)
      expect(history[0].trimmedContent).toContain('...')
    })
  })

  describe('getCrossSessionHistory', () => {
    it('returns empty array when no history exists', () => {
      expect(getCrossSessionHistory()).toHaveLength(0)
    })

    it('returns history ordered from newest to oldest', () => {
      const msg1: Message = {
        id: 'msg1',
        role: 'user',
        content: 'Oldest',
        timestamp: '2026-03-24T10:00:00Z',
      } as Message

      const msg2: Message = {
        id: 'msg2',
        role: 'user',
        content: 'Newest',
        timestamp: '2026-03-24T16:00:00Z',
      } as Message

      savePromptToHistory(msg1)
      savePromptToHistory(msg2)
      
      const history = getCrossSessionHistory()
      expect(history[0].content).toBe('Newest')
      expect(history[1].content).toBe('Oldest')
    })
  })

  describe('getRecentCrossSessionPrompts', () => {
    it('returns limited number of recent prompts', () => {
      for (let i = 0; i < 15; i++) {
        const message: Message = {
          id: `msg${i}`,
          role: 'user',
          content: `Prompt ${i}`,
          timestamp: `2026-03-24T${String(10 + i).padStart(2, '0')}:00:00Z`,
        } as Message
        savePromptToHistory(message)
      }
      
      const recent = getRecentCrossSessionPrompts(5)
      expect(recent).toHaveLength(5)
      expect(recent[0].content).toBe('Prompt 14')
      expect(recent[4].content).toBe('Prompt 10')
    })
  })

  describe('buildCrossSessionHistoryFromStorage', () => {
    it('returns cross-session history when current session is empty', () => {
      const messages: Message[] = [
        { id: 'msg1', role: 'user', content: 'Session 1 prompt', timestamp: '2026-03-24T10:00:00Z' },
        { id: 'msg2', role: 'user', content: 'Session 1 prompt 2', timestamp: '2026-03-24T11:00:00Z' },
      ] as Message[]

      messages.forEach(savePromptToHistory)
      
      const history = buildCrossSessionHistoryFromStorage()
      expect(history).toHaveLength(2)
      expect(history[0].content).toBe('Session 1 prompt 2')  // Newest first
      expect(history[1].content).toBe('Session 1 prompt')
    })
  })

  describe('clearCrossSessionHistory', () => {
    it('clears all stored history', () => {
      const message: Message = {
        id: 'msg1',
        role: 'user',
        content: 'Test',
        timestamp: '2026-03-24T16:30:00Z',
      } as Message

      savePromptToHistory(message)
      expect(getCrossSessionHistory()).toHaveLength(1)
      
      clearCrossSessionHistory()
      expect(getCrossSessionHistory()).toHaveLength(0)
    })
  })
})
