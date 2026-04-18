import { describe, it, expect } from 'vitest'
import { groupMessages } from './groupMessages'
import type { Message } from '@shared/types.js'
import type { DisplayItem } from './groupMessages'

function createMessage(
  id: string,
  role: 'user' | 'assistant' | 'system' | 'tool' = 'assistant',
  content: string = 'Test content',
  extras: Partial<Message> = {}
): Message {
  return {
    id,
    role,
    content,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isStreaming: false,
    ...extras,
  } as Message
}

function assertItemsIdentical(messages: Message[], items: DisplayItem[]): void {
  const newItems = groupMessages(messages, items)
  expect(items.length).toBe(newItems.length)
  for (let i = 0; i < items.length; i++) {
    expect(items[i]).toBe(newItems[i])
  }
}

describe('groupMessages identity preservation', () => {
  it('should preserve object identity for unchanged messages', () => {
    const msg1 = createMessage('msg-1', 'user', 'Hello')
    const msg2 = createMessage('msg-2', 'assistant', 'Hi there')
    const msg3 = createMessage('msg-3', 'user', 'How are you?')

    const initialItems = groupMessages([msg1, msg2, msg3])
    assertItemsIdentical([msg1, msg2, msg3], initialItems)
  })

  it('should create new objects only for changed messages', () => {
    const msg1 = createMessage('msg-1', 'user', 'Hello')
    const msg2 = createMessage('msg-2', 'assistant', 'Hi there')
    const msg3 = createMessage('msg-3', 'user', 'How are you?')
    const msg4 = createMessage('msg-4', 'assistant', 'I am good')

    const initialItems = groupMessages([msg1, msg2, msg3])
    
    // Add a new message, passing previous items
    const newItems = groupMessages([msg1, msg2, msg3, msg4], initialItems)
    
    // First 3 items should be identical
    expect(initialItems[0]).toBe(newItems[0])
    expect(initialItems[1]).toBe(newItems[1])
    expect(initialItems[2]).toBe(newItems[2])
    
    // Fourth item should be new
    expect(newItems[3]).toBeDefined()
  })

  it('should update only the changed message item', () => {
    const msg1 = createMessage('msg-1', 'user', 'Hello')
    const msg2 = createMessage('msg-2', 'assistant', 'Hi there')
    const msg3 = createMessage('msg-3', 'user', 'How are you?')
    
    const initialItems = groupMessages([msg1, msg2, msg3])
    
    // Update msg2 content
    const updatedMsg2 = createMessage('msg-2', 'assistant', 'Hello! How can I help?')
    const newItems = groupMessages([msg1, updatedMsg2, msg3], initialItems)
    
    // msg1 and msg3 items should be identical
    expect(initialItems[0]).toBe(newItems[0])
    expect(initialItems[2]).toBe(newItems[2])
    
    // msg2 item should be different (new object)
    expect(initialItems[1]).not.toBe(newItems[1])
  })

  it('should handle sub-agent message grouping with identity preservation', () => {
    const msg1 = createMessage('msg-1', 'user', 'Task')
    const msg2 = createMessage('msg-2', 'assistant', 'Working on it', {
      subAgentId: 'agent-1',
      subAgentType: 'verifier' as const,
    })
    const msg3 = createMessage('msg-3', 'assistant', 'Still working', {
      subAgentId: 'agent-1',
      subAgentType: 'verifier' as const,
    })
    const msg4 = createMessage('msg-4', 'user', 'Next question')

    const initialItems = groupMessages([msg1, msg2, msg3, msg4])
    assertItemsIdentical([msg1, msg2, msg3, msg4], initialItems)
  })

  it('should handle criteria-only message batching with identity preservation', () => {
    const msg1 = createMessage('msg-1', 'user', 'Check criteria')
    const msg2 = createMessage('msg-2', 'assistant', '', {
      toolCalls: [
        { id: 'tool-1', name: 'criterion', arguments: { action: 'get' }, startedAt: Date.now() },
      ],
    })
    const msg3 = createMessage('msg-3', 'assistant', '', {
      toolCalls: [
        { id: 'tool-2', name: 'criterion', arguments: { action: 'get' }, startedAt: Date.now() },
      ],
    })
    const msg4 = createMessage('msg-4', 'user', 'Next')

    const initialItems = groupMessages([msg1, msg2, msg3, msg4])
    assertItemsIdentical([msg1, msg2, msg3, msg4], initialItems)
  })

  it('should include system-generated auto-prompt messages', () => {
    const msg1 = createMessage('msg-1', 'user', 'Hello')
    const autoPrompt = createMessage('auto-1', 'user', '<system-reminder>Plan Mode</system-reminder>', {
      isSystemGenerated: true,
      messageKind: 'auto-prompt',
    })
    const msg2 = createMessage('msg-2', 'assistant', 'Hi there')

    const items = groupMessages([msg1, autoPrompt, msg2])
    
    // Should have 3 items (auto-prompt included)
    expect(items.length).toBe(3)
    expect(items[0]).toEqual({ type: 'message', message: msg1 })
    expect(items[1]).toEqual({ type: 'message', message: autoPrompt })
    expect(items[2]).toEqual({ type: 'message', message: msg2 })
  })
})
