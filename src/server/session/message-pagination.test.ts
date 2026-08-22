import { describe, expect, it } from 'vitest'
import type { Message } from '../../shared/types.js'
import { paginateMessages } from './message-pagination.js'

function message(id: string, role: Message['role'], content = id): Message {
  return {
    id,
    role,
    content,
    timestamp: '2026-08-22T00:00:00.000Z',
  }
}

function turns(count: number): Message[] {
  return Array.from({ length: count }, (_, index) => {
    const turn = index + 1
    return [message(`user-${turn}`, 'user'), message(`assistant-${turn}`, 'assistant')]
  }).flat()
}

describe('paginateMessages', () => {
  it('returns the ten most recent complete turns by default', () => {
    const page = paginateMessages(turns(12))

    expect(page.messages).toHaveLength(20)
    expect(page.messages[0]!.id).toBe('user-3')
    expect(page.messages.at(-1)!.id).toBe('assistant-12')
    expect(page.hiddenCount).toBe(4)
  })

  it('does not split a turn when the item limit is reached', () => {
    const page = paginateMessages(turns(5), { maxItems: 5, maxTurns: 10 })

    expect(page.messages.map((entry) => entry.id)).toEqual(['user-4', 'assistant-4', 'user-5', 'assistant-5'])
    expect(page.hiddenCount).toBe(6)
  })

  it('uses the serialized byte budget without dropping the newest complete turn', () => {
    const messages = [
      message('user-1', 'user'),
      message('assistant-1', 'assistant', 'a'.repeat(600_000)),
      message('user-2', 'user'),
      message('assistant-2', 'assistant', 'b'.repeat(600_000)),
    ]

    const page = paginateMessages(messages, { maxBytes: 1_000_000 })

    expect(page.messages.map((entry) => entry.id)).toEqual(['user-2', 'assistant-2'])
    expect(page.hiddenCount).toBe(2)
  })

  it('loads the page immediately before a stable message cursor without overlap', () => {
    const messages = turns(6)
    const newest = paginateMessages(messages, { maxTurns: 2 })
    const older = paginateMessages(messages, {
      beforeMessageId: newest.messages[0]!.id,
      maxTurns: 2,
    })

    expect(newest.messages.map((entry) => entry.id)).toEqual(['user-5', 'assistant-5', 'user-6', 'assistant-6'])
    expect(older.messages.map((entry) => entry.id)).toEqual(['user-3', 'assistant-3', 'user-4', 'assistant-4'])
    expect(older.hiddenCount).toBe(4)
  })

  it('keeps system and tool messages attached to their surrounding turn', () => {
    const messages = [
      message('system-1', 'system'),
      message('user-1', 'user'),
      message('assistant-1', 'assistant'),
      message('tool-1', 'tool'),
      message('user-2', 'user'),
      message('assistant-2', 'assistant'),
    ]

    const page = paginateMessages(messages, { maxTurns: 1 })

    expect(page.messages.map((entry) => entry.id)).toEqual(['user-2', 'assistant-2'])
    expect(page.hiddenCount).toBe(4)
  })
})
