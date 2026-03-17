import { describe, it, expect, vi } from 'vitest'
import type { ServerMessage } from '../../shared/protocol.js'
import { createToolProgressHandler, parseProgressMessage } from './tool-streaming.js'

describe('tool streaming', () => {
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
    it('creates handler that emits chat.tool_output events', () => {
      const messages: ServerMessage[] = []
      const onMessage = vi.fn((msg: ServerMessage) => messages.push(msg))
      
      const handler = createToolProgressHandler('msg-1', 'call-1', onMessage)
      handler('[stdout] test output')
      
      expect(messages).toHaveLength(1)
      expect(messages[0]!.type).toBe('chat.tool_output')
      expect(messages[0]!.payload).toEqual({
        messageId: 'msg-1',
        callId: 'call-1',
        output: 'test output',
        stream: 'stdout',
      })
    })

    it('handles multiple progress calls', () => {
      const messages: ServerMessage[] = []
      const onMessage = vi.fn((msg: ServerMessage) => messages.push(msg))
      
      const handler = createToolProgressHandler('msg-1', 'call-1', onMessage)
      handler('[stdout] line1')
      handler('[stdout] line2')
      handler('[stderr] warning')
      
      expect(messages).toHaveLength(3)
      expect(messages[0]!.payload).toMatchObject({ stream: 'stdout', output: 'line1' })
      expect(messages[1]!.payload).toMatchObject({ stream: 'stdout', output: 'line2' })
      expect(messages[2]!.payload).toMatchObject({ stream: 'stderr', output: 'warning' })
    })

    it('ignores malformed progress messages', () => {
      const messages: ServerMessage[] = []
      const onMessage = vi.fn((msg: ServerMessage) => messages.push(msg))
      
      const handler = createToolProgressHandler('msg-1', 'call-1', onMessage)
      handler('not a valid progress message')
      handler('[invalid] prefix')
      
      expect(messages).toHaveLength(0)
      expect(onMessage).not.toHaveBeenCalled()
    })

    it('passes correct messageId and callId for each call', () => {
      const messages: ServerMessage[] = []
      const onMessage = vi.fn((msg: ServerMessage) => messages.push(msg))
      
      const handler1 = createToolProgressHandler('msg-A', 'call-A', onMessage)
      const handler2 = createToolProgressHandler('msg-B', 'call-B', onMessage)
      
      handler1('[stdout] from A')
      handler2('[stdout] from B')
      
      expect(messages[0]!.payload).toMatchObject({
        messageId: 'msg-A',
        callId: 'call-A',
      })
      expect(messages[1]!.payload).toMatchObject({
        messageId: 'msg-B',
        callId: 'call-B',
      })
    })
  })
})
