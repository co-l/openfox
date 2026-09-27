import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createToolProgressHandler, parseProgressMessage, MAX_TOOL_OUTPUT_EVENTS_PER_CALL } from './tool-streaming.js'
import { EventStore } from '../events/store.js'
import Database from 'better-sqlite3'

let db: Database.Database
let eventStore: EventStore
let append: (event: import('../events/types.js').TurnEvent) => void

describe('tool streaming', () => {
  beforeEach(() => {
    db = new Database(':memory:')
    eventStore = new EventStore(db)
    append = (event) => {
      eventStore.append('test-session', event)
    }
    ;(global as any).__eventStore = eventStore
  })

  afterEach(() => {
    db.close()
  })

  describe('parseProgressMessage', () => {
    it('parses [stdout] prefix correctly', () => {
      const result = parseProgressMessage('[stdout] hello world')

      expect(result).toEqual({
        stream: 'stdout',
        content: 'hello world',
      })
    })

    it('parses [stderr] prefix correctly', () => {
      const result = parseProgressMessage('[stderr] error occurred')

      expect(result).toEqual({
        stream: 'stderr',
        content: 'error occurred',
      })
    })

    it('preserves content with newlines', () => {
      const result = parseProgressMessage('[stdout] line1\nline2\nline3')

      expect(result).toEqual({
        stream: 'stdout',
        content: 'line1\nline2\nline3',
      })
    })

    it('returns null for malformed messages', () => {
      expect(parseProgressMessage('no prefix here')).toBeNull()
      expect(parseProgressMessage('[invalid] content')).toBeNull()
      expect(parseProgressMessage('')).toBeNull()
    })

    it('handles edge case of empty content after prefix', () => {
      const result = parseProgressMessage('[stdout] ')

      expect(result).toEqual({
        stream: 'stdout',
        content: '',
      })
    })

    it('handles content that looks like a prefix', () => {
      const result = parseProgressMessage('[stdout] [stderr] nested')

      expect(result).toEqual({
        stream: 'stdout',
        content: '[stderr] nested',
      })
    })
  })

  describe('createToolProgressHandler', () => {
    it('creates handler that emits tool.output events to EventStore', () => {
      const handler = createToolProgressHandler(append, 'msg-1', 'call-1', 'test-session')
      handler('[stdout] test output')

      const events = eventStore.getEvents('test-session')

      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe('tool.output')
      expect(events[0]!.data).toEqual({
        messageId: 'msg-1',
        toolCallId: 'call-1',
        stream: 'stdout',
        content: 'test output',
      })
    })

    it('handles multiple progress calls', () => {
      const handler = createToolProgressHandler(append, 'msg-1', 'call-1', 'test-session')
      handler('[stdout] line1')
      handler('[stdout] line2')
      handler('[stderr] warning')

      const events = eventStore.getEvents('test-session')

      expect(events).toHaveLength(3)
      expect(events[0]!.data).toMatchObject({ stream: 'stdout', content: 'line1' })
      expect(events[1]!.data).toMatchObject({ stream: 'stdout', content: 'line2' })
      expect(events[2]!.data).toMatchObject({ stream: 'stderr', content: 'warning' })
    })

    it('ignores malformed progress messages', () => {
      const handler = createToolProgressHandler(append, 'msg-1', 'call-1', 'test-session')
      handler('not a valid progress message')
      handler('[invalid] prefix')

      const events = eventStore.getEvents('test-session')

      expect(events).toHaveLength(0)
    })

    it('passes correct messageId and callId for each call', () => {
      const handler1 = createToolProgressHandler(append, 'msg-A', 'call-A', 'test-session')
      const handler2 = createToolProgressHandler(append, 'msg-B', 'call-B', 'test-session')

      handler1('[stdout] from A')
      handler2('[stdout] from B')

      const events = eventStore.getEvents('test-session')

      expect(events[0]!.data).toMatchObject({
        messageId: 'msg-A',
        toolCallId: 'call-A',
        content: 'from A',
      })
      expect(events[1]!.data).toMatchObject({
        messageId: 'msg-B',
        toolCallId: 'call-B',
        content: 'from B',
      })
    })

    it('caps persisted tool.output events per call at MAX_TOOL_OUTPUT_EVENTS_PER_CALL', () => {
      const handler = createToolProgressHandler(append, 'msg-1', 'call-1', 'test-session')
      for (let i = 0; i < MAX_TOOL_OUTPUT_EVENTS_PER_CALL + 100; i++) {
        handler(`[stdout] line ${i}`)
      }

      const events = eventStore.getEvents('test-session')
      expect(events).toHaveLength(MAX_TOOL_OUTPUT_EVENTS_PER_CALL)
      expect(events[0]!.data).toMatchObject({ content: 'line 0' })
      expect(events[MAX_TOOL_OUTPUT_EVENTS_PER_CALL - 1]!.data).toMatchObject({
        content: `line ${MAX_TOOL_OUTPUT_EVENTS_PER_CALL - 1}`,
      })
    })

    it('counts the cap per tool call, not per session', () => {
      const handler1 = createToolProgressHandler(append, 'msg-A', 'call-A', 'test-session')
      const handler2 = createToolProgressHandler(append, 'msg-B', 'call-B', 'test-session')
      for (let i = 0; i < MAX_TOOL_OUTPUT_EVENTS_PER_CALL; i++) {
        handler1(`[stdout] A ${i}`)
      }
      handler2('[stdout] B first')

      const events = eventStore.getEvents('test-session')
      expect(events).toHaveLength(MAX_TOOL_OUTPUT_EVENTS_PER_CALL + 1)
      expect(events[MAX_TOOL_OUTPUT_EVENTS_PER_CALL]!.data).toMatchObject({
        toolCallId: 'call-B',
        content: 'B first',
      })
    })
  })
})
