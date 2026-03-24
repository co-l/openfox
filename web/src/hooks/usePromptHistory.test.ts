import { describe, expect, it } from 'vitest'
import { buildHistoryFromMessages, formatTimestamp, extractUserMessages } from './usePromptHistory'
import { trimContent } from '../lib/cross-session-history'
import type { Message } from '../../../src/shared/types'

describe('usePromptHistory helpers', () => {
  describe('formatTimestamp', () => {
    it('formats ISO timestamp to YYYY/MM/DD HH:MM in local time', () => {
      // Note: This will use local timezone, so the actual hour depends on the test environment
      const result = formatTimestamp('2026-03-24T16:30:45Z')
      expect(result).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/)
    })

    it('pads single digit months and days', () => {
      expect(formatTimestamp('2026-03-05T10:05:00Z')).toMatch(/2026\/03\/05/)
    })
  })

  describe('trimContent', () => {
    it('returns content as-is if within limit', () => {
      expect(trimContent('Short text', 150)).toBe('Short text')
    })

    it('trims to maxLength and adds ellipsis', () => {
      const result = trimContent('A'.repeat(200), 150)
      expect(result.length).toBe(153) // 150 + '...'
      expect(result).toContain('...')
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
      expect(result[0].content).toBe('User 1')
      expect(result[1].content).toBe('User 2')
    })

    it('orders by timestamp descending (newest first)', () => {
      const messages: Message[] = [
        { id: '1', role: 'user', content: 'Oldest', timestamp: '2026-03-24T10:00:00Z' },
        { id: '2', role: 'user', content: 'Newest', timestamp: '2026-03-24T16:30:00Z' },
        { id: '3', role: 'user', content: 'Middle', timestamp: '2026-03-24T14:15:00Z' },
      ] as Message[]

      const result = extractUserMessages(messages)
      
      expect(result[0].content).toBe('Newest')
      expect(result[1].content).toBe('Middle')
      expect(result[2].content).toBe('Oldest')
    })
  })

  describe('buildHistoryFromMessages', () => {
    it('builds history with correct format', () => {
      const messages: Message[] = [
        { id: '1', role: 'user', content: 'Test prompt', timestamp: '2026-03-24T16:30:00Z' },
      ] as Message[]

      const result = buildHistoryFromMessages(messages, 10)
      
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('1')
      expect(result[0].content).toBe('Test prompt')
      // Check format matches YYYY/MM/DD HH:MM pattern (local time)
      expect(result[0].formattedTimestamp).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/)
      expect(result[0].trimmedContent).toBe('Test prompt')
    })

    it('orders messages from oldest to newest (newest at bottom)', () => {
      const messages: Message[] = [
        { id: '1', role: 'user', content: 'Oldest', timestamp: '2026-03-24T10:00:00Z' },
        { id: '2', role: 'user', content: 'Middle', timestamp: '2026-03-24T14:15:00Z' },
        { id: '3', role: 'user', content: 'Newest', timestamp: '2026-03-24T16:30:00Z' },
      ] as Message[]

      const result = buildHistoryFromMessages(messages, 10)
      
      expect(result[0].content).toBe('Oldest')
      expect(result[1].content).toBe('Middle')
      expect(result[2].content).toBe('Newest')
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
    })

    it('trims long content to 150 characters', () => {
      const longContent = 'A'.repeat(200)
      const messages: Message[] = [
        { id: '1', role: 'user', content: longContent, timestamp: '2026-03-24T16:30:00Z' },
      ] as Message[]

      const result = buildHistoryFromMessages(messages, 10)
      
      expect(result[0].trimmedContent.length).toBe(153)
      expect(result[0].trimmedContent).toContain('...')
    })
  })
})
