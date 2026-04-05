/**
 * Unit tests for LLM message conversion with attachments
 */

import { describe, it, expect } from 'vitest'
import { convertMessages } from './client-pure.js'
import type { LLMMessage } from './types.js'

describe('LLM Message Conversion with Attachments', () => {
  describe('convertMessages', () => {
    it('should handle user messages with attachments', () => {
      const messages: LLMMessage[] = [
        {
          role: 'user',
          content: 'What is in this image?',
          attachments: [
            {
              id: 'test-1',
              filename: 'test.png',
              mimeType: 'image/png',
              size: 1000,
              data: 'data:image/png;base64,test',
            },
          ],
        },
      ]

      const result = convertMessages(messages, { modelSupportsVision: true, visionFallbackEnabled: false })
      
      expect(result).toHaveLength(1)
      const msg = result[0]
      expect(msg?.role).toBe('user')
      expect(msg?.content).toBeInstanceOf(Array)
      
      const content = msg?.content as Array<{ type: string; text?: string; image_url?: { url: string } }>
      expect(content).toHaveLength(2)
      expect(content[0]).toEqual({ type: 'text', text: 'What is in this image?' })
      expect(content[1]).toEqual({
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,test' },
      })
    })

    it('should handle user messages with multiple attachments', () => {
      const messages: LLMMessage[] = [
        {
          role: 'user',
          content: 'Compare these images',
          attachments: [
            {
              id: 'test-1',
              filename: 'img1.png',
              mimeType: 'image/png',
              size: 1000,
              data: 'data:image/png;base64,test1',
            },
            {
              id: 'test-2',
              filename: 'img2.jpg',
              mimeType: 'image/jpeg',
              size: 2000,
              data: 'data:image/jpeg;base64,test2',
            },
          ],
        },
      ]

      const result = convertMessages(messages, { modelSupportsVision: true, visionFallbackEnabled: false })
      
      expect(result).toHaveLength(1)
      const msg2 = result[0]
      const content = msg2?.content as Array<{ type: string; text?: string; image_url?: { url: string } }>
      expect(content).toHaveLength(3) // 1 text + 2 images
      expect(content[0]).toEqual({ type: 'text', text: 'Compare these images' })
      expect(content[1]).toEqual({
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,test1' },
      })
      expect(content[2]).toEqual({
        type: 'image_url',
        image_url: { url: 'data:image/jpeg;base64,test2' },
      })
    })

    it('should handle user messages with only attachments (no text)', () => {
      const messages: LLMMessage[] = [
        {
          role: 'user',
          content: '',
          attachments: [
            {
              id: 'test-1',
              filename: 'test.png',
              mimeType: 'image/png',
              size: 1000,
              data: 'data:image/png;base64,test',
            },
          ],
        },
      ]

      const result = convertMessages(messages, { modelSupportsVision: true, visionFallbackEnabled: false })
      
      expect(result).toHaveLength(1)
      const msg3 = result[0]
      const content = msg3?.content as Array<{ type: string; text?: string; image_url?: { url: string } }>
      expect(content).toHaveLength(1) // Only image, no text
      expect(content[0]).toEqual({
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,test' },
      })
    })

    it('should handle regular messages without attachments', () => {
      const messages: LLMMessage[] = [
        {
          role: 'user',
          content: 'Hello, how are you?',
        },
      ]

      const result = convertMessages(messages, { modelSupportsVision: true, visionFallbackEnabled: false })
      
      expect(result).toHaveLength(1)
      const msg4 = result[0]
      expect(msg4?.role).toBe('user')
      expect(msg4?.content).toBe('Hello, how are you?')
    })

    it('should handle assistant messages with tool calls', () => {
      const messages: LLMMessage[] = [
        {
          role: 'assistant',
          content: 'Let me check that for you',
          toolCalls: [
            {
              id: 'tool-1',
              name: 'search',
              arguments: { query: 'test' },
            },
          ],
        },
      ]

      const result = convertMessages(messages, { modelSupportsVision: true, visionFallbackEnabled: false })
      
      expect(result).toHaveLength(1)
      const msg5 = result[0]
      expect(msg5?.role).toBe('assistant')
      expect(msg5).toHaveProperty('tool_calls')
    })

    it('should handle tool messages', () => {
      const messages: LLMMessage[] = [
        {
          role: 'tool',
          content: 'Search results: ...',
          toolCallId: 'tool-1',
        },
      ]

      const result = convertMessages(messages, { modelSupportsVision: true, visionFallbackEnabled: false })
      
      expect(result).toHaveLength(1)
      const msg6 = result[0]
      expect(msg6?.role).toBe('tool')
      expect((msg6 as any).tool_call_id).toBe('tool-1')
    })

    it('should filter out empty assistant messages', () => {
      const messages: LLMMessage[] = [
        {
          role: 'assistant',
          content: '',
          toolCalls: [],
        },
        {
          role: 'user',
          content: 'Hello',
        },
      ]

      const result = convertMessages(messages, { modelSupportsVision: true, visionFallbackEnabled: false })
      
      expect(result).toHaveLength(1)
      const msg7 = result[0]
      expect(msg7?.role).toBe('user')
    })
  })
})
