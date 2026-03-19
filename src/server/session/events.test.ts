import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerMessage } from '../../shared/protocol.js'
import { SessionEvents } from './events.js'

function createMessage(type: ServerMessage['type']): ServerMessage {
  return { type, payload: {} }
}

describe('SessionEvents', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('pushes events, notifies subscribers, and replays by sequence number', () => {
    const events = new SessionEvents({ maxEvents: 10, cleanupDelayMs: 1_000 })
    const seen: Array<{ event: ServerMessage; seq: number }> = []

    events.subscribe('session-1', (event: ServerMessage, seq: number) => {
      seen.push({ event, seq })
    })

    expect(events.push('session-1', createMessage('chat.delta'))).toBe(0)
    expect(events.push('session-1', createMessage('chat.done'))).toBe(1)

    expect(seen).toEqual([
      { event: createMessage('chat.delta'), seq: 0 },
      { event: createMessage('chat.done'), seq: 1 },
    ])
    expect(events.getEvents('session-1', 1).map((event) => event.seq)).toEqual([1])
    expect(events.getCurrentSeq('session-1')).toBe(2)
    expect(events.hasQueue('session-1')).toBe(true)
    expect(events.getSubscriberCount('session-1')).toBe(1)
  })

  it('trims old events when the queue exceeds maxEvents', () => {
    const events = new SessionEvents({ maxEvents: 2 })

    events.push('session-1', createMessage('chat.delta'))
    events.push('session-1', createMessage('chat.thinking'))
    events.push('session-1', createMessage('chat.done'))

    const replay = events.getEvents('session-1', 0)
    expect(replay).toHaveLength(2)
    expect(replay.map((event: { seq: number }) => event.seq)).toEqual([1, 2])
  })

  it('keeps notifying subscribers when one throws and supports unsubscribe', () => {
    const events = new SessionEvents()
    const first = vi.fn(() => {
      throw new Error('boom')
    })
    const second = vi.fn()

    const unsubscribe = events.subscribe('session-1', first)
    events.subscribe('session-1', second)

    events.push('session-1', createMessage('chat.delta'))
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    unsubscribe()
    expect(events.getSubscriberCount('session-1')).toBe(1)

    events.push('session-1', createMessage('chat.done'))
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('schedules cleanup and cancels pending cleanup on new subscribe', () => {
    const events = new SessionEvents({ cleanupDelayMs: 100 })
    events.push('session-1', createMessage('chat.delta'))

    events.scheduleCleanup('session-1')
    vi.advanceTimersByTime(99)
    expect(events.hasQueue('session-1')).toBe(true)

    events.subscribe('session-1', () => {})
    vi.advanceTimersByTime(1)
    expect(events.hasQueue('session-1')).toBe(true)
  })

  it('clears queues immediately and via clearAll', () => {
    const events = new SessionEvents({ cleanupDelayMs: 100 })
    events.push('session-1', createMessage('chat.delta'))
    events.push('session-2', createMessage('chat.done'))

    events.clear('session-1')
    expect(events.hasQueue('session-1')).toBe(false)
    expect(events.hasQueue('session-2')).toBe(true)

    events.clearAll()
    expect(events.hasQueue('session-2')).toBe(false)
  })

  it('removes a queue when the cleanup timer completes', () => {
    const events = new SessionEvents({ cleanupDelayMs: 50 })
    events.push('session-1', createMessage('chat.delta'))

    events.scheduleCleanup('session-1')
    vi.advanceTimersByTime(50)

    expect(events.hasQueue('session-1')).toBe(false)
    expect(events.getEvents('session-1', 0)).toEqual([])
  })
})
