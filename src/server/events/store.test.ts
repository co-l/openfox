/**
 * EventStore Tests (TDD)
 *
 * These tests define the expected behavior of the EventStore.
 * The EventStore is the single source of truth for session events.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { EventStore, initEventStore } from './store.js'
import type { TurnEvent, StoredEvent } from './types.js'

describe('EventStore', () => {
  let db: Database.Database
  let store: EventStore

  beforeEach(() => {
    // In-memory database for testing
    db = new Database(':memory:')
    store = new EventStore(db)
    // Create sessions table for tests that need it
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        is_running INTEGER DEFAULT 0,
        updated_at INTEGER
      )
    `)
  })

  afterEach(() => {
    db.close()
  })

  // ============================================================================
  // Core append/retrieve
  // ============================================================================

  describe('append', () => {
    it('should append an event and return it with seq and timestamp', () => {
      const event: TurnEvent = {
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
      }

      const stored = store.append('session-1', event)

      expect(stored.seq).toBe(1)
      expect(stored.sessionId).toBe('session-1')
      expect(stored.type).toBe('message.start')
      expect(stored.data).toEqual(event.data)
      expect(stored.timestamp).toBeGreaterThan(0)
    })

    it('should auto-increment seq per session', () => {
      const event1: TurnEvent = {
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
      }
      const event2: TurnEvent = {
        type: 'message.delta',
        data: { messageId: 'msg-1', content: ' world' },
      }

      const stored1 = store.append('session-1', event1)
      const stored2 = store.append('session-1', event2)

      expect(stored1.seq).toBe(1)
      expect(stored2.seq).toBe(2)
    })

    it('should maintain separate seq per session', () => {
      const event: TurnEvent = {
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
      }

      const stored1 = store.append('session-1', event)
      const stored2 = store.append('session-2', event)
      const stored3 = store.append('session-1', event)

      expect(stored1.seq).toBe(1)
      expect(stored2.seq).toBe(1) // Different session, starts at 1
      expect(stored3.seq).toBe(2)
    })
  })

  describe('appendBatch', () => {
    it('should append multiple events atomically', () => {
      const events: TurnEvent[] = [
        { type: 'message.start', data: { messageId: 'msg-1', role: 'user', content: 'Hi' } },
        { type: 'message.delta', data: { messageId: 'msg-1', content: ' there' } },
        { type: 'message.done', data: { messageId: 'msg-1' } },
      ]

      const stored = store.appendBatch('session-1', events)

      expect(stored).toHaveLength(3)
      expect(stored[0]!.seq).toBe(1)
      expect(stored[1]!.seq).toBe(2)
      expect(stored[2]!.seq).toBe(3)
    })

    it('should continue sequence after previous events', () => {
      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-0', role: 'user', content: 'First' },
      })

      const events: TurnEvent[] = [
        { type: 'message.start', data: { messageId: 'msg-1', role: 'assistant' } },
        { type: 'message.delta', data: { messageId: 'msg-1', content: 'Hello' } },
      ]

      const stored = store.appendBatch('session-1', events)

      expect(stored[0]!.seq).toBe(2)
      expect(stored[1]!.seq).toBe(3)
    })
  })

  // ============================================================================
  // Retrieval
  // ============================================================================

  describe('getEvents', () => {
    it('should return all events for a session in order', () => {
      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
      })
      store.append('session-1', {
        type: 'message.delta',
        data: { messageId: 'msg-1', content: ' world' },
      })
      store.append('session-2', {
        type: 'message.start',
        data: { messageId: 'msg-2', role: 'user', content: 'Other session' },
      })

      const events = store.getEvents('session-1')

      expect(events).toHaveLength(2)
      expect(events[0]!.type).toBe('message.start')
      expect(events[1]!.type).toBe('message.delta')
    })

    it('should return events from a specific seq', () => {
      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
      })
      store.append('session-1', {
        type: 'message.delta',
        data: { messageId: 'msg-1', content: ' world' },
      })
      store.append('session-1', {
        type: 'message.done',
        data: { messageId: 'msg-1' },
      })

      const events = store.getEvents('session-1', 2)

      expect(events).toHaveLength(2)
      expect(events[0]!.seq).toBe(2)
      expect(events[1]!.seq).toBe(3)
    })

    it('should return empty array for non-existent session', () => {
      const events = store.getEvents('non-existent')
      expect(events).toHaveLength(0)
    })
  })

  describe('getLatestSeq', () => {
    it('should return the latest seq for a session', () => {
      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
      })
      store.append('session-1', {
        type: 'message.delta',
        data: { messageId: 'msg-1', content: ' world' },
      })

      expect(store.getLatestSeq('session-1')).toBe(2)
    })

    it('should return undefined for non-existent session', () => {
      expect(store.getLatestSeq('non-existent')).toBeUndefined()
    })
  })

  // ============================================================================
  // Snapshots
  // ============================================================================

  describe('getLatestSnapshot', () => {
    it('should return the latest snapshot event', () => {
      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
      })
      store.append('session-1', {
        type: 'turn.snapshot',
        data: {
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          messages: [],
          criteria: [],
          contextState: {
            currentTokens: 0,
            maxTokens: 200000,
            compactionCount: 0,
            dangerZone: false,
            canCompact: false,
          },
          currentContextWindowId: 'window-1',
          todos: [],
          readFiles: [],
          snapshotSeq: 1,
          snapshotAt: Date.now(),
        },
      })
      store.append('session-1', {
        type: 'message.delta',
        data: { messageId: 'msg-1', content: ' world' },
      })
      store.append('session-1', {
        type: 'turn.snapshot',
        data: {
          mode: 'builder',
          phase: 'build',
          isRunning: true,
          messages: [],
          criteria: [],
          contextState: {
            currentTokens: 1000,
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

      const snapshot = store.getLatestSnapshot('session-1')

      expect(snapshot).toBeDefined()
      expect(snapshot!.type).toBe('turn.snapshot')
      expect(snapshot!.data.mode).toBe('builder')
      expect(snapshot!.data.snapshotSeq).toBe(3)
    })

    it('should return undefined if no snapshots exist', () => {
      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
      })

      expect(store.getLatestSnapshot('session-1')).toBeUndefined()
    })
  })

  describe('getEventsSinceSnapshot', () => {
    it('should return snapshot + events since', () => {
      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
      })
      store.append('session-1', {
        type: 'turn.snapshot',
        data: {
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          messages: [],
          criteria: [],
          contextState: {
            currentTokens: 0,
            maxTokens: 200000,
            compactionCount: 0,
            dangerZone: false,
            canCompact: false,
          },
          currentContextWindowId: 'window-1',
          todos: [],
          readFiles: [],
          snapshotSeq: 1,
          snapshotAt: Date.now(),
        },
      })
      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-2', role: 'assistant' },
      })
      store.append('session-1', {
        type: 'message.delta',
        data: { messageId: 'msg-2', content: 'Hi!' },
      })

      const { snapshot, events } = store.getEventsSinceSnapshot('session-1')

      expect(snapshot).toBeDefined()
      expect(snapshot!.mode).toBe('planner')
      expect(events).toHaveLength(2) // Events AFTER snapshot (seq 3, 4)
      expect(events[0]!.type).toBe('message.start')
      expect(events[1]!.type).toBe('message.delta')
    })

    it('should return all events if no snapshot exists', () => {
      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
      })
      store.append('session-1', {
        type: 'message.delta',
        data: { messageId: 'msg-1', content: ' world' },
      })

      const { snapshot, events } = store.getEventsSinceSnapshot('session-1')

      expect(snapshot).toBeUndefined()
      expect(events).toHaveLength(2)
    })
  })

  // ============================================================================
  // Subscriptions (live streaming)
  // ============================================================================

  describe('subscribe', () => {
    it('should receive events as they are appended', async () => {
      const { iterator, unsubscribe } = store.subscribe('session-1')
      const received: StoredEvent[] = []

      // Start collecting events in background
      const collectPromise = (async () => {
        for await (const event of iterator) {
          received.push(event)
          if (received.length >= 2) break
        }
      })()

      // Give the iterator time to set up
      await new Promise((r) => setTimeout(r, 10))

      // Append events
      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
      })
      store.append('session-1', {
        type: 'message.delta',
        data: { messageId: 'msg-1', content: ' world' },
      })

      await collectPromise
      unsubscribe()

      expect(received).toHaveLength(2)
      expect(received[0]!.type).toBe('message.start')
      expect(received[1]!.type).toBe('message.delta')
    })

    it('should only receive events for subscribed session', async () => {
      const { iterator, unsubscribe } = store.subscribe('session-1')
      const received: StoredEvent[] = []

      const collectPromise = (async () => {
        for await (const event of iterator) {
          received.push(event)
          if (received.length >= 1) break
        }
      })()

      await new Promise((r) => setTimeout(r, 10))

      // Append to different session first
      store.append('session-2', {
        type: 'message.start',
        data: { messageId: 'msg-other', role: 'user', content: 'Other' },
      })

      // Then to subscribed session
      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
      })

      await collectPromise
      unsubscribe()

      expect(received).toHaveLength(1)
      expect(received[0]!.sessionId).toBe('session-1')
    })

    it('should support multiple concurrent subscribers', async () => {
      const sub1 = store.subscribe('session-1')
      const sub2 = store.subscribe('session-1')
      const received1: StoredEvent[] = []
      const received2: StoredEvent[] = []

      const collect1 = (async () => {
        for await (const event of sub1.iterator) {
          received1.push(event)
          if (received1.length >= 1) break
        }
      })()

      const collect2 = (async () => {
        for await (const event of sub2.iterator) {
          received2.push(event)
          if (received2.length >= 1) break
        }
      })()

      await new Promise((r) => setTimeout(r, 10))

      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
      })

      await Promise.all([collect1, collect2])
      sub1.unsubscribe()
      sub2.unsubscribe()

      expect(received1).toHaveLength(1)
      expect(received2).toHaveLength(1)
    })

    it('should replay events from a specific seq on subscribe', async () => {
      // Pre-populate events
      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
      })
      store.append('session-1', {
        type: 'message.delta',
        data: { messageId: 'msg-1', content: ' world' },
      })
      store.append('session-1', {
        type: 'message.done',
        data: { messageId: 'msg-1' },
      })

      // Subscribe from seq 2
      const { iterator, unsubscribe } = store.subscribe('session-1', 2)
      const received: StoredEvent[] = []

      const collectPromise = (async () => {
        for await (const event of iterator) {
          received.push(event)
          if (received.length >= 3) break
        }
      })()

      // Add one more event
      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-2', role: 'assistant' },
      })

      await collectPromise
      unsubscribe()

      // Should get seq 2, 3 (replayed) and seq 4 (live)
      expect(received).toHaveLength(3)
      expect(received[0]!.seq).toBe(2)
      expect(received[1]!.seq).toBe(3)
      expect(received[2]!.seq).toBe(4)
    })

    it('should stop iteration when unsubscribed', async () => {
      const { iterator, unsubscribe } = store.subscribe('session-1')
      const received: StoredEvent[] = []

      const collectPromise = (async () => {
        for await (const event of iterator) {
          received.push(event)
        }
      })()

      await new Promise((r) => setTimeout(r, 10))

      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
      })

      // Give it time to receive
      await new Promise((r) => setTimeout(r, 10))

      // Unsubscribe
      unsubscribe()

      // Should complete without hanging
      await collectPromise

      expect(received).toHaveLength(1)
    })
  })

  // ============================================================================
  // Cleanup
  // ============================================================================

  describe('deleteSession', () => {
    it('should delete all events for a session', () => {
      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
      })
      store.append('session-2', {
        type: 'message.start',
        data: { messageId: 'msg-2', role: 'user', content: 'Other' },
      })

      store.deleteSession('session-1')

      expect(store.getEvents('session-1')).toHaveLength(0)
      expect(store.getEvents('session-2')).toHaveLength(1)
    })

    it('should notify subscribers that session is deleted', async () => {
      const { iterator, unsubscribe } = store.subscribe('session-1')
      let completed = false

      const collectPromise = (async () => {
        for await (const _event of iterator) {
          // Should not receive anything
        }
        completed = true
      })()

      await new Promise((r) => setTimeout(r, 10))

      store.deleteSession('session-1')

      await collectPromise
      unsubscribe()

      expect(completed).toBe(true)
    })
  })

  // ============================================================================
  // Edge cases
  // ============================================================================

  describe('edge cases', () => {
    it('should handle empty batch', () => {
      const stored = store.appendBatch('session-1', [])
      expect(stored).toHaveLength(0)
    })

    it('should preserve event data integrity through JSON serialization', () => {
      const complexData = {
        messageId: 'msg-1',
        toolCall: {
          id: 'call-1',
          name: 'read_file',
          arguments: {
            path: '/some/path',
            nested: { key: 'value', num: 42, bool: true, arr: [1, 2, 3] },
          },
        },
      }

      store.append('session-1', { type: 'tool.call', data: complexData })

      const events = store.getEvents('session-1')
      expect(events[0]!.data).toEqual(complexData)
    })
  })
})

describe('initEventStore', () => {
  it('should reset stale running sessions on startup', () => {
    // This simulates a server crash/restart scenario:
    // 1. Server was running, session was in running state
    // 2. Server crashed (no clean shutdown)
    // 3. Server restarts and loads the session - it should reset to not running

    const db = new Database(':memory:')

    // Create sessions table (normally done by db migrations)
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        workdir TEXT NOT NULL
      )
    `)

    // Create a session
    db.prepare(`INSERT INTO sessions (id, project_id, workdir) VALUES (?, ?, ?)`).run(
      'session-1',
      'project-1',
      '/tmp/test',
    )

    // Manually create the EventStore first (simulates first server run)
    const firstStore = new EventStore(db)

    // Simulate: session was running when server crashed
    firstStore.append('session-1', { type: 'running.changed', data: { isRunning: true } })

    // Verify the session shows as running
    const eventsBeforeRestart = firstStore.getEvents('session-1')
    const lastRunningBefore = eventsBeforeRestart.filter((e) => e.type === 'running.changed').pop()
    expect((lastRunningBefore?.data as { isRunning: boolean }).isRunning).toBe(true)

    // Now simulate server restart by calling initEventStore
    // This should detect the stale running state and emit a false event
    const restartedStore = initEventStore(db)

    // Check that a running.changed: false event was emitted
    const eventsAfterRestart = restartedStore.getEvents('session-1')
    const lastRunningAfter = eventsAfterRestart.filter((e) => e.type === 'running.changed').pop()
    expect((lastRunningAfter?.data as { isRunning: boolean }).isRunning).toBe(false)

    // Should have one more event than before
    expect(eventsAfterRestart.length).toBe(eventsBeforeRestart.length + 1)

    db.close()
  })

  it('should not emit reset event for sessions already not running', () => {
    const db = new Database(':memory:')

    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        workdir TEXT NOT NULL
      )
    `)

    db.prepare(`INSERT INTO sessions (id, project_id, workdir) VALUES (?, ?, ?)`).run(
      'session-1',
      'project-1',
      '/tmp/test',
    )

    const firstStore = new EventStore(db)

    // Session was properly stopped (running.changed: false)
    firstStore.append('session-1', { type: 'running.changed', data: { isRunning: true } })
    firstStore.append('session-1', { type: 'running.changed', data: { isRunning: false } })

    const eventsBeforeRestart = firstStore.getEvents('session-1')

    // Restart
    const restartedStore = initEventStore(db)

    // Should NOT have added any new events
    const eventsAfterRestart = restartedStore.getEvents('session-1')
    expect(eventsAfterRestart.length).toBe(eventsBeforeRestart.length)

    db.close()
  })

  it('should handle sessions with no running.changed events', () => {
    const db = new Database(':memory:')

    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        workdir TEXT NOT NULL
      )
    `)

    db.prepare(`INSERT INTO sessions (id, project_id, workdir) VALUES (?, ?, ?)`).run(
      'session-1',
      'project-1',
      '/tmp/test',
    )

    const firstStore = new EventStore(db)

    // Session has some events but no running.changed
    firstStore.append('session-1', { type: 'message.start', data: { messageId: 'msg-1', role: 'user', content: 'hi' } })

    const eventsBeforeRestart = firstStore.getEvents('session-1')

    // Restart
    const restartedStore = initEventStore(db)

    // Should NOT have added any new events
    const eventsAfterRestart = restartedStore.getEvents('session-1')
    expect(eventsAfterRestart.length).toBe(eventsBeforeRestart.length)

    db.close()
  })
})

// ============================================================================
// Event cleanup tests
// ============================================================================

describe('EventStore - Event Cleanup', () => {
  let db: Database.Database
  let store: EventStore

  beforeEach(() => {
    db = new Database(':memory:')
    store = new EventStore(db)
  })

  afterEach(() => {
    db.close()
  })

  describe('deleteEventsUpToSeq', () => {
    it('should delete events up to and including the given seq', () => {
      // Append several events
      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
      })
      store.append('session-1', {
        type: 'message.delta',
        data: { messageId: 'msg-1', content: ' world' },
      })
      store.append('session-1', {
        type: 'message.done',
        data: { messageId: 'msg-1' },
      })
      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-2', role: 'assistant', content: 'Hi' },
      })

      // Delete up to seq 2
      const deletedCount = store.deleteEventsUpToSeq('session-1', 2)
      expect(deletedCount).toBe(2)

      // Remaining events should be seq 3 and 4
      const remaining = store.getEvents('session-1')
      expect(remaining).toHaveLength(2)
      expect(remaining[0]!.seq).toBe(3)
      expect(remaining[1]!.seq).toBe(4)
    })

    it('should delete all events when upToSeq is the latest seq', () => {
      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
      })
      store.append('session-1', {
        type: 'message.done',
        data: { messageId: 'msg-1' },
      })

      const deletedCount = store.deleteEventsUpToSeq('session-1', 2)
      expect(deletedCount).toBe(2)

      const remaining = store.getEvents('session-1')
      expect(remaining).toHaveLength(0)
    })

    it('should return 0 when deleting up to seq 0', () => {
      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
      })

      const deletedCount = store.deleteEventsUpToSeq('session-1', 0)
      expect(deletedCount).toBe(0)

      const remaining = store.getEvents('session-1')
      expect(remaining).toHaveLength(1)
    })

    it('should not affect events from other sessions', () => {
      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
      })
      store.append('session-2', {
        type: 'message.start',
        data: { messageId: 'msg-2', role: 'user', content: 'Hi' },
      })

      store.deleteEventsUpToSeq('session-1', 1)

      const session1Events = store.getEvents('session-1')
      const session2Events = store.getEvents('session-2')

      expect(session1Events).toHaveLength(0)
      expect(session2Events).toHaveLength(1)
    })
  })

  describe('getLatestSnapshotSeq', () => {
    it('should return the seq of the latest snapshot', () => {
      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
      })
      store.append('session-1', {
        type: 'turn.snapshot',
        data: {
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          messages: [],
          criteria: [],
          contextState: {
            currentTokens: 100,
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
      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-2', role: 'assistant', content: 'Hi' },
      })

      const latestSnapshotSeq = store.getLatestSnapshotSeq('session-1')
      expect(latestSnapshotSeq).toBe(2)
    })

    it('should return 0 when no snapshot exists', () => {
      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
      })

      const latestSnapshotSeq = store.getLatestSnapshotSeq('session-1')
      expect(latestSnapshotSeq).toBe(0)
    })

    it('should return the latest snapshot seq when multiple snapshots exist', () => {
      store.append('session-1', {
        type: 'turn.snapshot',
        data: {
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          messages: [],
          criteria: [],
          contextState: {
            currentTokens: 100,
            maxTokens: 200000,
            compactionCount: 0,
            dangerZone: false,
            canCompact: false,
          },
          currentContextWindowId: 'window-1',
          todos: [],
          readFiles: [],
          snapshotSeq: 1,
          snapshotAt: Date.now(),
        },
      })
      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
      })
      store.append('session-1', {
        type: 'turn.snapshot',
        data: {
          mode: 'builder',
          phase: 'build',
          isRunning: false,
          messages: [],
          criteria: [],
          contextState: {
            currentTokens: 200,
            maxTokens: 200000,
            compactionCount: 1,
            dangerZone: false,
            canCompact: false,
          },
          currentContextWindowId: 'window-2',
          todos: [],
          readFiles: [],
          snapshotSeq: 3,
          snapshotAt: Date.now(),
        },
      })

      const latestSnapshotSeq = store.getLatestSnapshotSeq('session-1')
      expect(latestSnapshotSeq).toBe(3)
    })
  })

  describe('cleanup after snapshot', () => {
    it('should keep only snapshot and current window events after cleanup', () => {
      // Simulate a conversation with multiple turns
      store.append('session-1', {
        type: 'session.initialized',
        data: { projectId: 'proj-1', workdir: '/tmp', contextWindowId: 'window-1' },
      })
      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
      })
      store.append('session-1', {
        type: 'message.delta',
        data: { messageId: 'msg-1', content: ' world' },
      })
      store.append('session-1', {
        type: 'message.done',
        data: { messageId: 'msg-1' },
      })
      store.append('session-1', {
        type: 'turn.snapshot',
        data: {
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          messages: [{ id: 'msg-1', role: 'user', content: 'Hello world', timestamp: Date.now() }],
          criteria: [],
          contextState: {
            currentTokens: 100,
            maxTokens: 200000,
            compactionCount: 0,
            dangerZone: false,
            canCompact: false,
          },
          currentContextWindowId: 'window-1',
          todos: [],
          readFiles: [],
          snapshotSeq: 5,
          snapshotAt: Date.now(),
        },
      })
      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-2', role: 'assistant', content: 'Hi' },
      })
      store.append('session-1', {
        type: 'message.done',
        data: { messageId: 'msg-2' },
      })

      // Simulate cleanup: delete events before the snapshot (seq 1-4)
      store.deleteEventsUpToSeq('session-1', 4)

      // Should have snapshot (seq 5) and current window events (seq 6, 7)
      const remaining = store.getEvents('session-1')
      expect(remaining).toHaveLength(3)
      expect(remaining[0]!.type).toBe('turn.snapshot')
      expect(remaining[0]!.seq).toBe(5)
      expect(remaining[1]!.type).toBe('message.start')
      expect(remaining[2]!.type).toBe('message.done')
    })

    it('should not delete when snapshot is the first event', () => {
      store.append('session-1', {
        type: 'turn.snapshot',
        data: {
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          messages: [],
          criteria: [],
          contextState: {
            currentTokens: 100,
            maxTokens: 200000,
            compactionCount: 0,
            dangerZone: false,
            canCompact: false,
          },
          currentContextWindowId: 'window-1',
          todos: [],
          readFiles: [],
          snapshotSeq: 1,
          snapshotAt: Date.now(),
        },
      })
      store.append('session-1', {
        type: 'message.start',
        data: { messageId: 'msg-1', role: 'user', content: 'Hello' },
      })

      // Try to delete events before seq 1 (should delete nothing)
      store.deleteEventsUpToSeq('session-1', 0)

      const remaining = store.getEvents('session-1')
      expect(remaining).toHaveLength(2)
    })
  })

  describe('consolidateSession', () => {
    it('should consolidate orphaned events into a new snapshot', () => {
      const sessionId = 'session-1'

      store.append(sessionId, {
        type: 'session.initialized',
        data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' },
      })
      store.append(sessionId, { type: 'message.start', data: { messageId: 'msg-1', role: 'user', content: 'Hello' } })
      store.append(sessionId, {
        type: 'turn.snapshot',
        data: {
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          messages: [],
          criteria: [],
          contextState: {
            currentTokens: 100,
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
      store.append(sessionId, { type: 'message.start', data: { messageId: 'msg-2', role: 'assistant' } })
      store.append(sessionId, { type: 'message.delta', data: { messageId: 'msg-2', content: 'Hi there' } })

      const eventsBefore = store.getEvents(sessionId)
      expect(eventsBefore).toHaveLength(5)

      const result = store.consolidateSession(sessionId)
      expect(result).not.toBeNull()
      expect(result!.deletedCount).toBe(4) // session.initialized is preserved

      const eventsAfter = store.getEvents(sessionId)
      expect(eventsAfter).toHaveLength(2) // session.initialized + new snapshot
      expect(eventsAfter.find((e) => e.type === 'session.initialized')).toBeDefined()
      expect(eventsAfter.find((e) => e.type === 'turn.snapshot')).toBeDefined()
      const snapshotEvent = eventsAfter.find((e) => e.type === 'turn.snapshot')!
      const snapshotData = snapshotEvent!.data as { messages: { id: string; content: string }[] }
      expect(snapshotData.messages).toHaveLength(2)
      expect(snapshotData.messages[0]!.id).toBe('msg-1')
      expect(snapshotData.messages[1]!.id).toBe('msg-2')
      expect(snapshotData.messages[1]!.content).toBe('Hi there')
    })

    it('should return null when no orphaned events to consolidate', () => {
      const sessionId = 'session-1'

      store.append(sessionId, {
        type: 'session.initialized',
        data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' },
      })
      store.append(sessionId, { type: 'message.start', data: { messageId: 'msg-1', role: 'user', content: 'Hello' } })
      store.append(sessionId, {
        type: 'turn.snapshot',
        data: {
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          messages: [],
          criteria: [],
          contextState: {
            currentTokens: 100,
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

      const result = store.consolidateSession(sessionId)
      expect(result).toBeNull()
    })

    it('should preserve session.initialized event during consolidation', () => {
      const sessionId = 'session-preserve-init'

      store.append(sessionId, {
        type: 'session.initialized',
        data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' },
      })
      store.append(sessionId, { type: 'message.start', data: { messageId: 'msg-1', role: 'user', content: 'Hello' } })
      store.append(sessionId, {
        type: 'turn.snapshot',
        data: {
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          messages: [],
          criteria: [],
          contextState: {
            currentTokens: 100,
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
      store.append(sessionId, { type: 'message.start', data: { messageId: 'msg-2', role: 'assistant' } })

      // Before consolidation: session.initialized exists at seq 1
      const eventsBefore = store.getEvents(sessionId)
      const initBefore = eventsBefore.find((e) => e.type === 'session.initialized')
      expect(initBefore).toBeDefined()

      const result = store.consolidateSession(sessionId)
      expect(result).not.toBeNull()

      // After consolidation: session.initialized should still exist
      const eventsAfter = store.getEvents(sessionId)
      const initAfter = eventsAfter.find((e) => e.type === 'session.initialized')
      expect(initAfter).toBeDefined()
      expect((initAfter!.data as { contextWindowId: string }).contextWindowId).toBe('window-1')
    })
  })

  describe('findOrphanedSessions', () => {
    beforeEach(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          is_running INTEGER DEFAULT 0,
          updated_at INTEGER
        )
      `)
    })

    it('should find sessions with events after latest snapshot', () => {
      const sessionId = 'session-1'
      db.prepare(`INSERT INTO sessions (id, is_running, updated_at) VALUES (?, 0, ?)`).run(
        sessionId,
        Date.now() - 10 * 60 * 1000,
      )

      store.append(sessionId, {
        type: 'session.initialized',
        data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' },
      })
      store.append(sessionId, { type: 'message.start', data: { messageId: 'msg-1', role: 'user', content: 'Hello' } })
      store.append(sessionId, {
        type: 'turn.snapshot',
        data: {
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          messages: [],
          criteria: [],
          contextState: {
            currentTokens: 100,
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
      store.append(sessionId, { type: 'message.start', data: { messageId: 'msg-2', role: 'assistant' } })

      const orphaned = store.findOrphanedSessions()
      expect(orphaned).toContain(sessionId)
    })

    it('should exclude sessions without orphaned events', () => {
      const sessionId = 'session-1'
      db.prepare(`INSERT INTO sessions (id, is_running, updated_at) VALUES (?, 0, ?)`).run(
        sessionId,
        Date.now() - 10 * 60 * 1000,
      )

      store.append(sessionId, {
        type: 'session.initialized',
        data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' },
      })
      store.append(sessionId, { type: 'message.start', data: { messageId: 'msg-1', role: 'user', content: 'Hello' } })
      store.append(sessionId, {
        type: 'turn.snapshot',
        data: {
          mode: 'planner',
          phase: 'plan',
          isRunning: false,
          messages: [],
          criteria: [],
          contextState: {
            currentTokens: 100,
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

      const orphaned = store.findOrphanedSessions()
      expect(orphaned).not.toContain(sessionId)
    })

    it('should exclude currently running sessions', () => {
      const sessionId = 'session-1'
      db.prepare(`INSERT INTO sessions (id, is_running, updated_at) VALUES (?, 1, ?)`).run(
        sessionId,
        Date.now() - 10 * 60 * 1000,
      )

      store.append(sessionId, {
        type: 'session.initialized',
        data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' },
      })
      store.append(sessionId, {
        type: 'turn.snapshot',
        data: {
          mode: 'planner',
          phase: 'plan',
          isRunning: true,
          messages: [],
          criteria: [],
          contextState: {
            currentTokens: 100,
            maxTokens: 200000,
            compactionCount: 0,
            dangerZone: false,
            canCompact: false,
          },
          currentContextWindowId: 'window-1',
          todos: [],
          readFiles: [],
          snapshotSeq: 1,
          snapshotAt: Date.now(),
        },
      })
      store.append(sessionId, { type: 'message.start', data: { messageId: 'msg-1', role: 'user', content: 'Hello' } })

      const orphaned = store.findOrphanedSessions()
      expect(orphaned).not.toContain(sessionId)
    })
  })
})
