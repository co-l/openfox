// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createSessionStateMessage } from './protocol.js'
import type { Message } from '../../shared/types.js'

vi.mock('../db/settings.js', () => ({
  getSetting: vi.fn(),
  SETTINGS_KEYS: { DISPLAY_MAX_VISIBLE_ITEMS: 'display.maxVisibleItems' },
}))

const mockSession = {
  id: 's1',
  projectId: 'proj-1',
  workdir: '/tmp/test',
  mode: 'builder' as const,
  phase: 'build' as const,
  isRunning: false,
  providerId: null,
  providerModel: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  messages: [],
  criteria: [],
  contextWindows: [],
  executionState: null,
  metadata: { title: 'Test', totalTokensUsed: 0, totalToolCalls: 0, iterationCount: 0 },
  metadataEntries: {},
  messageCount: 10,
}

const mockMessages: Message[] = Array.from({ length: 10 }, (_, i) => ({
  id: `msg-${i + 1}`,
  role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
  content: `Message ${i + 1}`,
  timestamp: new Date(Date.now() - (10 - i) * 60000).toISOString(),
  tokenCount: 0,
  isStreaming: false,
}))

describe('WebSocket session.state truncation', () => {
  it('includes hiddenCount in session.state payload when provided', () => {
    const message = createSessionStateMessage(
      mockSession,
      mockMessages.slice(-3),
      [],
      undefined,
      undefined,
      undefined,
      7,
    )

    expect(message.payload).toHaveProperty('hiddenCount')
    expect(message.payload.hiddenCount).toBe(7)
  })

  it('omits hiddenCount from session.state payload when not provided', () => {
    const message = createSessionStateMessage(mockSession, mockMessages, [])

    expect(message.payload).not.toHaveProperty('hiddenCount')
  })

  it('passes truncated messages and correct hiddenCount through to payload', () => {
    const truncatedMessages = mockMessages.slice(-3)
    const message = createSessionStateMessage(mockSession, truncatedMessages, [], undefined, undefined, undefined, 7)

    expect(message.payload.messages).toHaveLength(3)
    expect(message.payload.messages[0]!.id).toBe('msg-8')
    expect(message.payload.messages[1]!.id).toBe('msg-9')
    expect(message.payload.messages[2]!.id).toBe('msg-10')
    expect(message.payload.hiddenCount).toBe(7)
  })

  it('enriches messages with tool results before adding hiddenCount', () => {
    const assistantMsg: Message = {
      id: 'msg-1',
      role: 'assistant',
      content: 'Let me check',
      timestamp: '2024-01-01T00:00:00.000Z',
      tokenCount: 0,
      toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'test.ts' } }],
    }
    const toolMsg: Message = {
      id: 'tool-1',
      role: 'tool',
      content: 'File content',
      timestamp: '2024-01-01T00:00:01.000Z',
      tokenCount: 0,
      toolCallId: 'call-1',
      toolResult: { success: true, output: 'File content', durationMs: 5, truncated: false },
    }

    const message = createSessionStateMessage(
      mockSession,
      [assistantMsg, toolMsg],
      [],
      undefined,
      undefined,
      undefined,
      3,
    )

    expect(message.payload.messages[0]!.toolCalls![0]).toHaveProperty('result')
    expect(message.payload.messages[0]!.toolCalls![0]!.result!.output).toBe('File content')
    expect(message.payload.hiddenCount).toBe(3)
  })
})
