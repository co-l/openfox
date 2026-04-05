/**
 * Integration tests for full attachment flow from EventStore to LLM
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { buildContextMessagesFromStoredEvents } from '../events/folding.js'
import { convertMessages } from './client-pure.js'
import type { StoredEvent } from '../events/types.js'
import type { Attachment } from '../../shared/types.js'

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

  it('should preserve attachments through the entire flow from EventStore to LLM format', () => {
    // Step 1: Create events with attachments (simulating EventStore)
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

    // Step 2: Build context messages (as done in orchestrator)
    const contextMessages = buildContextMessagesFromStoredEvents(events, 'window-1')
    
    expect(contextMessages).toHaveLength(1)
    expect(contextMessages[0]?.attachments).toHaveLength(1)
    expect(contextMessages[0]?.attachments?.[0]).toEqual(testAttachment)

    // Step 3: Convert to LLM format (as done in client-pure)
    const llmMessages = convertMessages(contextMessages, { modelSupportsVision: true, visionFallbackEnabled: false })
    
    expect(llmMessages).toHaveLength(1)
    const llmMsg = llmMessages[0]
    
    // Verify the LLM message has the expected structure with image_url
    expect(llmMsg?.role).toBe('user')
    expect(llmMsg?.content).toBeInstanceOf(Array)
    
    const content = llmMsg?.content as Array<{ type: string; text?: string; image_url?: { url: string } }>
    expect(content).toHaveLength(2) // 1 text + 1 image
    expect(content[0]).toEqual({ type: 'text', text: 'What is in this image?' })
    expect(content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,base64data' },
    })
  })

  it('should handle multiple attachments through the full flow', () => {
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
    const llmMessages = convertMessages(contextMessages, { modelSupportsVision: true, visionFallbackEnabled: false })
    
    expect(llmMessages).toHaveLength(1)
    const content = llmMessages[0]?.content as Array<{ type: string; text?: string; image_url?: { url: string } }>
    expect(content).toHaveLength(3) // 1 text + 2 images
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

  it('should handle messages without attachments through the full flow', () => {
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
    const llmMessages = convertMessages(contextMessages, { modelSupportsVision: true, visionFallbackEnabled: false })
    
    expect(llmMessages).toHaveLength(1)
    expect(llmMessages[0]?.content).toBe('Hello')
  })

  it('should handle empty text with only attachments', () => {
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
    const llmMessages = convertMessages(contextMessages, { modelSupportsVision: true, visionFallbackEnabled: false })
    
    expect(llmMessages).toHaveLength(1)
    const content = llmMessages[0]?.content as Array<{ type: string; text?: string; image_url?: { url: string } }>
    expect(content).toHaveLength(1) // Only image, no text
    expect(content[0]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,base64data' },
    })
  })
})
