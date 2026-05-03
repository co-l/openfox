/**
 * Test to reproduce the "empty conversation after reload" bug
 *
 * This simulates:
 * 1. User sends a message
 * 2. Turn completes, snapshot is created
 * 3. Old events are cleaned up
 * 4. Page reloads (getSessionState is called)
 * 5. Verify conversation is NOT empty
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { getContextMessages, getCurrentContextWindowId, getSessionState } from './session.js'
import { initEventStore, getEventStore } from './index.js'

describe('Session Reload After Cleanup', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    // Create sessions table
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        workdir TEXT NOT NULL
      )
    `)
    // Initialize the singleton event store
    initEventStore(db)
  })

  afterEach(() => {
    db.close()
  })

  it('should preserve conversation after cleanup and reload', () => {
    const sessionId = 'session-1'
    const eventStore = getEventStore()

    // Step 1: Initialize session
    eventStore.append(sessionId, {
      type: 'session.initialized',
      data: { projectId: 'proj-1', workdir: '/tmp', contextWindowId: 'window-1' },
    })

    // Step 2: User sends "hi"
    eventStore.append(sessionId, {
      type: 'message.start',
      data: { messageId: 'msg-1', role: 'user', content: 'hi' },
    })
    eventStore.append(sessionId, {
      type: 'message.done',
      data: { messageId: 'msg-1' },
    })

    // Step 3: Assistant responds
    eventStore.append(sessionId, {
      type: 'message.start',
      data: { messageId: 'msg-2', role: 'assistant', content: '' },
    })
    eventStore.append(sessionId, {
      type: 'message.delta',
      data: { messageId: 'msg-2', content: 'Hello! How can I help you?' },
    })
    eventStore.append(sessionId, {
      type: 'message.done',
      data: { messageId: 'msg-2' },
    })

    // Step 4: Create snapshot (end of turn)
    const eventsBeforeCleanup = eventStore.getEvents(sessionId)
    const snapshotData: any = {
      mode: 'planner',
      phase: 'plan',
      isRunning: false,
      messages: [
        { id: 'msg-1', role: 'user', content: 'hi', timestamp: Date.now() },
        { id: 'msg-2', role: 'assistant', content: 'Hello! How can I help you?', timestamp: Date.now() },
      ],
      criteria: [],
      contextState: { currentTokens: 50, maxTokens: 200000, compactionCount: 0, dangerZone: false, canCompact: false },
      currentContextWindowId: 'window-1',
      todos: [],
      readFiles: [],
      snapshotSeq: eventsBeforeCleanup.length + 1,
      snapshotAt: Date.now(),
    }

    eventStore.append(sessionId, {
      type: 'turn.snapshot',
      data: snapshotData,
    })

    // Step 5: Clean up old events (simulating what happens after each turn)
    eventStore.cleanupOldEvents(sessionId)

    // Verify events were cleaned up
    const eventsAfterCleanup = eventStore.getEvents(sessionId)
    expect(eventsAfterCleanup.length).toBe(2) // session.initialized + snapshot
    expect(eventsAfterCleanup[0]!.type).toBe('session.initialized')
    expect(eventsAfterCleanup[1]!.type).toBe('turn.snapshot')

    // Step 6: Simulate page reload - call getSessionState
    const state = getSessionState(sessionId)

    // Step 7: Verify conversation is NOT empty
    expect(state).toBeDefined()
    expect(state!.messages).toHaveLength(2)
    expect(state!.messages[0]!.content).toBe('hi')
    expect(state!.messages[1]!.content).toBe('Hello! How can I help you?')
  })

  it('should preserve conversation with tool calls after cleanup and reload', () => {
    const sessionId = 'session-1'
    const eventStore = getEventStore()

    // Initialize
    eventStore.append(sessionId, {
      type: 'session.initialized',
      data: { projectId: 'proj-1', workdir: '/tmp', contextWindowId: 'window-1' },
    })

    // User message
    eventStore.append(sessionId, {
      type: 'message.start',
      data: { messageId: 'msg-1', role: 'user', content: 'Read this file' },
    })
    eventStore.append(sessionId, {
      type: 'message.done',
      data: { messageId: 'msg-1' },
    })

    // Assistant with tool call
    eventStore.append(sessionId, {
      type: 'message.start',
      data: { messageId: 'msg-2', role: 'assistant', content: '' },
    })
    eventStore.append(sessionId, {
      type: 'tool.call',
      data: {
        messageId: 'msg-2',
        toolCall: { id: 'call-1', name: 'read_file', arguments: { path: 'test.txt' } },
      },
    })
    eventStore.append(sessionId, {
      type: 'tool.result',
      data: {
        messageId: 'msg-2',
        toolCallId: 'call-1',
        result: { success: true, output: 'File content here', durationMs: 100, truncated: false },
      },
    })
    eventStore.append(sessionId, {
      type: 'message.done',
      data: { messageId: 'msg-2' },
    })

    // Create snapshot
    const eventsBeforeCleanup = eventStore.getEvents(sessionId)
    const snapshotData: any = {
      mode: 'builder',
      phase: 'build',
      isRunning: false,
      messages: [
        { id: 'msg-1', role: 'user', content: 'Read this file', timestamp: Date.now() },
        {
          id: 'msg-2',
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call-1',
              name: 'read_file',
              arguments: { path: 'test.txt' },
              result: { success: true, output: 'File content here', durationMs: 100, truncated: false },
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
      snapshotSeq: eventsBeforeCleanup.length + 1,
      snapshotAt: Date.now(),
    }

    eventStore.append(sessionId, {
      type: 'turn.snapshot',
      data: snapshotData,
    })

    // Clean up
    eventStore.cleanupOldEvents(sessionId)

    // Simulate reload
    const state = getSessionState(sessionId)

    // Verify conversation with tool calls is preserved
    expect(state).toBeDefined()
    expect(state!.messages).toHaveLength(2)
    expect(state!.messages[0]!.content).toBe('Read this file')
    expect((state!.messages[1] as any).toolCalls).toBeDefined()
    expect((state!.messages[1] as any).toolCalls[0]!.name).toBe('read_file')
    expect((state!.messages[1] as any).toolCalls[0]!.result).toBeDefined()
  })

  it('should handle multiple turns with cleanup and reload', () => {
    const sessionId = 'session-1'
    const eventStore = getEventStore()

    // Initialize
    eventStore.append(sessionId, {
      type: 'session.initialized',
      data: { projectId: 'proj-1', workdir: '/tmp', contextWindowId: 'window-1' },
    })

    // Turn 1
    eventStore.append(sessionId, {
      type: 'message.start',
      data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
    })
    eventStore.append(sessionId, {
      type: 'message.done',
      data: { messageId: 'msg-1' },
    })
    eventStore.append(sessionId, {
      type: 'turn.snapshot',
      data: {
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        messages: [{ id: 'msg-1', role: 'user', content: 'Hello', timestamp: Date.now() }],
        criteria: [],
        contextState: {
          currentTokens: 20,
          maxTokens: 200000,
          compactionCount: 0,
          dangerZone: false,
          canCompact: false,
        },
        currentContextWindowId: 'window-1',
        todos: [],
        readFiles: [],
        snapshotSeq: 3,
        snapshotAt: Date.now(),
      },
    })
    eventStore.cleanupOldEvents(sessionId)

    // Turn 2
    eventStore.append(sessionId, {
      type: 'message.start',
      data: { messageId: 'msg-2', role: 'assistant', content: 'Hi there!' },
    })
    eventStore.append(sessionId, {
      type: 'message.done',
      data: { messageId: 'msg-2' },
    })
    eventStore.append(sessionId, {
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
          currentTokens: 40,
          maxTokens: 200000,
          compactionCount: 1,
          dangerZone: false,
          canCompact: false,
        },
        currentContextWindowId: 'window-1',
        todos: [],
        readFiles: [],
        snapshotSeq: 6,
        snapshotAt: Date.now(),
      },
    })
    eventStore.cleanupOldEvents(sessionId)

    // Simulate reload
    const state = getSessionState(sessionId)

    // Verify all messages are preserved
    expect(state).toBeDefined()
    expect(state!.messages).toHaveLength(2)
    expect(state!.messages[0]!.content).toBe('Hello')
    expect(state!.messages[1]!.content).toBe('Hi there!')
  })

  it('should include messages created after the latest snapshot on reload', () => {
    const sessionId = 'session-1'
    const eventStore = getEventStore()

    eventStore.append(sessionId, {
      type: 'session.initialized',
      data: { projectId: 'proj-1', workdir: '/tmp', contextWindowId: 'window-1' },
    })

    eventStore.append(sessionId, {
      type: 'turn.snapshot',
      data: {
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        messages: [{ id: 'msg-1', role: 'user', content: 'Hello', timestamp: Date.now() }],
        criteria: [],
        contextState: {
          currentTokens: 20,
          maxTokens: 200000,
          compactionCount: 0,
          dangerZone: false,
          canCompact: false,
        },
        currentContextWindowId: 'window-1',
        todos: [],
        readFiles: [],
        snapshotSeq: 2,
        snapshotAt: Date.now(),
      },
    })

    eventStore.append(sessionId, {
      type: 'message.start',
      data: { messageId: 'msg-2', role: 'assistant', content: '' },
    })
    eventStore.append(sessionId, {
      type: 'message.delta',
      data: { messageId: 'msg-2', content: 'New response after snapshot' },
    })
    eventStore.append(sessionId, {
      type: 'message.done',
      data: { messageId: 'msg-2' },
    })

    const state = getSessionState(sessionId)

    expect(state).toBeDefined()
    expect(state!.messages).toHaveLength(2)
    expect(state!.messages[0]!.content).toBe('Hello')
    expect(state!.messages[1]!.content).toBe('New response after snapshot')
  })

  it('should preserve the compacted context window after cleanup and reload', () => {
    const sessionId = 'session-1'
    const eventStore = getEventStore()

    eventStore.append(sessionId, {
      type: 'session.initialized',
      data: { projectId: 'proj-1', workdir: '/tmp', contextWindowId: 'window-1' },
    })

    eventStore.append(sessionId, {
      type: 'message.start',
      data: { messageId: 'old-user', role: 'user', content: 'Old window request', contextWindowId: 'window-1' },
    })
    eventStore.append(sessionId, {
      type: 'message.done',
      data: { messageId: 'old-user' },
    })
    eventStore.append(sessionId, {
      type: 'message.start',
      data: {
        messageId: 'old-assistant',
        role: 'assistant',
        content: 'Old window response',
        contextWindowId: 'window-1',
      },
    })
    eventStore.append(sessionId, {
      type: 'message.done',
      data: { messageId: 'old-assistant' },
    })

    eventStore.append(sessionId, {
      type: 'context.compacted',
      data: {
        closedWindowId: 'window-1',
        beforeTokens: 120,
        afterTokens: 12,
        newWindowId: 'window-2',
        summary: 'Compacted summary',
      },
    })

    eventStore.append(sessionId, {
      type: 'message.start',
      data: { messageId: 'new-user', role: 'user', content: 'Fresh context request', contextWindowId: 'window-2' },
    })
    eventStore.append(sessionId, {
      type: 'message.done',
      data: { messageId: 'new-user' },
    })

    const eventsBeforeCleanup = eventStore.getEvents(sessionId)
    eventStore.append(sessionId, {
      type: 'turn.snapshot',
      data: {
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        messages: [
          {
            id: 'old-user',
            role: 'user',
            content: 'Old window request',
            timestamp: Date.now(),
            contextWindowId: 'window-1',
          },
          {
            id: 'old-assistant',
            role: 'assistant',
            content: 'Old window response',
            timestamp: Date.now(),
            contextWindowId: 'window-1',
          },
          {
            id: 'new-user',
            role: 'user',
            content: 'Fresh context request',
            timestamp: Date.now(),
            contextWindowId: 'window-2',
          },
        ],
        criteria: [],
        contextState: {
          currentTokens: 12,
          maxTokens: 200000,
          compactionCount: 1,
          dangerZone: false,
          canCompact: false,
        },
        currentContextWindowId: 'window-2',
        todos: [],
        readFiles: [],
        snapshotSeq: eventsBeforeCleanup.length + 1,
        snapshotAt: Date.now(),
      },
    })

    eventStore.cleanupOldEvents(sessionId)

    expect(getCurrentContextWindowId(sessionId)).toBe('window-2')
    expect(getContextMessages(sessionId)).toEqual([
      {
        role: 'user',
        content: 'Fresh context request',
      },
    ])
  })
})
