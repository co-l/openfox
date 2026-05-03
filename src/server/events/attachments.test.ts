/**
 * Unit tests for attachment preservation in event folding
 */

import { describe, it, expect } from 'vitest'
import { buildContextMessagesFromStoredEvents, buildMessagesFromStoredEvents } from './folding.js'
import type { StoredEvent } from './types.js'
import type { Attachment } from '../../shared/types.js'

describe('Attachment Preservation in Event Folding', () => {
  describe('buildMessagesFromStoredEvents', () => {
    it('should preserve attachments when building Message[] from events', () => {
      const testAttachment: Attachment = {
        id: 'test-1',
        filename: 'test.png',
        mimeType: 'image/png',
        size: 1000,
        data: 'data:image/png;base64,test',
      }

      const events: StoredEvent[] = [
        {
          seq: 1,
          timestamp: Date.now(),
          sessionId: 'test-session',
          type: 'message.start',
          data: {
            messageId: 'msg-1',
            role: 'user',
            content: 'What is in this image?',
            attachments: [testAttachment],
          },
        },
        {
          seq: 2,
          timestamp: Date.now(),
          sessionId: 'test-session',
          type: 'message.done',
          data: { messageId: 'msg-1' },
        },
      ]

      const messages = buildMessagesFromStoredEvents(events)

      expect(messages).toHaveLength(1)
      const msg = messages[0]
      expect(msg?.role).toBe('user')
      expect(msg?.content).toBe('What is in this image?')
      expect(msg?.attachments).toHaveLength(1)
      expect(msg?.attachments?.[0]).toEqual(testAttachment)
    })

    it('should handle messages without attachments', () => {
      const events: StoredEvent[] = [
        {
          seq: 1,
          timestamp: Date.now(),
          sessionId: 'test-session',
          type: 'message.start',
          data: {
            messageId: 'msg-1',
            role: 'user',
            content: 'Hello',
          },
        },
        {
          seq: 2,
          timestamp: Date.now(),
          sessionId: 'test-session',
          type: 'message.done',
          data: { messageId: 'msg-1' },
        },
      ]

      const messages = buildMessagesFromStoredEvents(events)

      expect(messages).toHaveLength(1)
      expect(messages[0]?.attachments).toBeUndefined()
    })
  })

  describe('buildContextMessagesFromStoredEvents', () => {
    it('should preserve attachments when building ContextMessage[] from events', () => {
      const testAttachment: Attachment = {
        id: 'test-1',
        filename: 'test.png',
        mimeType: 'image/png',
        size: 1000,
        data: 'data:image/png;base64,test',
      }

      const events: StoredEvent[] = [
        {
          seq: 1,
          timestamp: Date.now(),
          sessionId: 'test-session',
          type: 'message.start',
          data: {
            messageId: 'msg-1',
            role: 'user',
            content: 'What is in this image?',
            attachments: [testAttachment],
            contextWindowId: 'window-1',
          },
        },
        {
          seq: 2,
          timestamp: Date.now(),
          sessionId: 'test-session',
          type: 'message.done',
          data: { messageId: 'msg-1' },
        },
      ]

      const contextMessages = buildContextMessagesFromStoredEvents(events, 'window-1')

      expect(contextMessages).toHaveLength(1)
      const msg = contextMessages[0]
      expect(msg?.role).toBe('user')
      expect(msg?.content).toBe('What is in this image?')
      expect(msg?.attachments).toHaveLength(1)
      expect(msg?.attachments?.[0]).toEqual(testAttachment)
    })

    it('should handle multiple attachments', () => {
      const attachments: Attachment[] = [
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
      ]

      const events: StoredEvent[] = [
        {
          seq: 1,
          timestamp: Date.now(),
          sessionId: 'test-session',
          type: 'message.start',
          data: {
            messageId: 'msg-1',
            role: 'user',
            content: 'Compare these images',
            attachments,
            contextWindowId: 'window-1',
          },
        },
        {
          seq: 2,
          timestamp: Date.now(),
          sessionId: 'test-session',
          type: 'message.done',
          data: { messageId: 'msg-1' },
        },
      ]

      const contextMessages = buildContextMessagesFromStoredEvents(events, 'window-1')

      expect(contextMessages).toHaveLength(1)
      const msg = contextMessages[0]
      expect(msg?.attachments).toHaveLength(2)
      expect(msg?.attachments?.[0]).toEqual(attachments[0])
      expect(msg?.attachments?.[1]).toEqual(attachments[1])
    })

    it('should handle messages without attachments', () => {
      const events: StoredEvent[] = [
        {
          seq: 1,
          timestamp: Date.now(),
          sessionId: 'test-session',
          type: 'message.start',
          data: {
            messageId: 'msg-1',
            role: 'user',
            content: 'Hello',
            contextWindowId: 'window-1',
          },
        },
        {
          seq: 2,
          timestamp: Date.now(),
          sessionId: 'test-session',
          type: 'message.done',
          data: { messageId: 'msg-1' },
        },
      ]

      const contextMessages = buildContextMessagesFromStoredEvents(events, 'window-1')

      expect(contextMessages).toHaveLength(1)
      expect(contextMessages[0]?.attachments).toBeUndefined()
    })

    it('should handle mixed messages with and without attachments', () => {
      const attachment: Attachment = {
        id: 'test-1',
        filename: 'test.png',
        mimeType: 'image/png',
        size: 1000,
        data: 'data:image/png;base64,test',
      }

      const events: StoredEvent[] = [
        {
          seq: 1,
          timestamp: Date.now(),
          sessionId: 'test-session',
          type: 'message.start',
          data: {
            messageId: 'msg-1',
            role: 'user',
            content: 'First message',
            contextWindowId: 'window-1',
          },
        },
        {
          seq: 2,
          timestamp: Date.now(),
          sessionId: 'test-session',
          type: 'message.done',
          data: { messageId: 'msg-1' },
        },
        {
          seq: 3,
          timestamp: Date.now(),
          sessionId: 'test-session',
          type: 'message.start',
          data: {
            messageId: 'msg-2',
            role: 'user',
            content: 'Message with image',
            attachments: [attachment],
            contextWindowId: 'window-1',
          },
        },
        {
          seq: 4,
          timestamp: Date.now(),
          sessionId: 'test-session',
          type: 'message.done',
          data: { messageId: 'msg-2' },
        },
      ]

      const contextMessages = buildContextMessagesFromStoredEvents(events, 'window-1')

      expect(contextMessages).toHaveLength(2)
      expect(contextMessages[0]?.attachments).toBeUndefined()
      expect(contextMessages[1]?.attachments).toHaveLength(1)
      expect(contextMessages[1]?.attachments?.[0]).toEqual(attachment)
    })
  })
})
