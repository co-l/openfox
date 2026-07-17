import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildContextMessagesFromStoredEvents } from '../events/folding.js'
import { convertMessages } from './client-pure.js'
import type { StoredEvent } from '../events/types.js'
import type { Attachment } from '../../shared/types.js'

vi.mock('./vision-fallback.js', () => ({
  describeImageFromDataUrl: vi.fn().mockResolvedValue('A test image description'),
}))

describe('Full Attachment Flow Integration', () => {
  let testAttachment: Attachment

  beforeEach(() => {
    testAttachment = {
      id: 'test-1',
      filename: 'test.png',
      mimeType: 'image/png',
      size: 1000,
      data: 'data:image/png;base64,base64data',
    }
  })

  it('should preserve attachments through the entire flow from EventStore to LLM format', async () => {
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
    expect(contextMessages[0]?.attachments).toHaveLength(1)
    expect(contextMessages[0]?.attachments?.[0]).toEqual(testAttachment)

    const llmMessages = await convertMessages(contextMessages, true)

    expect(llmMessages).toHaveLength(1)
    const llmMsg = llmMessages[0]

    expect(llmMsg?.role).toBe('user')
    expect(llmMsg?.content).toBeInstanceOf(Array)

    const content = llmMsg?.content as Array<{ type: string; text?: string; image_url?: { url: string } }>
    expect(content).toHaveLength(2)
    expect(content[0]).toEqual({ type: 'text', text: 'What is in this image?' })
    expect(content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,base64data' },
    })
  })

  it('should handle multiple attachments through the full flow', async () => {
    const attachments: Attachment[] = [
      {
        id: 'test-1',
        filename: 'img1.png',
        mimeType: 'image/png',
        size: 1000,
        data: 'data:image/png;base64,data1',
      },
      {
        id: 'test-2',
        filename: 'img2.jpg',
        mimeType: 'image/jpeg',
        size: 2000,
        data: 'data:image/jpeg;base64,data2',
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
          content: 'Compare these',
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
    const llmMessages = await convertMessages(contextMessages, true)

    expect(llmMessages).toHaveLength(1)
    const content = llmMessages[0]?.content as Array<{ type: string; text?: string; image_url?: { url: string } }>
    expect(content).toHaveLength(3)
    expect(content[0]).toEqual({ type: 'text', text: 'Compare these' })
    expect(content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,data1' },
    })
    expect(content[2]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,data2' },
    })
  })

  it('should handle messages without attachments through the full flow', async () => {
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
    const llmMessages = await convertMessages(contextMessages, true)

    expect(llmMessages).toHaveLength(1)
    expect(llmMessages[0]?.content).toBe('Hello')
  })

  it('should handle empty text with only attachments', async () => {
    const events: StoredEvent[] = [
      {
        seq: 1,
        timestamp: Date.now(),
        sessionId: 'test-session',
        type: 'message.start',
        data: {
          messageId: 'msg-1',
          role: 'user',
          content: '',
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
    const llmMessages = await convertMessages(contextMessages, true)

    expect(llmMessages).toHaveLength(1)
    const content = llmMessages[0]?.content as Array<{ type: string; text?: string; image_url?: { url: string } }>
    expect(content).toHaveLength(1)
    expect(content[0]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,base64data' },
    })
  })

  it('converts images to text placeholder when model lacks vision', async () => {
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
    const llmMessages = await convertMessages(contextMessages, false)

    expect(llmMessages).toHaveLength(1)
    const content = llmMessages[0]?.content as Array<{ type: string; text?: string }>
    expect(content).toHaveLength(2)
    expect(content[0]).toEqual({ type: 'text', text: 'What is in this image?' })
    expect(content[1]?.type).toBe('text')
    expect((content[1] as { text: string }).text).toContain('[Image: test.png]')
  })
})
