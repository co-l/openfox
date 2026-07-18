import { describe, expect, it } from 'vitest'
import type { StoredEvent } from './types.js'
import type { MessageStats } from '../../shared/types.js'
import {
  buildContextMessagesFromEventHistory,
  buildContextMessagesFromStoredEvents,
  buildMessagesFromStoredEvents,
  buildSnapshotFromSessionState,
  foldContextState,
  foldSessionState,
  foldTurnEventsToSnapshotMessages,
  reorderToolMessages,
} from './folding.js'
import type { ContextMessage, MessageWithId } from './fold-types.js'

const baseEvent = {
  seq: 1,
  sessionId: 'session-1',
  timestamp: Date.parse('2024-01-01T00:00:00.000Z'),
}

describe('apply-events.ts new handlers', () => {
  describe('tool.output events', () => {
    it('populates streamingOutput on tool calls', () => {
      const events: StoredEvent[] = [
        { ...baseEvent, type: 'message.start', data: { messageId: 'm1', role: 'assistant' } },
        {
          ...baseEvent,
          type: 'tool.call',
          data: { messageId: 'm1', toolCall: { id: 'call-1', name: 'run_command', arguments: {} } },
        },
        {
          ...baseEvent,
          type: 'tool.output',
          data: { messageId: 'm1', toolCallId: 'call-1', stream: 'stdout', content: 'First line\n' },
        },
        {
          ...baseEvent,
          type: 'tool.output',
          data: { messageId: 'm1', toolCallId: 'call-1', stream: 'stderr', content: 'Error output\n' },
        },
        {
          ...baseEvent,
          type: 'tool.result',
          data: {
            messageId: 'm1',
            toolCallId: 'call-1',
            result: { success: true, output: 'Done', durationMs: 1, truncated: false },
          },
        },
      ]

      const messages = buildMessagesFromStoredEvents(events)
      const tc = messages[0]!.toolCalls![0]!

      expect(tc.streamingOutput).toHaveLength(2)
      expect(tc.streamingOutput![0]).toEqual({
        stream: 'stdout',
        content: 'First line\n',
        timestamp: baseEvent.timestamp,
      })
      expect(tc.streamingOutput![1]).toEqual({
        stream: 'stderr',
        content: 'Error output\n',
        timestamp: baseEvent.timestamp,
      })
    })
  })

  describe('pattern.retry events', () => {
    it('populates formatRetries on assistant messages', () => {
      const events: StoredEvent[] = [
        { ...baseEvent, type: 'message.start', data: { messageId: 'm1', role: 'assistant' } },
        {
          ...baseEvent,
          type: 'pattern.retry',
          data: {
            messageId: 'm1',
            pattern: 'test',
            field: 'content',
            attempt: 1,
            maxAttempts: 3,
            matchedContent: 'test content',
          },
        },
        { ...baseEvent, type: 'message.delta', data: { messageId: 'm1', content: 'Attempt 1 failed' } },
        {
          ...baseEvent,
          type: 'pattern.retry',
          data: {
            messageId: 'm1',
            pattern: 'test',
            field: 'content',
            attempt: 2,
            maxAttempts: 3,
            matchedContent: 'test content',
          },
        },
      ]

      const messages = buildMessagesFromStoredEvents(events)
      const retries = (messages[0] as { formatRetries?: { attempt: number; maxAttempts: number }[] }).formatRetries

      expect(retries).toHaveLength(2)
      expect(retries![0]).toEqual({ attempt: 1, maxAttempts: 3, timestamp: baseEvent.timestamp })
      expect(retries![1]).toEqual({ attempt: 2, maxAttempts: 3, timestamp: baseEvent.timestamp })
    })
  })

  describe('chat.done events', () => {
    it('sets isComplete and completeReason on messages', () => {
      const events: StoredEvent[] = [
        { ...baseEvent, type: 'message.start', data: { messageId: 'm1', role: 'assistant' } },
        { ...baseEvent, type: 'message.done', data: { messageId: 'm1' } },
        {
          ...baseEvent,
          type: 'chat.done',
          data: { messageId: 'm1', reason: 'complete', stats: { totalTime: 100 } as unknown as MessageStats },
        },
      ]

      const messages = buildMessagesFromStoredEvents(events)
      expect((messages[0] as { isComplete?: boolean; completeReason?: string }).isComplete).toBe(true)
      expect((messages[0] as { isComplete?: boolean; completeReason?: string }).completeReason).toBe('complete')
    })
  })
})

describe('event folding', () => {
  it('builds ui messages from stored events, including tool results and streaming flags', () => {
    const events: StoredEvent[] = [
      { ...baseEvent, type: 'message.start', data: { messageId: 'm1', role: 'assistant' } },
      { ...baseEvent, type: 'message.delta', data: { messageId: 'm1', content: 'Hello' } },
      { ...baseEvent, type: 'message.thinking', data: { messageId: 'm1', content: 'Thinking...' } },
      {
        ...baseEvent,
        type: 'tool.call',
        data: { messageId: 'm1', toolCall: { id: 'call-1', name: 'read_file', arguments: { path: 'src/index.ts' } } },
      },
      {
        ...baseEvent,
        type: 'tool.result',
        data: {
          messageId: 'm1',
          toolCallId: 'call-1',
          result: { success: true, output: 'ok', durationMs: 1, truncated: false },
        },
      },
      {
        ...baseEvent,
        type: 'message.done',
        data: {
          messageId: 'm1',
          partial: true,
          stats: {
            providerId: 'provider-1',
            providerName: 'Local vLLM',
            backend: 'vllm',
            model: 'qwen',
            mode: 'builder',
            totalTime: 1,
            toolTime: 0,
            prefillTokens: 1,
            prefillSpeed: 1,
            generationTokens: 1,
            generationSpeed: 1,
          },
          segments: [{ type: 'text', content: 'Hello' }],
        },
      },
      {
        ...baseEvent,
        type: 'message.start',
        data: {
          messageId: 'm2',
          role: 'user',
          content: 'Question',
          isSystemGenerated: true,
          messageKind: 'auto-prompt',
        },
      },
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
        stats: {
          providerId: 'provider-1',
          providerName: 'Local vLLM',
          backend: 'vllm',
          model: 'qwen',
          mode: 'builder',
          totalTime: 1,
          toolTime: 0,
          prefillTokens: 1,
          prefillSpeed: 1,
          generationTokens: 1,
          generationSpeed: 1,
        },
        segments: [{ type: 'text', content: 'Hello' }],
        toolCalls: [
          {
            id: 'call-1',
            name: 'read_file',
            arguments: { path: 'src/index.ts' },
            result: { success: true, output: 'ok', durationMs: 1, truncated: false },
          },
        ],
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
      {
        ...baseEvent,
        type: 'tool.call',
        data: { messageId: 'm2', toolCall: { id: 'call-1', name: 'glob', arguments: { pattern: '*.ts' } } },
      },
      {
        ...baseEvent,
        type: 'tool.result',
        data: {
          messageId: 'm2',
          toolCallId: 'call-1',
          result: { success: false, error: 'bad path', durationMs: 1, truncated: false },
        },
      },
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
      {
        ...baseEvent,
        type: 'message.start',
        data: { messageId: 'old-user', role: 'user', content: 'old', contextWindowId: 'window-1' },
      },
      { ...baseEvent, type: 'message.done', data: { messageId: 'old-user' } },
      {
        ...baseEvent,
        type: 'message.start',
        data: { messageId: 'old-assistant', role: 'assistant', contextWindowId: 'window-1' },
      },
      { ...baseEvent, type: 'message.delta', data: { messageId: 'old-assistant', content: 'previous answer' } },
      {
        ...baseEvent,
        type: 'tool.call',
        data: {
          messageId: 'old-assistant',
          toolCall: { id: 'old-call', name: 'glob', arguments: { pattern: '*.ts' } },
        },
      },
      {
        ...baseEvent,
        type: 'tool.result',
        data: {
          messageId: 'old-assistant',
          toolCallId: 'old-call',
          result: { success: true, output: 'old result', durationMs: 1, truncated: false },
        },
      },
      {
        ...baseEvent,
        type: 'message.start',
        data: { messageId: 'new-user', role: 'user', content: 'new', contextWindowId: 'window-2' },
      },
      { ...baseEvent, type: 'message.done', data: { messageId: 'new-user' } },
      {
        ...baseEvent,
        type: 'message.start',
        data: { messageId: 'new-assistant', role: 'assistant', contextWindowId: 'window-2' },
      },
      { ...baseEvent, type: 'message.delta', data: { messageId: 'new-assistant', content: 'current answer' } },
      {
        ...baseEvent,
        type: 'tool.call',
        data: {
          messageId: 'new-assistant',
          toolCall: { id: 'new-call', name: 'read_file', arguments: { path: 'src/app.ts' } },
        },
      },
      {
        ...baseEvent,
        type: 'tool.result',
        data: {
          messageId: 'new-assistant',
          toolCallId: 'new-call',
          result: { success: true, output: 'new result', durationMs: 1, truncated: false },
        },
      },
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

  it('reconstructs llm context from the latest snapshot plus newer events', () => {
    const events: StoredEvent[] = [
      {
        ...baseEvent,
        seq: 1,
        type: 'turn.snapshot',
        data: {
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          messages: [
            {
              id: 'msg-1',
              role: 'user',
              content: 'Fix loading deleted sessions gracefully',
              timestamp: baseEvent.timestamp,
              contextWindowId: 'window-1',
            },
            {
              id: 'msg-2',
              role: 'assistant',
              content: 'I can help propose acceptance criteria.',
              timestamp: baseEvent.timestamp,
              contextWindowId: 'window-1',
            },
          ],
          criteria: [],
          contextState: {
            currentTokens: 50,
            maxTokens: 200000,
            compactionCount: 0,
            dangerZone: false,
            canCompact: false,
            dynamicContextChanged: false,
          },
          currentContextWindowId: 'window-1',
          todos: [],
          readFiles: [],
          snapshotSeq: 1,
          snapshotAt: baseEvent.timestamp,
        },
      },
      {
        ...baseEvent,
        seq: 2,
        type: 'message.start',
        data: {
          messageId: 'msg-3',
          role: 'user',
          content: 'Redirect to the project view instead of hanging',
          contextWindowId: 'window-1',
        },
      },
      {
        ...baseEvent,
        seq: 3,
        type: 'message.done',
        data: { messageId: 'msg-3' },
      },
    ]

    expect(buildContextMessagesFromEventHistory(events)).toEqual([
      {
        role: 'user',
        content: 'Fix loading deleted sessions gracefully',
      },
      {
        role: 'assistant',
        content: 'I can help propose acceptance criteria.',
      },
      {
        role: 'user',
        content: 'Redirect to the project view instead of hanging',
      },
    ])
  })

  it('reconstructs current-window llm context from snapshot history', () => {
    const events: StoredEvent[] = [
      {
        ...baseEvent,
        seq: 1,
        type: 'turn.snapshot',
        data: {
          mode: 'builder',
          phase: 'build',
          isRunning: false,
          messages: [
            {
              id: 'msg-1',
              role: 'user',
              content: 'Old window message',
              timestamp: baseEvent.timestamp,
              contextWindowId: 'window-1',
            },
            {
              id: 'msg-2',
              role: 'user',
              content: 'Current window message',
              timestamp: baseEvent.timestamp,
              contextWindowId: 'window-2',
            },
          ],
          criteria: [],
          contextState: {
            currentTokens: 50,
            maxTokens: 200000,
            compactionCount: 1,
            dangerZone: false,
            canCompact: false,
            dynamicContextChanged: false,
          },
          currentContextWindowId: 'window-2',
          todos: [],
          readFiles: [],
          snapshotSeq: 1,
          snapshotAt: baseEvent.timestamp,
        },
      },
      {
        ...baseEvent,
        seq: 2,
        type: 'message.start',
        data: { messageId: 'msg-3', role: 'assistant', contextWindowId: 'window-2' },
      },
      {
        ...baseEvent,
        seq: 3,
        type: 'message.delta',
        data: { messageId: 'msg-3', content: 'New current-window reply' },
      },
    ]

    expect(buildContextMessagesFromEventHistory(events, 'window-2')).toEqual([
      {
        role: 'user',
        content: 'Current window message',
      },
      {
        role: 'assistant',
        content: 'New current-window reply',
      },
    ])
  })

  it('excludes verifier sub-agent messages from main-context reconstruction when requested', () => {
    const events: StoredEvent[] = [
      {
        ...baseEvent,
        type: 'message.start',
        data: { messageId: 'user-1', role: 'user', content: 'build it', contextWindowId: 'window-1' },
      },
      { ...baseEvent, type: 'message.done', data: { messageId: 'user-1' } },
      {
        ...baseEvent,
        type: 'message.start',
        data: {
          messageId: 'reset',
          role: 'user',
          content: 'Fresh Context',
          contextWindowId: 'window-1',
          subAgentType: 'verifier',
          messageKind: 'context-reset',
        },
      },
      { ...baseEvent, type: 'message.done', data: { messageId: 'reset' } },
      {
        ...baseEvent,
        type: 'message.start',
        data: { messageId: 'verifier-1', role: 'assistant', contextWindowId: 'window-1', subAgentType: 'verifier' },
      },
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
          contextState: {
            currentTokens: 50,
            maxTokens: 200000,
            compactionCount: 0,
            dangerZone: false,
            canCompact: false,
            dynamicContextChanged: false,
          },
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
          contextState: {
            currentTokens: 100,
            maxTokens: 200000,
            compactionCount: 0,
            dangerZone: false,
            canCompact: false,
            dynamicContextChanged: false,
          },
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

  it('uses the latest snapshot rather than the oldest retained snapshot', () => {
    const firstTimestamp = Date.parse('2024-01-01T00:00:00.000Z')
    const secondTimestamp = Date.parse('2024-01-01T00:10:00.000Z')

    const events: StoredEvent[] = [
      {
        seq: 1,
        timestamp: firstTimestamp,
        sessionId: 'session-1',
        type: 'session.initialized',
        data: { projectId: 'proj-1', workdir: '/tmp', contextWindowId: 'window-1' },
      },
      {
        seq: 2,
        timestamp: firstTimestamp,
        sessionId: 'session-1',
        type: 'turn.snapshot',
        data: {
          mode: 'builder',
          phase: 'plan',
          isRunning: false,
          messages: [{ id: 'msg-1', role: 'assistant', content: 'old answer', timestamp: firstTimestamp }],
          criteria: [],
          contextState: {
            currentTokens: 100,
            maxTokens: 200000,
            compactionCount: 0,
            dangerZone: false,
            canCompact: false,
            dynamicContextChanged: false,
          },
          currentContextWindowId: 'window-1',
          todos: [],
          readFiles: [],
          snapshotSeq: 2,
          snapshotAt: firstTimestamp,
        },
      },
      {
        seq: 3,
        timestamp: secondTimestamp,
        sessionId: 'session-1',
        type: 'turn.snapshot',
        data: {
          mode: 'builder',
          phase: 'plan',
          isRunning: false,
          messages: [
            { id: 'msg-1', role: 'assistant', content: 'new answer', timestamp: secondTimestamp },
            { id: 'msg-2', role: 'assistant', content: 'latest answer', timestamp: secondTimestamp },
          ],
          criteria: [],
          contextState: {
            currentTokens: 200,
            maxTokens: 200000,
            compactionCount: 1,
            dangerZone: false,
            canCompact: false,
            dynamicContextChanged: false,
          },
          currentContextWindowId: 'window-1',
          todos: [],
          readFiles: [],
          snapshotSeq: 3,
          snapshotAt: secondTimestamp,
        },
      },
    ]

    expect(buildMessagesFromStoredEvents(events)).toEqual([
      {
        id: 'msg-1',
        role: 'assistant',
        content: 'new answer',
        timestamp: '2024-01-01T00:10:00.000Z',
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'latest answer',
        timestamp: '2024-01-01T00:10:00.000Z',
      },
    ])
  })

  it('replays events that happened after the latest snapshot', () => {
    const snapshotTimestamp = Date.parse('2024-01-01T00:00:00.000Z')
    const afterSnapshotTimestamp = Date.parse('2024-01-01T00:05:00.000Z')

    const events: StoredEvent[] = [
      {
        seq: 1,
        timestamp: snapshotTimestamp,
        sessionId: 'session-1',
        type: 'session.initialized',
        data: { projectId: 'proj-1', workdir: '/tmp', contextWindowId: 'window-1' },
      },
      {
        seq: 2,
        timestamp: snapshotTimestamp,
        sessionId: 'session-1',
        type: 'turn.snapshot',
        data: {
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          messages: [{ id: 'msg-1', role: 'user', content: 'hello', timestamp: snapshotTimestamp }],
          criteria: [],
          contextState: {
            currentTokens: 10,
            maxTokens: 200000,
            compactionCount: 0,
            dangerZone: false,
            canCompact: false,
            dynamicContextChanged: false,
          },
          currentContextWindowId: 'window-1',
          todos: [],
          readFiles: [],
          snapshotSeq: 2,
          snapshotAt: snapshotTimestamp,
        },
      },
      {
        seq: 3,
        timestamp: afterSnapshotTimestamp,
        sessionId: 'session-1',
        type: 'message.start',
        data: { messageId: 'msg-2', role: 'assistant' },
      },
      {
        seq: 4,
        timestamp: afterSnapshotTimestamp,
        sessionId: 'session-1',
        type: 'message.delta',
        data: { messageId: 'msg-2', content: 'fresh response' },
      },
      {
        seq: 5,
        timestamp: afterSnapshotTimestamp,
        sessionId: 'session-1',
        type: 'message.done',
        data: {
          messageId: 'msg-2',
          stats: {
            providerId: 'provider-1',
            providerName: 'Local vLLM',
            backend: 'vllm',
            model: 'qwen',
            mode: 'planner',
            totalTime: 2,
            toolTime: 0,
            prefillTokens: 100,
            prefillSpeed: 50,
            generationTokens: 20,
            generationSpeed: 10,
          },
        },
      },
    ]

    expect(buildMessagesFromStoredEvents(events)).toEqual([
      {
        id: 'msg-1',
        role: 'user',
        content: 'hello',
        timestamp: '2024-01-01T00:00:00.000Z',
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'fresh response',
        timestamp: '2024-01-01T00:05:00.000Z',
        tokenCount: 0,
        isStreaming: false,
        stats: {
          providerId: 'provider-1',
          providerName: 'Local vLLM',
          backend: 'vllm',
          model: 'qwen',
          mode: 'planner',
          totalTime: 2,
          toolTime: 0,
          prefillTokens: 100,
          prefillSpeed: 50,
          generationTokens: 20,
          generationSpeed: 10,
        },
      },
    ])
  })

  it('folds turn events into snapshot messages and builds a snapshot', () => {
    const events: Array<{ type: any; timestamp: number; data: any }> = [
      {
        type: 'message.start',
        timestamp: 123,
        data: { messageId: 'm1', role: 'assistant' as const, contextWindowId: 'window-1' },
      },
      { type: 'message.delta', timestamp: 123, data: { messageId: 'm1', content: 'Hello' } },
      { type: 'message.thinking', timestamp: 123, data: { messageId: 'm1', content: 'Thinking' } },
      {
        type: 'tool.call',
        timestamp: 123,
        data: { messageId: 'm1', toolCall: { id: 'call-1', name: 'read_file', arguments: { path: 'x' } } },
      },
      {
        type: 'tool.result',
        timestamp: 123,
        data: {
          messageId: 'm1',
          toolCallId: 'call-1',
          result: { success: true, output: 'ok', durationMs: 1, truncated: false },
        },
      },
      {
        type: 'message.done',
        timestamp: 123,
        data: {
          messageId: 'm1',
          partial: true,
          stats: {
            model: 'qwen',
            mode: 'planner' as const,
            totalTime: 1,
            toolTime: 0,
            prefillTokens: 1,
            prefillSpeed: 1,
            generationTokens: 1,
            generationSpeed: 1,
          },
        },
      },
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
      toolCalls: [
        {
          id: 'call-1',
          name: 'read_file',
          arguments: { path: 'x' },
          result: { success: true, output: 'ok', durationMs: 1, truncated: false },
        },
      ],
    })

    expect(
      buildSnapshotFromSessionState({
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
        maxTokens: 200000,
      }),
    ).toEqual({
      mode: 'builder',
      phase: 'build',
      isRunning: true,
      messages,
      criteria: [],
      metadataEntries: {},
      contextState: {
        // Note: currentTokens and compactionCount come from folded events,
        // not from executionState (which is a legacy cache that's never updated)
        currentTokens: 0,
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      },
      currentContextWindowId: 'legacy-window-1', // No session.initialized event, uses fallback
      todos: [],
      readFiles: [],
      snapshotSeq: 42,
      snapshotAt: 999,
    })
  })

  it('builds snapshots from the latest retained snapshot plus newer turn events', () => {
    const initialTimestamp = Date.parse('2024-01-01T00:00:00.000Z')
    const newTurnTimestamp = Date.parse('2024-01-01T00:05:00.000Z')

    const snapshot = buildSnapshotFromSessionState({
      session: {
        mode: 'builder',
        phase: 'build',
        isRunning: false,
        criteria: [],
        executionState: { currentTokenCount: 120, compactionCount: 1 },
      },
      events: [
        {
          timestamp: initialTimestamp,
          type: 'session.initialized',
          data: { projectId: 'proj-1', workdir: '/tmp', contextWindowId: 'window-1' },
        },
        {
          timestamp: initialTimestamp,
          type: 'turn.snapshot',
          data: {
            mode: 'planner',
            phase: 'plan',
            isRunning: false,
            messages: [
              {
                id: 'msg-1',
                role: 'user',
                content: 'First turn',
                timestamp: initialTimestamp,
                contextWindowId: 'window-1',
              },
              {
                id: 'msg-2',
                role: 'assistant',
                content: 'First reply',
                timestamp: initialTimestamp,
                contextWindowId: 'window-1',
              },
            ],
            criteria: [],
            contextState: {
              currentTokens: 40,
              maxTokens: 200000,
              compactionCount: 0,
              dangerZone: false,
              canCompact: false,
              dynamicContextChanged: false,
            },
            currentContextWindowId: 'window-1',
            todos: [],
            readFiles: [],
            snapshotSeq: 2,
            snapshotAt: initialTimestamp,
          },
        },
        {
          timestamp: newTurnTimestamp,
          type: 'message.start',
          data: { messageId: 'msg-3', role: 'user', content: 'Second turn', contextWindowId: 'window-1' },
        },
        {
          timestamp: newTurnTimestamp,
          type: 'message.done',
          data: { messageId: 'msg-3' },
        },
        {
          timestamp: newTurnTimestamp,
          type: 'message.start',
          data: { messageId: 'msg-4', role: 'assistant', contextWindowId: 'window-1' },
        },
        {
          timestamp: newTurnTimestamp,
          type: 'message.delta',
          data: { messageId: 'msg-4', content: 'Second reply' },
        },
        {
          timestamp: newTurnTimestamp,
          type: 'message.done',
          data: { messageId: 'msg-4' },
        },
      ],
      latestSeq: 7,
      snapshotAt: newTurnTimestamp,
    })

    expect(snapshot.messages.map((message) => message.content)).toEqual([
      'First turn',
      'First reply',
      'Second turn',
      'Second reply',
    ])
  })

  describe('foldPendingConfirmations', () => {
    it('returns pending confirmations when no response received', () => {
      const events: StoredEvent[] = [
        {
          ...baseEvent,
          seq: 1,
          type: 'session.initialized',
          data: { projectId: 'proj-1', workdir: '/tmp', contextWindowId: 'window-1' },
        },
        {
          ...baseEvent,
          seq: 2,
          type: 'path.confirmation_pending',
          data: {
            callId: 'call-1',
            tool: 'read_file',
            paths: ['/etc/passwd'],
            workdir: '/tmp',
            reason: 'outside_workdir',
          },
        },
      ]

      const state = foldSessionState(events, 'window-1', 200000)
      expect(state.pendingConfirmations).toHaveLength(1)
      expect(state.pendingConfirmations[0]).toEqual({
        callId: 'call-1',
        tool: 'read_file',
        paths: ['/etc/passwd'],
        workdir: '/tmp',
        reason: 'outside_workdir',
      })
    })

    it('excludes confirmed paths when response received', () => {
      const events: StoredEvent[] = [
        {
          ...baseEvent,
          seq: 1,
          type: 'session.initialized',
          data: { projectId: 'proj-1', workdir: '/tmp', contextWindowId: 'window-1' },
        },
        {
          ...baseEvent,
          seq: 2,
          type: 'path.confirmation_pending',
          data: {
            callId: 'call-1',
            tool: 'read_file',
            paths: ['/etc/passwd'],
            workdir: '/tmp',
            reason: 'outside_workdir',
          },
        },
        {
          ...baseEvent,
          seq: 3,
          type: 'path.confirmation_responded',
          data: { callId: 'call-1', approved: true, alwaysAllow: false },
        },
      ]

      const state = foldSessionState(events, 'window-1', 200000)
      expect(state.pendingConfirmations).toHaveLength(0)
    })

    it('handles multiple pending confirmations', () => {
      const events: StoredEvent[] = [
        {
          ...baseEvent,
          seq: 1,
          type: 'session.initialized',
          data: { projectId: 'proj-1', workdir: '/tmp', contextWindowId: 'window-1' },
        },
        {
          ...baseEvent,
          seq: 2,
          type: 'path.confirmation_pending',
          data: {
            callId: 'call-1',
            tool: 'read_file',
            paths: ['/etc/passwd'],
            workdir: '/tmp',
            reason: 'outside_workdir',
          },
        },
        {
          ...baseEvent,
          seq: 3,
          type: 'path.confirmation_pending',
          data: {
            callId: 'call-2',
            tool: 'run_command',
            paths: ['/bin/rm'],
            workdir: '/tmp',
            reason: 'dangerous_command',
          },
        },
        {
          ...baseEvent,
          seq: 4,
          type: 'path.confirmation_responded',
          data: { callId: 'call-1', approved: true, alwaysAllow: true },
        },
      ]

      const state = foldSessionState(events, 'window-1', 200000)
      expect(state.pendingConfirmations).toHaveLength(1)
      expect(state.pendingConfirmations[0]?.callId).toBe('call-2')
    })
  })

  describe('sub-agent message exclusion from context', () => {
    it('excludes sub-agent messages from buildContextMessagesFromStoredEvents', () => {
      // When call_sub_agent runs in the current turn, sub-agent events are emitted
      // to the same session with subAgentId set. These must be excluded from the
      // main agent's context to avoid invalid message sequences (400 errors).
      const events: StoredEvent[] = [
        {
          ...baseEvent,
          seq: 1,
          type: 'session.initialized',
          data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' },
        },
        // Main agent user message
        {
          ...baseEvent,
          seq: 2,
          type: 'message.start',
          data: { messageId: 'user-main', role: 'user', content: 'Do something', contextWindowId: 'window-1' },
        },
        // Main agent assistant calls call_sub_agent
        {
          ...baseEvent,
          seq: 3,
          type: 'message.start',
          data: { messageId: 'asst-main', role: 'assistant', contextWindowId: 'window-1' },
        },
        {
          ...baseEvent,
          seq: 4,
          type: 'tool.call',
          data: {
            messageId: 'asst-main',
            toolCall: { id: 'tc-main', name: 'call_sub_agent', arguments: { subAgentType: 'planner', prompt: 'task' } },
          },
        },
        // Sub-agent messages (have subAgentId set - must be excluded)
        {
          ...baseEvent,
          seq: 5,
          type: 'message.start',
          data: {
            messageId: 'user-sub-1',
            role: 'user',
            content: 'Fresh Context',
            contextWindowId: 'window-1',
            subAgentId: 'sub-1',
            subAgentType: 'planner',
          },
        },
        {
          ...baseEvent,
          seq: 6,
          type: 'message.start',
          data: {
            messageId: 'user-sub-2',
            role: 'user',
            content: 'task prompt',
            contextWindowId: 'window-1',
            subAgentId: 'sub-1',
            subAgentType: 'planner',
          },
        },
        {
          ...baseEvent,
          seq: 7,
          type: 'message.start',
          data: {
            messageId: 'asst-sub',
            role: 'assistant',
            contextWindowId: 'window-1',
            subAgentId: 'sub-1',
            subAgentType: 'planner',
          },
        },
        {
          ...baseEvent,
          seq: 8,
          type: 'tool.call',
          data: {
            messageId: 'asst-sub',
            toolCall: { id: 'tc-sub', name: 'read_file', arguments: { path: 'package.json' } },
          },
        },
        {
          ...baseEvent,
          seq: 9,
          type: 'tool.result',
          data: {
            messageId: 'asst-sub',
            toolCallId: 'tc-sub',
            result: { success: true, output: 'file content', durationMs: 1, truncated: false },
          },
        },
        // Main agent tool result for call_sub_agent (no subAgentId - must be included)
        {
          ...baseEvent,
          seq: 10,
          type: 'tool.result',
          data: {
            messageId: 'asst-main',
            toolCallId: 'tc-main',
            result: { success: true, output: 'sub-agent result', durationMs: 10, truncated: false },
          },
        },
      ]

      const messages = buildContextMessagesFromStoredEvents(events, 'window-1')

      // Only main agent messages should appear
      expect(messages).toHaveLength(3) // user-main, asst-main, tool-result for tc-main
      expect(messages[0]).toMatchObject({ role: 'user', content: 'Do something' })
      expect(messages[1]).toMatchObject({ role: 'assistant', toolCalls: [{ id: 'tc-main', name: 'call_sub_agent' }] })
      expect(messages[2]).toMatchObject({ role: 'tool', toolCallId: 'tc-main', content: 'sub-agent result' })

      // Sub-agent messages must NOT appear
      const subAgentMessages = messages.filter(
        (m) => m.content === 'Fresh Context' || m.content === 'task prompt' || m.content === 'file content',
      )
      expect(subAgentMessages).toHaveLength(0)
    })

    it('produces a valid (non-interleaved) sequence for main agent after sub-agent call', () => {
      // The key invariant: after filtering sub-agent messages, the main agent's
      // assistant message with tool_calls is immediately followed by its tool result,
      // with no user messages in between (which would cause 400 errors).
      const events: StoredEvent[] = [
        {
          ...baseEvent,
          seq: 1,
          type: 'message.start',
          data: { messageId: 'user-main', role: 'user', content: 'task', contextWindowId: 'win-1' },
        },
        {
          ...baseEvent,
          seq: 2,
          type: 'message.start',
          data: { messageId: 'asst-main', role: 'assistant', contextWindowId: 'win-1' },
        },
        {
          ...baseEvent,
          seq: 3,
          type: 'tool.call',
          data: { messageId: 'asst-main', toolCall: { id: 'tc-main', name: 'call_sub_agent', arguments: {} } },
        },
        // Sub-agent user messages appear between assistant and its tool result
        {
          ...baseEvent,
          seq: 4,
          type: 'message.start',
          data: {
            messageId: 'u1',
            role: 'user',
            content: 'Fresh Context',
            contextWindowId: 'win-1',
            subAgentId: 'sa',
            subAgentType: 'planner',
          },
        },
        {
          ...baseEvent,
          seq: 5,
          type: 'message.start',
          data: {
            messageId: 'u2',
            role: 'user',
            content: 'prompt',
            contextWindowId: 'win-1',
            subAgentId: 'sa',
            subAgentType: 'planner',
          },
        },
        {
          ...baseEvent,
          seq: 6,
          type: 'tool.result',
          data: {
            messageId: 'asst-main',
            toolCallId: 'tc-main',
            result: { success: true, output: 'result', durationMs: 1, truncated: false },
          },
        },
      ]

      const messages = buildContextMessagesFromStoredEvents(events, 'win-1')

      expect(messages).toHaveLength(3)
      // assistant must be immediately followed by its tool result (valid sequence)
      expect(messages[1]).toMatchObject({ role: 'assistant' })
      expect(messages[2]).toMatchObject({ role: 'tool', toolCallId: 'tc-main' })
    })
  })

  describe('context.state sub-agent filtering', () => {
    it('filters out context.state events with subAgentId', () => {
      const events: StoredEvent[] = [
        {
          ...baseEvent,
          seq: 1,
          type: 'session.initialized',
          data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' },
        },
        {
          ...baseEvent,
          seq: 2,
          type: 'context.state',
          data: {
            currentTokens: 50000,
            maxTokens: 128000,
            compactionCount: 0,
            dangerZone: false,
            canCompact: false,
            dynamicContextChanged: false,
          },
        },
        {
          ...baseEvent,
          seq: 3,
          type: 'context.state',
          data: {
            currentTokens: 30000,
            maxTokens: 128000,
            compactionCount: 0,
            dangerZone: false,
            canCompact: false,
            dynamicContextChanged: false,
            subAgentId: 'sub-1',
          },
        },
        {
          ...baseEvent,
          seq: 4,
          type: 'context.state',
          data: {
            currentTokens: 60000,
            maxTokens: 128000,
            compactionCount: 1,
            dangerZone: true,
            canCompact: false,
            dynamicContextChanged: false,
          },
        },
      ]

      const result = foldContextState(events, 'window-1')

      expect(result.latestContextState?.currentTokens).toBe(60000)
      expect(result.latestContextState?.compactionCount).toBe(1)
      expect(result.compactionCount).toBe(0) // compactionCount tracks context.compacted events, not context.state
    })

    it('uses last main agent context state after subagent emits one', () => {
      const events: StoredEvent[] = [
        {
          ...baseEvent,
          seq: 1,
          type: 'session.initialized',
          data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' },
        },
        {
          ...baseEvent,
          seq: 2,
          type: 'context.state',
          data: {
            currentTokens: 20000,
            maxTokens: 128000,
            compactionCount: 0,
            dangerZone: false,
            canCompact: false,
            dynamicContextChanged: false,
          },
        },
        {
          ...baseEvent,
          seq: 3,
          type: 'context.state',
          data: {
            currentTokens: 10000,
            maxTokens: 128000,
            compactionCount: 0,
            dangerZone: false,
            canCompact: false,
            dynamicContextChanged: false,
            subAgentId: 'sub-1',
          },
        },
        {
          ...baseEvent,
          seq: 4,
          type: 'context.state',
          data: {
            currentTokens: 45000,
            maxTokens: 128000,
            compactionCount: 0,
            dangerZone: false,
            canCompact: false,
            dynamicContextChanged: false,
            subAgentId: 'sub-2',
          },
        },
        {
          ...baseEvent,
          seq: 5,
          type: 'context.state',
          data: {
            currentTokens: 25000,
            maxTokens: 128000,
            compactionCount: 0,
            dangerZone: false,
            canCompact: false,
            dynamicContextChanged: false,
          },
        },
      ]

      const result = foldContextState(events, 'window-1')

      expect(result.latestContextState?.currentTokens).toBe(25000)
    })

    it('uses last main agent context state when last event is from subagent', () => {
      const events: StoredEvent[] = [
        {
          ...baseEvent,
          seq: 1,
          type: 'session.initialized',
          data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' },
        },
        {
          ...baseEvent,
          seq: 2,
          type: 'context.state',
          data: {
            currentTokens: 50000,
            maxTokens: 128000,
            compactionCount: 0,
            dangerZone: false,
            canCompact: false,
            dynamicContextChanged: false,
          },
        },
        {
          ...baseEvent,
          seq: 3,
          type: 'context.state',
          data: {
            currentTokens: 10000,
            maxTokens: 128000,
            compactionCount: 0,
            dangerZone: false,
            canCompact: false,
            dynamicContextChanged: false,
            subAgentId: 'sub-1',
          },
        },
      ]

      const result = foldContextState(events, 'window-1')

      expect(result.latestContextState?.currentTokens).toBe(50000)
    })
  })

  describe('orphaned tool call filtering (abort scenario)', () => {
    it('strips orphaned toolCalls from assistant message in buildContextMessagesFromStoredEvents when tool.result is missing', () => {
      const events: StoredEvent[] = [
        { ...baseEvent, type: 'message.start', data: { messageId: 'm1', role: 'user', content: 'do it' } },
        { ...baseEvent, type: 'message.done', data: { messageId: 'm1' } },
        { ...baseEvent, type: 'message.start', data: { messageId: 'm2', role: 'assistant' } },
        {
          ...baseEvent,
          type: 'tool.call',
          data: {
            messageId: 'm2',
            toolCall: { id: 'call-1', name: 'run_command', arguments: { command: 'sleep 10' } },
          },
        },
        // NO tool.result for call-1 — simulates tool that threw on abort
        { ...baseEvent, type: 'message.done', data: { messageId: 'm2', partial: true } },
        { ...baseEvent, type: 'chat.done', data: { messageId: 'm2', reason: 'stopped' } },
      ]

      const messages = buildContextMessagesFromStoredEvents(events)

      // Assistant message should NOT have the orphaned tool call
      const assistant = messages.find((m) => m.role === 'assistant')
      expect(assistant).toBeDefined()
      expect(assistant!.toolCalls).toBeUndefined()

      // Only user message and assistant (no tool message since result is missing)
      expect(messages).toHaveLength(2)
      expect(messages[0]).toMatchObject({ role: 'user', content: 'do it' })
      expect(messages[1]).toMatchObject({ role: 'assistant' })
    })

    it('keeps toolCalls when all have matching tool.result events', () => {
      const events: StoredEvent[] = [
        { ...baseEvent, type: 'message.start', data: { messageId: 'm1', role: 'user', content: 'do it' } },
        { ...baseEvent, type: 'message.done', data: { messageId: 'm1' } },
        { ...baseEvent, type: 'message.start', data: { messageId: 'm2', role: 'assistant' } },
        {
          ...baseEvent,
          type: 'tool.call',
          data: { messageId: 'm2', toolCall: { id: 'call-1', name: 'run_command', arguments: { command: 'echo hi' } } },
        },
        {
          ...baseEvent,
          type: 'tool.result',
          data: {
            messageId: 'm2',
            toolCallId: 'call-1',
            result: { success: true, output: 'hi', durationMs: 1, truncated: false },
          },
        },
        { ...baseEvent, type: 'message.done', data: { messageId: 'm2' } },
      ]

      const messages = buildContextMessagesFromStoredEvents(events)

      // Assistant should have toolCalls, and tool message should follow
      const assistant = messages.find((m) => m.role === 'assistant')
      expect(assistant!.toolCalls).toHaveLength(1)
      expect(assistant!.toolCalls![0]!.id).toBe('call-1')
      expect(messages.some((m) => m.role === 'tool' && m.toolCallId === 'call-1')).toBe(true)
    })

    it('strips orphaned toolCalls only (keeps fulfilled ones) when partial abort', () => {
      const events: StoredEvent[] = [
        { ...baseEvent, type: 'message.start', data: { messageId: 'm1', role: 'assistant' } },
        {
          ...baseEvent,
          type: 'tool.call',
          data: { messageId: 'm1', toolCall: { id: 'call-1', name: 'read_file', arguments: { path: 'a.txt' } } },
        },
        {
          ...baseEvent,
          type: 'tool.result',
          data: {
            messageId: 'm1',
            toolCallId: 'call-1',
            result: { success: true, output: 'a', durationMs: 1, truncated: false },
          },
        },
        {
          ...baseEvent,
          type: 'tool.call',
          data: {
            messageId: 'm1',
            toolCall: { id: 'call-2', name: 'run_command', arguments: { command: 'sleep 10' } },
          },
        },
        // NO tool.result for call-2 — this tool was aborted mid-execution
        { ...baseEvent, type: 'message.done', data: { messageId: 'm1', partial: true } },
      ]

      const messages = buildContextMessagesFromStoredEvents(events)

      // Assistant should only have call-1 (fulfilled), not call-2 (orphaned)
      const assistant = messages.find((m) => m.role === 'assistant')
      expect(assistant!.toolCalls).toHaveLength(1)
      expect(assistant!.toolCalls![0]!.id).toBe('call-1')

      // Tool message for call-1 should be present
      expect(messages.some((m) => m.role === 'tool' && m.toolCallId === 'call-1')).toBe(true)
    })

    describe('parallel tool call ordering', () => {
      it('preserves tool call order when tool.results arrive in reverse completion order', () => {
        // Simulate parallel tool execution where B finishes before A:
        // Events: tool.call(A), tool.call(B), tool.result(B), tool.result(A)
        // Expected: tool messages in call order [A, B], not completion order [B, A]
        const events: StoredEvent[] = [
          { ...baseEvent, type: 'message.start', data: { messageId: 'm1', role: 'user', content: 'run both' } },
          { ...baseEvent, type: 'message.done', data: { messageId: 'm1' } },
          { ...baseEvent, type: 'message.start', data: { messageId: 'm2', role: 'assistant' } },
          {
            ...baseEvent,
            type: 'tool.call',
            data: { messageId: 'm2', toolCall: { id: 'call-a', name: 'read_file', arguments: { path: 'a.txt' } } },
          },
          {
            ...baseEvent,
            type: 'tool.call',
            data: {
              messageId: 'm2',
              toolCall: { id: 'call-b', name: 'run_command', arguments: { command: 'echo b' } },
            },
          },
          // B finishes first — tool.result events in REVERSE order
          {
            ...baseEvent,
            type: 'tool.result',
            data: {
              messageId: 'm2',
              toolCallId: 'call-b',
              result: { success: true, output: 'b', durationMs: 1, truncated: false },
            },
          },
          {
            ...baseEvent,
            type: 'tool.result',
            data: {
              messageId: 'm2',
              toolCallId: 'call-a',
              result: { success: true, output: 'a', durationMs: 5, truncated: false },
            },
          },
          { ...baseEvent, type: 'message.done', data: { messageId: 'm2' } },
        ]

        const messages = buildContextMessagesFromStoredEvents(events)

        // Assistant should have toolCalls in call order [A, B]
        const assistant = messages.find((m) => m.role === 'assistant')
        expect(assistant!.toolCalls).toHaveLength(2)
        expect(assistant!.toolCalls![0]!.id).toBe('call-a')
        expect(assistant!.toolCalls![1]!.id).toBe('call-b')

        // Tool messages must be in call order [A, B], NOT completion order [B, A]
        const toolMessages = messages.filter((m) => m.role === 'tool')
        expect(toolMessages).toHaveLength(2)
        expect(toolMessages[0]!.toolCallId).toBe('call-a')
        expect(toolMessages[1]!.toolCallId).toBe('call-b')

        // Content should match
        expect(toolMessages[0]!.content).toBe('a')
        expect(toolMessages[1]!.content).toBe('b')
      })

      it('preserves order with three parallel tool calls', () => {
        // Three tools called in order [A, B, C], results arrive [C, A, B]
        const events: StoredEvent[] = [
          { ...baseEvent, type: 'message.start', data: { messageId: 'm1', role: 'assistant' } },
          {
            ...baseEvent,
            type: 'tool.call',
            data: { messageId: 'm1', toolCall: { id: 'call-a', name: 'read_file', arguments: { path: 'a.txt' } } },
          },
          {
            ...baseEvent,
            type: 'tool.call',
            data: { messageId: 'm1', toolCall: { id: 'call-b', name: 'read_file', arguments: { path: 'b.txt' } } },
          },
          {
            ...baseEvent,
            type: 'tool.call',
            data: { messageId: 'm1', toolCall: { id: 'call-c', name: 'read_file', arguments: { path: 'c.txt' } } },
          },
          // Results in reverse: C, A, B
          {
            ...baseEvent,
            type: 'tool.result',
            data: {
              messageId: 'm1',
              toolCallId: 'call-c',
              result: { success: true, output: 'c', durationMs: 1, truncated: false },
            },
          },
          {
            ...baseEvent,
            type: 'tool.result',
            data: {
              messageId: 'm1',
              toolCallId: 'call-a',
              result: { success: true, output: 'a', durationMs: 3, truncated: false },
            },
          },
          {
            ...baseEvent,
            type: 'tool.result',
            data: {
              messageId: 'm1',
              toolCallId: 'call-b',
              result: { success: true, output: 'b', durationMs: 5, truncated: false },
            },
          },
          { ...baseEvent, type: 'message.done', data: { messageId: 'm1' } },
        ]

        const messages = buildContextMessagesFromStoredEvents(events)

        const assistant = messages.find((m) => m.role === 'assistant')
        expect(assistant!.toolCalls).toHaveLength(3)
        expect(assistant!.toolCalls!.map((tc) => tc.id)).toEqual(['call-a', 'call-b', 'call-c'])

        const toolMessages = messages.filter((m) => m.role === 'tool')
        expect(toolMessages).toHaveLength(3)
        expect(toolMessages.map((m) => m.toolCallId)).toEqual(['call-a', 'call-b', 'call-c'])
      })

      it('does not reorder tool messages across different assistant messages', () => {
        // Two separate assistant messages, each with parallel tool calls.
        // Tool results from different assistants must NOT intermix.
        const events: StoredEvent[] = [
          { ...baseEvent, type: 'message.start', data: { messageId: 'm1', role: 'assistant' } },
          {
            ...baseEvent,
            type: 'tool.call',
            data: { messageId: 'm1', toolCall: { id: 'call-1a', name: 'read_file', arguments: { path: 'a.txt' } } },
          },
          {
            ...baseEvent,
            type: 'tool.call',
            data: { messageId: 'm1', toolCall: { id: 'call-1b', name: 'read_file', arguments: { path: 'b.txt' } } },
          },
          {
            ...baseEvent,
            type: 'tool.result',
            data: {
              messageId: 'm1',
              toolCallId: 'call-1b',
              result: { success: true, output: 'b', durationMs: 1, truncated: false },
            },
          },
          {
            ...baseEvent,
            type: 'tool.result',
            data: {
              messageId: 'm1',
              toolCallId: 'call-1a',
              result: { success: true, output: 'a', durationMs: 5, truncated: false },
            },
          },
          { ...baseEvent, type: 'message.done', data: { messageId: 'm1' } },
          // Second assistant message with its own tool calls
          { ...baseEvent, type: 'message.start', data: { messageId: 'm2', role: 'assistant' } },
          {
            ...baseEvent,
            type: 'tool.call',
            data: { messageId: 'm2', toolCall: { id: 'call-2a', name: 'read_file', arguments: { path: 'c.txt' } } },
          },
          {
            ...baseEvent,
            type: 'tool.result',
            data: {
              messageId: 'm2',
              toolCallId: 'call-2a',
              result: { success: true, output: 'c', durationMs: 1, truncated: false },
            },
          },
          { ...baseEvent, type: 'message.done', data: { messageId: 'm2' } },
        ]

        const messages = buildContextMessagesFromStoredEvents(events)

        // First assistant + its tools
        expect(messages[0]!.role).toBe('assistant')
        expect(messages[0]!.toolCalls!.map((tc) => tc.id)).toEqual(['call-1a', 'call-1b'])
        expect(messages[1]!.role).toBe('tool')
        expect(messages[1]!.toolCallId).toBe('call-1a')
        expect(messages[2]!.role).toBe('tool')
        expect(messages[2]!.toolCallId).toBe('call-1b')

        // Second assistant + its tools
        expect(messages[3]!.role).toBe('assistant')
        expect(messages[3]!.toolCalls!.map((tc) => tc.id)).toEqual(['call-2a'])
        expect(messages[4]!.role).toBe('tool')
        expect(messages[4]!.toolCallId).toBe('call-2a')
      })

      it('reorderToolMessages handles empty toolCalls gracefully', () => {
        const messages: MessageWithId[] = [{ id: 'm1', role: 'assistant', content: 'no tools' }]
        reorderToolMessages(messages)
        expect(messages).toHaveLength(1)
        expect(messages[0]!.content).toBe('no tools')
      })

      it('reorderToolMessages leaves single tool call unchanged', () => {
        const messages: MessageWithId[] = [
          {
            id: 'm1',
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'call-a', name: 'read_file', arguments: { path: 'a.txt' } }],
          },
          { id: 't1', role: 'tool', content: 'a', toolCallId: 'call-a' },
        ]
        reorderToolMessages(messages)
        expect(messages[1]!.toolCallId).toBe('call-a')
      })

      it('reorderToolMessages skips reordering when toolCallId is unknown', () => {
        const messages: MessageWithId[] = [
          {
            id: 'm1',
            role: 'assistant',
            content: '',
            toolCalls: [
              { id: 'call-a', name: 'read_file', arguments: { path: 'a.txt' } },
              { id: 'call-b', name: 'read_file', arguments: { path: 'b.txt' } },
            ],
          },
          { id: 't1', role: 'tool', content: 'b', toolCallId: 'call-b' },
          { id: 't2', role: 'tool', content: 'a', toolCallId: 'call-a' },
          { id: 't3', role: 'tool', content: 'unknown', toolCallId: 'call-unknown' },
        ]
        reorderToolMessages(messages)
        // Should leave order as-is since call-unknown is not in toolCalls
        expect(messages[1]!.toolCallId).toBe('call-b')
        expect(messages[2]!.toolCallId).toBe('call-a')
        expect(messages[3]!.toolCallId).toBe('call-unknown')
      })
    })

    it('strips orphaned toolCalls from snapshot messages via buildContextMessagesFromEventHistory', () => {
      const events: StoredEvent[] = [
        {
          ...baseEvent,
          seq: 1,
          type: 'turn.snapshot',
          data: {
            mode: 'planner',
            phase: 'plan',
            isRunning: false,
            messages: [
              {
                id: 'msg-1',
                role: 'assistant',
                content: '',
                toolCalls: [
                  {
                    id: 'call-1',
                    name: 'run_command',
                    arguments: { command: 'sleep 10' },
                    // NO result — tool was aborted
                  },
                  {
                    id: 'call-2',
                    name: 'read_file',
                    arguments: { path: 'x.txt' },
                    result: { success: true, output: 'content', durationMs: 100, truncated: false },
                  },
                ],
                timestamp: baseEvent.timestamp,
                contextWindowId: 'window-1',
              },
            ],
            criteria: [],
            contextState: {
              currentTokens: 50,
              maxTokens: 200000,
              compactionCount: 0,
              dangerZone: false,
              canCompact: false,
              dynamicContextChanged: false,
            },
            currentContextWindowId: 'window-1',
            todos: [],
            readFiles: [],
            snapshotSeq: 1,
            snapshotAt: baseEvent.timestamp,
          },
        },
      ]

      const messages = buildContextMessagesFromEventHistory(events, 'window-1')

      // Assistant should only have call-2 (with result), not call-1 (orphaned)
      const assistant = messages.find((m) => m.role === 'assistant')
      expect(assistant!.toolCalls).toHaveLength(1)
      expect(assistant!.toolCalls![0]!.id).toBe('call-2')

      // Tool message for call-2 should be present
      expect(messages.some((m) => m.role === 'tool' && m.toolCallId === 'call-2')).toBe(true)
    })

    it('produces stable message order with and without snapshots when tool result races with injected user message', () => {
      const assistantMsgId = 'assistant-1'
      const reminderMsgId = 'reminder-1'
      const toolCallId = 'call-wt-1'
      const toolResult = {
        success: true,
        output: JSON.stringify({ worktree: '/path/wt', branch: 'hello', message: 'Worktree created' }),
        durationMs: 100,
        truncated: false,
      }

      // Simulates a worktree-creation turn: assistant calls worktree →
      // tool handler injects system-reminder user message → tool result appended
      const baseEvents: StoredEvent[] = [
        {
          ...baseEvent,
          seq: 1,
          type: 'message.start',
          data: { messageId: assistantMsgId, role: 'assistant', content: '', contextWindowId: 'window-1' },
        },
        {
          ...baseEvent,
          seq: 2,
          type: 'tool.call',
          data: {
            messageId: assistantMsgId,
            toolCall: { id: toolCallId, name: 'worktree', arguments: { action: 'create', name: 'hello' } },
          },
        },
        {
          ...baseEvent,
          seq: 3,
          type: 'message.start',
          data: {
            messageId: reminderMsgId,
            role: 'user',
            content: '<system-reminder>\nThis session is now operating in a git worktree.\n</system-reminder>',
            isSystemGenerated: true,
            messageKind: 'auto-prompt',
            contextWindowId: 'window-1',
          },
        },
        {
          ...baseEvent,
          seq: 4,
          type: 'message.done',
          data: { messageId: reminderMsgId },
        },
        {
          ...baseEvent,
          seq: 5,
          type: 'tool.result',
          data: { messageId: assistantMsgId, toolCallId, result: toolResult },
        },
      ]

      // --- Non-snapshot path (fresh session, no prior compaction) ---
      const messagesNoSnapshot = buildContextMessagesFromStoredEvents(baseEvents, 'window-1')

      // --- Snapshot path (session with prior compaction) ---
      const snapshotEvent: StoredEvent = {
        ...baseEvent,
        seq: 1,
        type: 'turn.snapshot',
        data: {
          mode: 'builder',
          phase: 'build',
          isRunning: false,
          messages: [
            {
              id: assistantMsgId,
              role: 'assistant',
              content: '',
              toolCalls: [
                {
                  id: toolCallId,
                  name: 'worktree',
                  arguments: { action: 'create', name: 'hello' },
                  result: toolResult,
                },
              ],
              timestamp: baseEvent.timestamp,
              contextWindowId: 'window-1',
            },
            {
              id: reminderMsgId,
              role: 'user',
              content: '<system-reminder>\nThis session is now operating in a git worktree.\n</system-reminder>',
              isSystemGenerated: true,
              messageKind: 'auto-prompt',
              timestamp: baseEvent.timestamp,
              contextWindowId: 'window-1',
            },
          ],
          criteria: [],
          contextState: {
            currentTokens: 50,
            maxTokens: 200000,
            compactionCount: 1,
            dangerZone: false,
            canCompact: false,
            dynamicContextChanged: false,
          },
          currentContextWindowId: 'window-1',
          todos: [],
          readFiles: [],
          snapshotSeq: 1,
          snapshotAt: baseEvent.timestamp,
        },
      }
      const messagesWithSnapshot = buildContextMessagesFromEventHistory([snapshotEvent], 'window-1')

      // Extract the relative order of the two messages that flip
      const relevantRoles = (msgs: ContextMessage[]) =>
        msgs
          .filter((m) => (m.role === 'user' && m.content.includes('system-reminder')) || m.role === 'tool')
          .map((m) => m.role)

      const orderNoSnapshot = relevantRoles(messagesNoSnapshot)
      const orderWithSnapshot = relevantRoles(messagesWithSnapshot)

      // Both paths must produce the same relative order
      // Currently: no-snapshot = [user, tool], snapshot = [tool, user] — this assertion fails
      expect(orderNoSnapshot).toEqual(orderWithSnapshot)
    })
  })
})
