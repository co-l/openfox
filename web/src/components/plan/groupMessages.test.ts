// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { groupMessages } from './groupMessages'
import type { Message } from '@shared/types.js'
import type { DisplayItem } from './groupMessages'

/**
 * Copy of the previous (pre-O(N)) implementation, kept as a reference for
 * differential testing of the single-pass rewrite.
 */
function groupMessagesReference(messages: Message[], previousItems: DisplayItem[] = []): DisplayItem[] {
  const previousItemsByMessageId = new Map<string, DisplayItem>()
  const previousItemsBySubAgentId = new Map<string, DisplayItem>()
  for (const item of previousItems) {
    if (item.type === 'message') {
      previousItemsByMessageId.set(item.message.id, item)
    } else if (item.type === 'subagent') {
      previousItemsBySubAgentId.set(item.subAgentId, item)
    }
  }
  const items: DisplayItem[] = []
  let lastContextWindowId: string | undefined
  let windowSequence = 1
  let windowBuckets: Map<string, { subAgentType: string; messages: Message[] }> | null = null

  const flushWindowBuckets = () => {
    if (!windowBuckets || windowBuckets.size === 0) return
    const firstOccurrence = new Map<string, number>()
    let idx = 0
    for (const msg of messages) {
      if (msg.role === 'tool') continue
      if (msg.contextWindowId !== lastContextWindowId) continue
      if (msg.subAgentId && !firstOccurrence.has(msg.subAgentId)) {
        firstOccurrence.set(msg.subAgentId, idx)
      }
      idx++
    }
    const sorted = [...windowBuckets.entries()].sort(
      (a, b) => (firstOccurrence.get(a[0]) ?? 0) - (firstOccurrence.get(b[0]) ?? 0),
    )
    for (const [subAgentId, bucket] of sorted) {
      const previousItem = previousItemsBySubAgentId.get(subAgentId)
      const messagesMatch =
        previousItem?.type === 'subagent' &&
        previousItem.messages.length === bucket.messages.length &&
        previousItem.messages.every((m, j) => m === bucket.messages[j])
      if (messagesMatch) {
        items.push(previousItem)
      } else {
        items.push({ type: 'subagent', subAgentId, subAgentType: bucket.subAgentType, messages: bucket.messages })
      }
    }
    windowBuckets = null
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!
    if (msg.role === 'tool') continue
    if (msg.contextWindowId && lastContextWindowId && msg.contextWindowId !== lastContextWindowId) {
      flushWindowBuckets()
      windowSequence++
      items.push({ type: 'context-divider', windowSequence })
    }
    lastContextWindowId = msg.contextWindowId
    if (msg.subAgentId && msg.subAgentType) {
      if (!windowBuckets) windowBuckets = new Map()
      let bucket = windowBuckets.get(msg.subAgentId)
      if (!bucket) {
        bucket = { subAgentType: msg.subAgentType, messages: [] }
        windowBuckets.set(msg.subAgentId, bucket)
      }
      bucket.messages.push(msg)
    } else {
      flushWindowBuckets()
      const previousItem = previousItemsByMessageId.get(msg.id)
      if (previousItem?.type === 'message' && previousItem.message === msg) {
        items.push(previousItem)
      } else {
        items.push({ type: 'message', message: msg })
      }
    }
  }
  flushWindowBuckets()
  return items
}

function createMessage(
  id: string,
  role: 'user' | 'assistant' | 'system' | 'tool' = 'assistant',
  content: string = 'Test content',
  extras: Partial<Message> = {},
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

  it('should render criteria-only messages as regular message items', () => {
    const msg1 = createMessage('msg-1', 'user', 'Check criteria')
    const msg2 = createMessage('msg-2', 'assistant', '', {
      toolCalls: [
        {
          id: 'tool-1',
          name: 'session_metadata',
          arguments: { action: 'get', key: 'criteria' },
          startedAt: Date.now(),
        },
      ],
    })
    const msg3 = createMessage('msg-3', 'assistant', '', {
      toolCalls: [
        {
          id: 'tool-2',
          name: 'session_metadata',
          arguments: { action: 'get', key: 'criteria' },
          startedAt: Date.now(),
        },
      ],
    })
    const msg4 = createMessage('msg-4', 'user', 'Next')

    const items = groupMessages([msg1, msg2, msg3, msg4])

    // Each criteria-only message is its own message item (not merged into a batch)
    expect(items.length).toBe(4)
    expect(items[0]).toEqual({ type: 'message', message: msg1 })
    expect(items[1]).toEqual({ type: 'message', message: msg2 })
    expect(items[2]).toEqual({ type: 'message', message: msg3 })
    expect(items[3]).toEqual({ type: 'message', message: msg4 })
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

  it('should group interleaved parallel sub-agent messages into two complete groups', () => {
    // Simulates two sub-agents running in parallel, messages interleaved
    const a1 = createMessage('a-ctx', 'user', 'context reset', {
      subAgentId: 'agent-a',
      subAgentType: 'explorer' as const,
      messageKind: 'context-reset',
    })
    const b1 = createMessage('b-ctx', 'user', 'context reset', {
      subAgentId: 'agent-b',
      subAgentType: 'code_reviewer' as const,
      messageKind: 'context-reset',
    })
    const a2 = createMessage('a-prompt', 'user', 'explore this', {
      subAgentId: 'agent-a',
      subAgentType: 'explorer' as const,
      messageKind: 'auto-prompt',
    })
    const b2 = createMessage('b-prompt', 'user', 'review this', {
      subAgentId: 'agent-b',
      subAgentType: 'code_reviewer' as const,
      messageKind: 'auto-prompt',
    })
    const a3 = createMessage('a-result', 'assistant', 'found files', {
      subAgentId: 'agent-a',
      subAgentType: 'explorer' as const,
    })
    const b3 = createMessage('b-result', 'assistant', 'found issues', {
      subAgentId: 'agent-b',
      subAgentType: 'code_reviewer' as const,
    })

    const items = groupMessages([a1, b1, a2, b2, a3, b3])

    // Should produce exactly 2 sub-agent groups (not 6 individual ones)
    expect(items.length).toBe(2)
    expect(items[0]).toEqual({
      type: 'subagent',
      subAgentId: 'agent-a',
      subAgentType: 'explorer',
      messages: [a1, a2, a3],
    })
    expect(items[1]).toEqual({
      type: 'subagent',
      subAgentId: 'agent-b',
      subAgentType: 'code_reviewer',
      messages: [b1, b2, b3],
    })
  })

  it('should preserve order by first message when sub-agents interleave', () => {
    // Sub-agent B's first message appears before sub-agent A's first message
    const b1 = createMessage('b-1', 'user', 'B first', {
      subAgentId: 'agent-b',
      subAgentType: 'code_reviewer' as const,
    })
    const a1 = createMessage('a-1', 'user', 'A second', {
      subAgentId: 'agent-a',
      subAgentType: 'explorer' as const,
    })
    const b2 = createMessage('b-2', 'assistant', 'B continues', {
      subAgentId: 'agent-b',
      subAgentType: 'code_reviewer' as const,
    })
    const a2 = createMessage('a-2', 'assistant', 'A continues', {
      subAgentId: 'agent-a',
      subAgentType: 'explorer' as const,
    })

    const items = groupMessages([b1, a1, b2, a2])

    // Group B should appear first (its first message comes first)
    expect(items.length).toBe(2)
    expect(items[0]).toEqual({
      type: 'subagent',
      subAgentId: 'agent-b',
      subAgentType: 'code_reviewer',
      messages: [b1, b2],
    })
    expect(items[1]).toEqual({
      type: 'subagent',
      subAgentId: 'agent-a',
      subAgentType: 'explorer',
      messages: [a1, a2],
    })
  })

  it('should interleave regular messages between sub-agent groups correctly', () => {
    const user1 = createMessage('u1', 'user', 'First question')
    const a1 = createMessage('a-1', 'user', 'explorer prompt', {
      subAgentId: 'agent-a',
      subAgentType: 'explorer' as const,
    })
    const a2 = createMessage('a-2', 'assistant', 'explorer result', {
      subAgentId: 'agent-a',
      subAgentType: 'explorer' as const,
    })
    const user2 = createMessage('u2', 'user', 'Second question')
    const b1 = createMessage('b-1', 'user', 'reviewer prompt', {
      subAgentId: 'agent-b',
      subAgentType: 'code_reviewer' as const,
    })
    const b2 = createMessage('b-2', 'assistant', 'reviewer result', {
      subAgentId: 'agent-b',
      subAgentType: 'code_reviewer' as const,
    })
    const user3 = createMessage('u3', 'user', 'Third question')

    const items = groupMessages([user1, a1, a2, user2, b1, b2, user3])

    expect(items.length).toBe(5)
    expect(items[0]).toEqual({ type: 'message', message: user1 })
    expect(items[1]).toEqual({
      type: 'subagent',
      subAgentId: 'agent-a',
      subAgentType: 'explorer',
      messages: [a1, a2],
    })
    expect(items[2]).toEqual({ type: 'message', message: user2 })
    expect(items[3]).toEqual({
      type: 'subagent',
      subAgentId: 'agent-b',
      subAgentType: 'code_reviewer',
      messages: [b1, b2],
    })
    expect(items[4]).toEqual({ type: 'message', message: user3 })
  })

  it('should produce identical output to the previous implementation on random realistic feeds', () => {
    // Deterministic PRNG so a divergence is reproducible.
    let seed = 0x5eed
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 2 ** 32
    }

    const subAgents = Array.from({ length: 40 }, (_, i) => `sub-agent-${i}`)
    const messages: Message[] = []
    let windowIndex = 0
    let messageId = 0
    let inWindow = 0
    // Window ids change monotonically (each compaction creates a new one),
    // which is the shape real sessions have.
    while (messages.length < 5000) {
      if (inWindow === 0 && rand() < 0.12) {
        windowIndex++
      }
      inWindow++
      const windowId = windowIndex === 0 ? undefined : `win-${windowIndex}`
      const roll = rand()
      if (roll < 0.35) {
        messages.push(createMessage(`msg-${messageId++}`, 'user', `user ${messageId}`, { contextWindowId: windowId }))
      } else if (roll < 0.5) {
        messages.push(createMessage(`msg-${messageId++}`, 'tool', `tool ${messageId}`, { contextWindowId: windowId }))
      } else {
        const subAgentId = subAgents[Math.floor(rand() * subAgents.length)]!
        messages.push(
          createMessage(`msg-${messageId++}`, 'assistant', `agent ${messageId}`, {
            subAgentId,
            subAgentType: 'verifier',
            contextWindowId: windowId,
          }),
        )
      }
      if (inWindow > 400) inWindow = 0
    }

    const expected = groupMessagesReference(messages)
    const actual = groupMessages(messages)
    expect(actual).toEqual(expected)
    // Same with previous items for identity-preservation parity
    expect(groupMessages(messages, expected)).toEqual(groupMessagesReference(messages, expected))
  })

  it('should run in well under 10ms for a 10k-message feed', () => {
    const subAgents = Array.from({ length: 200 }, (_, i) => `sub-agent-${i}`)
    const messages: Message[] = []
    let windowIndex = 0
    let inWindow = 0
    for (let i = 0; i < 10_000; i++) {
      if (inWindow === 0 && i % 500 === 0) windowIndex++
      inWindow++
      const windowId = windowIndex === 0 ? undefined : `win-${windowIndex}`
      if (i % 3 === 0) {
        messages.push(createMessage(`msg-${i}`, 'user', `user ${i}`, { contextWindowId: windowId }))
      } else {
        const subAgentId = subAgents[i % subAgents.length]!
        messages.push(
          createMessage(`msg-${i}`, 'assistant', `agent ${i}`, {
            subAgentId,
            subAgentType: 'verifier',
            contextWindowId: windowId,
          }),
        )
      }
    }

    // Warm up, then take the minimum of a few runs: a single wall-clock
    // sample is noise-prone under parallel CI load, while the min bounds the
    // algorithm's real cost (the old O(N²) variant was ~100x slower even at
    // its best).
    groupMessages(messages)
    let elapsed = Infinity
    for (let run = 0; run < 5; run++) {
      const start = performance.now()
      const items = groupMessages(messages)
      elapsed = Math.min(elapsed, performance.now() - start)
      expect(items.length).toBeGreaterThan(0)
    }

    expect(elapsed).toBeLessThan(10)
  })

  it('should split sub-agent groups at context window boundaries', () => {
    // Messages spanning a context window boundary should be split
    // because the compaction represents a real discontinuity
    const a1 = createMessage('a-1', 'user', 'A first', {
      subAgentId: 'agent-a',
      subAgentType: 'explorer' as const,
      contextWindowId: 'win-1',
    })
    const b1 = createMessage('b-1', 'user', 'B first', {
      subAgentId: 'agent-b',
      subAgentType: 'code_reviewer' as const,
      contextWindowId: 'win-1',
    })
    const a2 = createMessage('a-2', 'assistant', 'A continues', {
      subAgentId: 'agent-a',
      subAgentType: 'explorer' as const,
      contextWindowId: 'win-2',
    })
    const b2 = createMessage('b-2', 'assistant', 'B continues', {
      subAgentId: 'agent-b',
      subAgentType: 'code_reviewer' as const,
      contextWindowId: 'win-2',
    })

    const items = groupMessages([a1, b1, a2, b2])

    // Groups split at window boundary: win-1 groups, divider, win-2 groups
    expect(items.length).toBe(5)
    expect(items[0]).toEqual({
      type: 'subagent',
      subAgentId: 'agent-a',
      subAgentType: 'explorer',
      messages: [a1],
    })
    expect(items[1]).toEqual({
      type: 'subagent',
      subAgentId: 'agent-b',
      subAgentType: 'code_reviewer',
      messages: [b1],
    })
    expect(items[2]).toEqual({ type: 'context-divider', windowSequence: 2 })
    expect(items[3]).toEqual({
      type: 'subagent',
      subAgentId: 'agent-a',
      subAgentType: 'explorer',
      messages: [a2],
    })
    expect(items[4]).toEqual({
      type: 'subagent',
      subAgentId: 'agent-b',
      subAgentType: 'code_reviewer',
      messages: [b2],
    })
  })
})
