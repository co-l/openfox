import { describe, it, expect } from 'vitest'
import {
  createChatToolOutputMessage,
  createChatToolCallMessage,
  createChatToolResultMessage,
  parseClientMessage,
  serializeServerMessage,
} from './protocol.js'

describe('ws/protocol', () => {
  describe('createChatToolOutputMessage', () => {
    it('creates correct message structure for stdout', () => {
      const msg = createChatToolOutputMessage('msg-1', 'call-1', 'hello world', 'stdout')
      
      expect(msg.type).toBe('chat.tool_output')
      expect(msg.payload).toEqual({
        messageId: 'msg-1',
        callId: 'call-1',
        output: 'hello world',
        stream: 'stdout',
      })
    })

    it('creates correct message structure for stderr', () => {
      const msg = createChatToolOutputMessage('msg-2', 'call-2', 'error occurred', 'stderr')
      
      expect(msg.type).toBe('chat.tool_output')
      expect(msg.payload).toEqual({
        messageId: 'msg-2',
        callId: 'call-2',
        output: 'error occurred',
        stream: 'stderr',
      })
    })

    it('handles empty output', () => {
      const msg = createChatToolOutputMessage('msg-1', 'call-1', '', 'stdout')
      
      expect(msg.payload.output).toBe('')
    })

    it('handles output with newlines', () => {
      const msg = createChatToolOutputMessage('msg-1', 'call-1', 'line1\nline2\nline3', 'stdout')
      
      expect(msg.payload.output).toBe('line1\nline2\nline3')
    })

    it('serializes correctly', () => {
      const msg = createChatToolOutputMessage('msg-1', 'call-1', 'test', 'stdout')
      const serialized = serializeServerMessage(msg)
      const parsed = JSON.parse(serialized)
      
      expect(parsed.type).toBe('chat.tool_output')
      expect(parsed.payload.messageId).toBe('msg-1')
      expect(parsed.payload.callId).toBe('call-1')
      expect(parsed.payload.output).toBe('test')
      expect(parsed.payload.stream).toBe('stdout')
    })
  })

  describe('tool message ordering', () => {
    it('tool_call, tool_output, and tool_result have consistent structure', () => {
      const toolCall = createChatToolCallMessage('msg-1', 'call-1', 'run_command', { command: 'ls' })
      const toolOutput = createChatToolOutputMessage('msg-1', 'call-1', 'file.txt', 'stdout')
      const toolResult = createChatToolResultMessage('msg-1', 'call-1', 'run_command', {
        success: true,
        output: 'file.txt',
        durationMs: 50,
        truncated: false,
      })
      
      // All should have matching messageId and callId
      expect(toolCall.payload.messageId).toBe('msg-1')
      expect(toolCall.payload.callId).toBe('call-1')
      
      expect(toolOutput.payload.messageId).toBe('msg-1')
      expect(toolOutput.payload.callId).toBe('call-1')
      
      expect(toolResult.payload.messageId).toBe('msg-1')
      expect(toolResult.payload.callId).toBe('call-1')
    })
  })
})
