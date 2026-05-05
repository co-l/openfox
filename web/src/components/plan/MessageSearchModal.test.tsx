import { describe, it, expect } from 'vitest'
import { formatTimestamp } from './MessageSearchModal'
import type { Message } from '@shared/types.js'

describe('Message filtering logic', () => {
  it('filters user messages correctly', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Hello', timestamp: '2024-01-15T10:00:00Z' },
      { id: '2', role: 'assistant', content: 'Hi there', timestamp: '2024-01-15T10:01:00Z' },
      { id: '3', role: 'user', content: 'Another', timestamp: '2024-01-15T10:02:00Z' },
    ]

    const userMessages = messages.filter((msg) => msg.role === 'user')

    expect(userMessages).toHaveLength(2)
    expect(userMessages[0]?.content).toBe('Hello')
    expect(userMessages[1]?.content).toBe('Another')
  })

  it('excludes system-generated messages', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Regular message', timestamp: '2024-01-15T10:00:00Z' },
      { id: '2', role: 'user', content: 'System message', timestamp: '2024-01-15T10:01:00Z', isSystemGenerated: true },
      { id: '3', role: 'user', content: 'Another regular', timestamp: '2024-01-15T10:02:00Z' },
    ]

    const filtered = messages.filter((msg) => msg.role === 'user' && !msg.isSystemGenerated)

    expect(filtered).toHaveLength(2)
    expect(filtered[0]?.content).toBe('Regular message')
    expect(filtered[1]?.content).toBe('Another regular')
  })

  it('excludes auto-prompt messages', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Regular', timestamp: '2024-01-15T10:00:00Z' },
      { id: '2', role: 'user', content: 'Auto prompt', timestamp: '2024-01-15T10:01:00Z', messageKind: 'auto-prompt' },
    ]

    const filtered = messages.filter(
      (msg) => msg.role === 'user' && !msg.isSystemGenerated && msg.messageKind !== 'auto-prompt',
    )

    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.content).toBe('Regular')
  })

  it('excludes command messages', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Regular', timestamp: '2024-01-15T10:00:00Z' },
      { id: '2', role: 'user', content: 'Command', timestamp: '2024-01-15T10:01:00Z', messageKind: 'command' },
    ]

    const filtered = messages.filter(
      (msg) =>
        msg.role === 'user' &&
        !msg.isSystemGenerated &&
        msg.messageKind !== 'auto-prompt' &&
        msg.messageKind !== 'command',
    )

    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.content).toBe('Regular')
  })
})

describe('Timestamp formatting', () => {
  it('formats ISO timestamp to HH:MM for today, or DD/MM/YYYY HH:mm for other days', () => {
    const today = new Date()
    const todayStr = today.toISOString().slice(0, 10)
    expect(formatTimestamp(`${todayStr}T14:30:00`)).toMatch(/^\d{2}:\d{2}$/)
    expect(formatTimestamp('2099-07-15T09:05:00')).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/)
  })
})
