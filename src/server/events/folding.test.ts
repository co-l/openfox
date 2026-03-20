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

  it('filters llm context messages by context window when requested', () => {
    const events: StoredEvent[] = [
      { ...baseEvent, type: 'message.start', data: { messageId: 'old-user', role: 'user', content: 'old', contextWindowId: 'window-1' } },
      { ...baseEvent, type: 'message.done', data: { messageId: 'old-user' } },
      { ...baseEvent, type: 'message.start', data: { messageId: 'old-assistant', role: 'assistant', contextWindowId: 'window-1' } },
      { ...baseEvent, type: 'message.delta', data: { messageId: 'old-assistant', content: 'previous answer' } },
      { ...baseEvent, type: 'tool.call', data: { messageId: 'old-assistant', toolCall: { id: 'old-call', name: 'glob', arguments: { pattern: '*.ts' } } } },
      { ...baseEvent, type: 'tool.result', data: { messageId: 'old-assistant', toolCallId: 'old-call', result: { success: true, output: 'old result', durationMs: 1, truncated: false } } },
      { ...baseEvent, type: 'message.start', data: { messageId: 'new-user', role: 'user', content: 'new', contextWindowId: 'window-2' } },
      { ...baseEvent, type: 'message.done', data: { messageId: 'new-user' } },
      { ...baseEvent, type: 'message.start', data: { messageId: 'new-assistant', role: 'assistant', contextWindowId: 'window-2' } },
      { ...baseEvent, type: 'message.delta', data: { messageId: 'new-assistant', content: 'current answer' } },
      { ...baseEvent, type: 'tool.call', data: { messageId: 'new-assistant', toolCall: { id: 'new-call', name: 'read_file', arguments: { path: 'src/app.ts' } } } },
      { ...baseEvent, type: 'tool.result', data: { messageId: 'new-assistant', toolCallId: 'new-call', result: { success: true, output: 'new result', durationMs: 1, truncated: false } } },
    ]

    expect(buildContextMessagesFromStoredEvents(events, 'window-2')).toEqual([
      {
        role: 'user',
        content: 'new',
      },
      {
        role: 'assistant',
        content: 'current answer',
        toolCalls: [{ id: 'new-call', name: 'read_file', arguments: { path: 'src/app.ts' } }],
      },
      {
        role: 'tool',
        content: 'new result',
        toolCallId: 'new-call',
      },
    ])
  })

  it('excludes verifier sub-agent messages from main-context reconstruction when requested', () => {
    const events: StoredEvent[] = [
      { ...baseEvent, type: 'message.start', data: { messageId: 'user-1', role: 'user', content: 'build it', contextWindowId: 'window-1' } },
      { ...baseEvent, type: 'message.done', data: { messageId: 'user-1' } },
      { ...baseEvent, type: 'message.start', data: { messageId: 'reset', role: 'user', content: 'Fresh Context', contextWindowId: 'window-1', subAgentType: 'verifier', messageKind: 'context-reset' } },
      { ...baseEvent, type: 'message.done', data: { messageId: 'reset' } },
      { ...baseEvent, type: 'message.start', data: { messageId: 'verifier-1', role: 'assistant', contextWindowId: 'window-1', subAgentType: 'verifier' } },
      { ...baseEvent, type: 'message.delta', data: { messageId: 'verifier-1', content: 'verification thoughts' } },
    ]

    expect(buildContextMessagesFromStoredEvents(events, 'window-1', { includeVerifier: false })).toEqual([
      {
        role: 'user',
        content: 'build it',
      },
    ])
  })

  it('extracts messages from snapshot when individual events are deleted', () => {
    const events: StoredEvent[] = [
      {
        seq: 1,
        timestamp: Date.now(),
        sessionId: 'session-1',
        type: 'session.initialized',
        data: { projectId: 'proj-1', workdir: '/tmp', contextWindowId: 'window-1' },
      },
      {
        seq: 2,
        timestamp: Date.now(),
        sessionId: 'session-1',
        type: 'turn.snapshot',
        data: {
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          messages: [
            { id: 'msg-1', role: 'user', content: 'Hello', timestamp: Date.now() },
            { id: 'msg-2', role: 'assistant', content: 'Hi there!', timestamp: Date.now() },
          ],
          criteria: [],
          contextState: { currentTokens: 50, maxTokens: 200000, compactionCount: 0, dangerZone: false, canCompact: false },
          currentContextWindowId: 'window-1',
          todos: [],
          readFiles: [],
          snapshotSeq: 2,
          snapshotAt: Date.now(),
        },
      },
    ]

    const messages = buildMessagesFromStoredEvents(events)
    expect(messages).toHaveLength(2)
    expect(messages[0]!.id).toBe('msg-1')
    expect(messages[0]!.content).toBe('Hello')
    expect(messages[1]!.id).toBe('msg-2')
    expect(messages[1]!.content).toBe('Hi there!')
  })

  it('extracts messages with tool calls from snapshot', () => {
    const events: StoredEvent[] = [
      {
        seq: 1,
        timestamp: Date.now(),
        sessionId: 'session-1',
        type: 'turn.snapshot',
        data: {
          mode: 'builder',
          phase: 'build',
          isRunning: false,
          messages: [
            {
              id: 'msg-1',
              role: 'assistant',
              content: '',
              toolCalls: [
                {
                  id: 'call-1',
                  name: 'read_file',
                  arguments: { path: 'test.txt' },
                  result: { success: true, output: 'File content', durationMs: 100, truncated: false },
                },
              ],
              timestamp: Date.now(),
            },
          ],
          criteria: [],
          contextState: { currentTokens: 100, maxTokens: 200000, compactionCount: 0, dangerZone: false, canCompact: false },
          currentContextWindowId: 'window-1',
          todos: [],
          readFiles: [],
          snapshotSeq: 1,
          snapshotAt: Date.now(),
        },
      },
    ]

    const messages = buildMessagesFromStoredEvents(events)
    expect(messages).toHaveLength(1)
    expect(messages[0]!.toolCalls).toBeDefined()
    expect(messages[0]!.toolCalls![0]!.name).toBe('read_file')
    expect(messages[0]!.toolCalls![0]!.result).toBeDefined()
    expect(messages[0]!.toolCalls![0]!.result!.success).toBe(true)
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
      currentContextWindowId: 'legacy-window-1', // No session.initialized event, uses fallback
      todos: [],
      readFiles: [],
      snapshotSeq: 42,
      snapshotAt: 999,
    })
  })
})
