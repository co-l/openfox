/**
 * Integration test for event cleanup after snapshot creation
 *
 * This test demonstrates the memory optimization:
 * 1. Events are created during a turn
 * 2. Snapshot is created at the end
 * 3. Old events are automatically deleted
 * 4. History is preserved in the snapshot
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { EventStore } from './store.js'

describe('Event Cleanup Integration', () => {
  let db: Database.Database
  let eventStore: EventStore

  beforeEach(() => {
    db = new Database(':memory:')
    // Create the sessions table to satisfy initEventStore
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        workdir TEXT NOT NULL
      )
    `)
    eventStore = new EventStore(db)
  })

  afterEach(() => {
    db.close()
  })

  it('should preserve history in snapshot after event cleanup', () => {
    const sessionId = 'session-1'

    // Step 1: Initialize session
    eventStore.append(sessionId, {
      type: 'session.initialized',
      data: { projectId: 'proj-1', workdir: '/tmp', contextWindowId: 'window-1' },
    })

    // Step 2: Create multiple messages with tool calls (simulating a turn)
    eventStore.append(sessionId, {
      type: 'message.start',
      data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
    })
    eventStore.append(sessionId, {
      type: 'message.delta',
      data: { messageId: 'msg-1', content: ' world' },
    })
    eventStore.append(sessionId, {
      type: 'message.done',
      data: { messageId: 'msg-1' },
    })

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
        result: { success: true, output: 'File content', durationMs: 100, truncated: false },
      },
    })
    eventStore.append(sessionId, {
      type: 'message.done',
      data: { messageId: 'msg-2' },
    })

    // Step 3: Create snapshot with full message history
    const eventsBeforeCleanup = eventStore.getEvents(sessionId)

    // Build snapshot manually (simulating what buildSnapshot does)
    const snapshotData: any = {
      mode: 'planner',
      phase: 'plan',
      isRunning: false,
      messages: [
        { id: 'msg-1', role: 'user', content: 'Hello world', timestamp: Date.now() },
        {
          id: 'msg-2',
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
      snapshotSeq: eventsBeforeCleanup.length + 1,
      snapshotAt: Date.now(),
    }

    eventStore.append(sessionId, {
      type: 'turn.snapshot',
      data: snapshotData,
    })

    const snapshotSeq = eventStore.getLatestSnapshotSeq(sessionId)
    expect(snapshotSeq).toBeGreaterThan(0)

    // Step 4: Clean up old events
    eventStore.cleanupOldEvents(sessionId)

    // Step 5: Verify only session.initialized and snapshot remain
    const eventsAfterCleanup = eventStore.getEvents(sessionId)
    expect(eventsAfterCleanup.length).toBe(2)
    expect(eventsAfterCleanup[0]!.type).toBe('session.initialized')
    expect(eventsAfterCleanup[1]!.type).toBe('turn.snapshot')

    // Step 6: Verify history is accessible from snapshot
    const snapshotEvent = eventsAfterCleanup.find((e) => e.type === 'turn.snapshot')
    expect(snapshotEvent).toBeDefined()
    const snapshot = snapshotEvent!.data as any
    expect(snapshot.messages).toHaveLength(2)
    expect(snapshot.messages[0]!.id).toBe('msg-1')
    expect(snapshot.messages[1]!.id).toBe('msg-2')
    expect(snapshot.messages[1]!.toolCalls).toBeDefined()
    expect(snapshot.messages[1]!.toolCalls[0]!.result).toBeDefined()
  })

  it('should handle multiple turns with incremental cleanup', () => {
    const sessionId = 'session-1'

    // Initialize
    eventStore.append(sessionId, {
      type: 'session.initialized',
      data: { projectId: 'proj-1', workdir: '/tmp', contextWindowId: 'window-1' },
    })

    // Turn 1
    eventStore.append(sessionId, {
      type: 'message.start',
      data: { messageId: 'msg-1', role: 'user', content: 'First message' },
    })
    eventStore.append(sessionId, {
      type: 'message.done',
      data: { messageId: 'msg-1' },
    })

    // Snapshot 1
    eventStore.append(sessionId, {
      type: 'turn.snapshot',
      data: {
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        messages: [{ id: 'msg-1', role: 'user', content: 'First message', timestamp: Date.now() }],
        criteria: [],
        contextState: {
          currentTokens: 50,
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

    // Clean up after turn 1
    eventStore.cleanupOldEvents(sessionId)

    // Turn 2
    eventStore.append(sessionId, {
      type: 'message.start',
      data: { messageId: 'msg-2', role: 'assistant', content: 'Second message' },
    })
    eventStore.append(sessionId, {
      type: 'message.done',
      data: { messageId: 'msg-2' },
    })

    // Snapshot 2
    eventStore.append(sessionId, {
      type: 'turn.snapshot',
      data: {
        mode: 'builder',
        phase: 'build',
        isRunning: false,
        messages: [
          { id: 'msg-1', role: 'user', content: 'First message', timestamp: Date.now() },
          { id: 'msg-2', role: 'assistant', content: 'Second message', timestamp: Date.now() },
        ],
        criteria: [],
        contextState: {
          currentTokens: 100,
          maxTokens: 200000,
          compactionCount: 1,
          dangerZone: false,
          canCompact: false,
        },
        currentContextWindowId: 'window-1',
        todos: [],
        readFiles: [],
        snapshotSeq: 7,
        snapshotAt: Date.now(),
      },
    })

    // Clean up after turn 2
    eventStore.cleanupOldEvents(sessionId)

    // Verify: session.initialized + only the latest snapshot remain
    const events = eventStore.getEvents(sessionId)
    expect(events).toHaveLength(2)
    expect(events[0]!.type).toBe('session.initialized')
    expect(events[1]!.type).toBe('turn.snapshot')

    // Verify both messages are accessible from the latest snapshot
    const latestSnapshot = events[1]!.data as any
    expect(latestSnapshot.messages).toHaveLength(2)
    expect(latestSnapshot.messages[0]!.content).toBe('First message')
    expect(latestSnapshot.messages[1]!.content).toBe('Second message')
  })

  it('should not delete current window events', () => {
    const sessionId = 'session-1'

    // Initialize
    eventStore.append(sessionId, {
      type: 'session.initialized',
      data: { projectId: 'proj-1', workdir: '/tmp', contextWindowId: 'window-1' },
    })

    // Create snapshot
    eventStore.append(sessionId, {
      type: 'turn.snapshot',
      data: {
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        messages: [],
        criteria: [],
        contextState: { currentTokens: 0, maxTokens: 200000, compactionCount: 0, dangerZone: false, canCompact: false },
        currentContextWindowId: 'window-1',
        todos: [],
        readFiles: [],
        snapshotSeq: 1,
        snapshotAt: Date.now(),
      },
    })

    // Create current window events (in-progress turn)
    eventStore.append(sessionId, {
      type: 'message.start',
      data: { messageId: 'msg-1', role: 'user', content: 'Active message', contextWindowId: 'window-1' },
    })
    eventStore.append(sessionId, {
      type: 'message.delta',
      data: { messageId: 'msg-1', content: ' more content' },
    })

    // Clean up (should not delete current window events)
    eventStore.cleanupOldEvents(sessionId)

    // Verify current window events are preserved
    const events = eventStore.getEvents(sessionId)
    expect(events).toHaveLength(4) // session.initialized + snapshot + 2 current window events
    expect(events[0]!.type).toBe('session.initialized')
    expect(events[1]!.type).toBe('turn.snapshot')
    expect(events[2]!.type).toBe('message.start')
    expect(events[3]!.type).toBe('message.delta')
  })
})
