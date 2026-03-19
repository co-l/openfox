import { describe, expect, it } from 'vitest'
import type { StoredEvent } from './types.js'
import {
  buildContextMessagesFromStoredEvents,
  buildMessagesFromStoredEvents,
  buildSnapshotFromSessionState,
  foldTurnEventsToSnapshotMessages,
} from './folding.js'

const baseEvent = {
  seq: 1,
  sessionId: 'session-1',
  timestamp: Date.parse('2024-01-01T00:00:00.000Z'),
}

describe('event folding', () => {
  it('builds ui messages from stored events, including tool results and streaming flags', () => {
    const events: StoredEvent[] = [
      { ...baseEvent, type: 'message.start', data: { messageId: 'm1', role: 'assistant' } },
      { ...baseEvent, type: 'message.delta', data: { messageId: 'm1', content: 'Hello' } },
      { ...baseEvent, type: 'message.thinking', data: { messageId: 'm1', content: 'Thinking...' } },
      { ...baseEvent, type: 'tool.call', data: { messageId: 'm1', toolCall: { id: 'call-1', name: 'read_file', arguments: { path: 'src/index.ts' } } } },
      { ...baseEvent, type: 'tool.result', data: { messageId: 'm1', toolCallId: 'call-1', result: { success: true, output: 'ok', durationMs: 1, truncated: false } } },
      { ...baseEvent, type: 'message.done', data: { messageId: 'm1', partial: true, stats: { model: 'qwen', mode: 'builder', totalTime: 1, toolTime: 0, prefillTokens: 1, prefillSpeed: 1, generationTokens: 1, generationSpeed: 1 }, segments: [{ type: 'text', content: 'Hello' }] } },
      { ...baseEvent, type: 'message.start', data: { messageId: 'm2', role: 'user', content: 'Question', isSystemGenerated: true, messageKind: 'auto-prompt' } },
    ]

    expect(buildMessagesFromStoredEvents(events)).toEqual([
      {
        id: 'm1',
        role: 'assistant',
        content: 'Hello',
        thinkingContent: 'Thinking...',
        timestamp: '2024-01-01T00:00:00.000Z',
        tokenCount: 0,
        isStreaming: false,
        partial: true,
        stats: { model: 'qwen', mode: 'builder', totalTime: 1, toolTime: 0, prefillTokens: 1, prefillSpeed: 1, generationTokens: 1, generationSpeed: 1 },
        segments: [{ type: 'text', content: 'Hello' }],
        toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'src/index.ts' }, result: { success: true, output: 'ok', durationMs: 1, truncated: false } }],
      },
      {
        id: 'm2',
        role: 'user',
        content: 'Question',
        timestamp: '2024-01-01T00:00:00.000Z',
        tokenCount: 0,
        isStreaming: false,
        isSystemGenerated: true,
        messageKind: 'auto-prompt',
      },
    ])
  })

  it('builds llm context messages from stored events and skips system messages', () => {
    const events: StoredEvent[] = [
      { ...baseEvent, type: 'message.start', data: { messageId: 'm1', role: 'system', content: 'ignored' } },
      { ...baseEvent, type: 'message.start', data: { messageId: 'm2', role: 'assistant' } },
      { ...baseEvent, type: 'message.delta', data: { messageId: 'm2', content: 'Hello' } },
      { ...baseEvent, type: 'tool.call', data: { messageId: 'm2', toolCall: { id: 'call-1', name: 'glob', arguments: { pattern: '*.ts' } } } },
      { ...baseEvent, type: 'tool.result', data: { messageId: 'm2', toolCallId: 'call-1', result: { success: false, error: 'bad path', durationMs: 1, truncated: false } } },
    ]

    expect(buildContextMessagesFromStoredEvents(events)).toEqual([
      {
        role: 'assistant',
        content: 'Hello',
        toolCalls: [{ id: 'call-1', name: 'glob', arguments: { pattern: '*.ts' } }],
      },
      {
        role: 'tool',
        content: 'Error: bad path',
        toolCallId: 'call-1',
      },
    ])
  })

  it('folds turn events into snapshot messages and builds a snapshot', () => {
    const events: Array<{ type: any; timestamp: number; data: any }> = [
      { type: 'message.start', timestamp: 123, data: { messageId: 'm1', role: 'assistant' as const, contextWindowId: 'window-1' } },
      { type: 'message.delta', timestamp: 123, data: { messageId: 'm1', content: 'Hello' } },
      { type: 'message.thinking', timestamp: 123, data: { messageId: 'm1', content: 'Thinking' } },
      { type: 'tool.call', timestamp: 123, data: { messageId: 'm1', toolCall: { id: 'call-1', name: 'read_file', arguments: { path: 'x' } } } },
      { type: 'tool.result', timestamp: 123, data: { messageId: 'm1', toolCallId: 'call-1', result: { success: true, output: 'ok', durationMs: 1, truncated: false } } },
      { type: 'message.done', timestamp: 123, data: { messageId: 'm1', partial: true, stats: { model: 'qwen', mode: 'planner' as const, totalTime: 1, toolTime: 0, prefillTokens: 1, prefillSpeed: 1, generationTokens: 1, generationSpeed: 1 } } },
    ]

    const messages = foldTurnEventsToSnapshotMessages(events)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      id: 'm1',
      role: 'assistant',
      content: 'Hello',
      thinkingContent: 'Thinking',
      isStreaming: false,
      partial: true,
      contextWindowId: 'window-1',
      toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'x' }, result: { success: true, output: 'ok', durationMs: 1, truncated: false } }],
    })

    expect(buildSnapshotFromSessionState({
      session: {
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [],
        executionState: { currentTokenCount: 100, compactionCount: 2 },
      },
      events,
      latestSeq: 42,
      snapshotAt: 999,
    })).toEqual({
      mode: 'builder',
      phase: 'build',
      isRunning: true,
      messages,
      criteria: [],
      contextState: {
        currentTokens: 100,
        maxTokens: 200000,
        compactionCount: 2,
        dangerZone: false,
        canCompact: false,
      },
      todos: [],
      snapshotSeq: 42,
      snapshotAt: 999,
    })
  })
})
