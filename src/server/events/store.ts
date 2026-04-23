/**
 * EventStore - Single source of truth for session events
 *
 * Responsibilities:
 * - Persist events to SQLite with per-session sequence numbers
 * - Provide event retrieval and replay
 * - Manage live subscriptions with async iterators
 * - Handle snapshots for efficient session loading
 *
 * Design:
 * - All events are append-only and immutable
 * - Sequence numbers are per-session (1, 2, 3...)
 * - Subscribers receive events in real-time via async iterators
 * - Snapshots enable efficient replay (skip to snapshot, replay from there)
 */

import type Database from 'better-sqlite3'
import type { TurnEvent, StoredEvent, SessionSnapshot, SnapshotMessage } from './types.js'
import { stripPromptContextMessages } from './optimize-storage.js'
import { logger } from '../utils/logger.js'
import { foldSessionState, buildSnapshot } from './folding.js'

// ============================================================================
// Types
// ============================================================================

interface Subscriber {
  sessionId: string
  callback: (event: StoredEvent) => void
  close: () => void // Function to close the iterator
  closed: boolean
}

interface GlobalSubscriber {
  wsId: number // Unique ID for this subscription
  callback: (event: StoredEvent) => void
  close: () => void
  closed: boolean
}

interface EventRow {
  id: number
  session_id: string
  seq: number
  timestamp: number
  event_type: string
  payload: string
}

// ============================================================================
// Async Iterator Helpers
// ============================================================================

function createEventIterator(
  state: SubscriberState,
  subscriber: Subscriber | GlobalSubscriber
): AsyncIterableIterator<StoredEvent> {
  return {
    [Symbol.asyncIterator]() {
      return this
    },
    async next(): Promise<IteratorResult<StoredEvent>> {
      if (state.closed) {
        return { value: undefined, done: true }
      }

      const queued = state.queue.shift()
      if (queued) {
        return { value: queued, done: false }
      }

      return new Promise((resolve) => {
        state.resolveNext = resolve as (value: IteratorResult<StoredEvent>) => void
      })
    },
    async return(): Promise<IteratorResult<StoredEvent>> {
      state.closed = true
      subscriber.closed = true
      return { value: undefined, done: true }
    },
  }
}

function createIteratorState(): {
  closed: boolean
  queue: StoredEvent[]
  resolveNext: ((value: IteratorResult<StoredEvent>) => void) | null
  closeIterator: () => void
} {
  const state = {
    closed: false as boolean,
    queue: [] as StoredEvent[],
    resolveNext: null as ((value: IteratorResult<StoredEvent>) => void) | null,
    closeIterator: () => {
      state.closed = true
      if (state.resolveNext) {
        state.resolveNext({ value: undefined, done: true })
        state.resolveNext = null
      }
    },
  }

  return state
}

type SubscriberState = ReturnType<typeof createIteratorState>

function createSubscriber(
  state: SubscriberState,
  id: { sessionId: string } | { wsId: number }
): Subscriber | GlobalSubscriber {
  return {
    ...id,
    callback: (event: StoredEvent) => {
      if (state.closed) return

      if (state.resolveNext) {
        state.resolveNext({ value: event, done: false })
        state.resolveNext = null
      } else {
        state.queue.push(event)
      }
    },
    close: state.closeIterator,
    closed: false,
  }
}

// ============================================================================
// EventStore Implementation
// ============================================================================

export class EventStore {
  private db: Database.Database
  private subscribers: Map<string, Set<Subscriber>> = new Map()
  private globalSubscribers: Map<number, GlobalSubscriber> = new Map()
  private globalSubscriberIdCounter = 0

  constructor(db: Database.Database) {
    this.db = db
    this.initSchema()
  }

  // --------------------------------------------------------------------------
  // Schema
  // --------------------------------------------------------------------------

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        UNIQUE(session_id, seq)
      )
    `)

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_session_seq 
      ON events(session_id, seq)
    `)

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_session_type 
      ON events(session_id, event_type)
    `)
  }

  // --------------------------------------------------------------------------
  // Append
  // --------------------------------------------------------------------------

  /**
   * Append a single event to a session
   */
  append(sessionId: string, event: TurnEvent): StoredEvent {
    const timestamp = Date.now()
    const seq = this.getNextSeq(sessionId)
    const payload = JSON.stringify(event.data)

    this.db
      .prepare(
        `INSERT INTO events (session_id, seq, timestamp, event_type, payload)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(sessionId, seq, timestamp, event.type, payload)

    const stored: StoredEvent = {
      seq,
      timestamp,
      sessionId,
      type: event.type,
      data: event.data,
    }

    this.notifySubscribers(sessionId, stored)

    return stored
  }

  /**
   * Append multiple events atomically
   */
  appendBatch(sessionId: string, events: TurnEvent[]): StoredEvent[] {
    if (events.length === 0) return []

    const timestamp = Date.now()
    let seq = this.getNextSeq(sessionId)
    const results: StoredEvent[] = []

    const insert = this.db.prepare(
      `INSERT INTO events (session_id, seq, timestamp, event_type, payload)
       VALUES (?, ?, ?, ?, ?)`
    )

    const transaction = this.db.transaction(() => {
      for (const event of events) {
        const payload = JSON.stringify(event.data)
        insert.run(sessionId, seq, timestamp, event.type, payload)

        const stored: StoredEvent = {
          seq,
          timestamp,
          sessionId,
          type: event.type,
          data: event.data,
        }
        results.push(stored)
        seq++
      }
    })

    transaction()

    // Notify after transaction commits
    for (const stored of results) {
      this.notifySubscribers(sessionId, stored)
    }

    return results
  }

  private getNextSeq(sessionId: string): number {
    const row = this.db
      .prepare(`SELECT MAX(seq) as max_seq FROM events WHERE session_id = ?`)
      .get(sessionId) as { max_seq: number | null } | undefined

    return (row?.max_seq ?? 0) + 1
  }

  // --------------------------------------------------------------------------
  // Retrieval
  // --------------------------------------------------------------------------

  /**
   * Get all events for a session, optionally starting from a specific seq
   */
  getEvents(sessionId: string, fromSeq?: number): StoredEvent[] {
    const query =
      fromSeq !== undefined
        ? `SELECT * FROM events WHERE session_id = ? AND seq >= ? ORDER BY seq`
        : `SELECT * FROM events WHERE session_id = ? ORDER BY seq`

    const rows =
      fromSeq !== undefined
        ? (this.db.prepare(query).all(sessionId, fromSeq) as EventRow[])
        : (this.db.prepare(query).all(sessionId) as EventRow[])

    return rows.map((row) => this.rowToStoredEvent(row))
  }

  /**
   * Get the latest sequence number for a session
   */
  getLatestSeq(sessionId: string): number | undefined {
    const row = this.db
      .prepare(`SELECT MAX(seq) as max_seq FROM events WHERE session_id = ?`)
      .get(sessionId) as { max_seq: number | null } | undefined

    return row?.max_seq ?? undefined
  }

  /**
   * Get the latest snapshot event for a session
   */
  getLatestSnapshot(sessionId: string): StoredEvent<Extract<TurnEvent, { type: 'turn.snapshot' }>> | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM events 
         WHERE session_id = ? AND event_type = 'turn.snapshot' 
         ORDER BY seq DESC LIMIT 1`
      )
      .get(sessionId) as EventRow | undefined

    if (!row) return undefined

    return this.rowToStoredEvent(row) as StoredEvent<Extract<TurnEvent, { type: 'turn.snapshot' }>>
  }

  /**
   * Get the latest snapshot and all events since it
   * This is the primary method for loading a session efficiently
   */
  getEventsSinceSnapshot(sessionId: string): { snapshot: SessionSnapshot | undefined; events: StoredEvent[] } {
    const snapshotEvent = this.getLatestSnapshot(sessionId)

    if (!snapshotEvent) {
      // No snapshot, return all events
      return {
        snapshot: undefined,
        events: this.getEvents(sessionId),
      }
    }

    // Get events AFTER the snapshot (seq > snapshotEvent.seq)
    const events = this.getEvents(sessionId, snapshotEvent.seq + 1)

    return {
      snapshot: snapshotEvent.data,
      events,
    }
  }

  private rowToStoredEvent(row: EventRow): StoredEvent {
    return {
      seq: row.seq,
      timestamp: row.timestamp,
      sessionId: row.session_id,
      type: row.event_type as TurnEvent['type'],
      data: JSON.parse(row.payload),
    }
  }

  // --------------------------------------------------------------------------
  // Subscriptions
  // --------------------------------------------------------------------------

  /**
   * Subscribe to events for a session
   * Optionally replay events from a specific seq
   *
   * Returns an async iterator that yields events and an unsubscribe function
   */
  subscribe(
    sessionId: string,
    fromSeq?: number
  ): { iterator: AsyncIterableIterator<StoredEvent>; unsubscribe: () => void } {
    const state = createIteratorState()

    const subscriber = createSubscriber(state, { sessionId }) as Subscriber

    let sessionSubs = this.subscribers.get(sessionId)
    if (!sessionSubs) {
      sessionSubs = new Set()
      this.subscribers.set(sessionId, sessionSubs)
    }
    sessionSubs.add(subscriber)

    if (fromSeq !== undefined) {
      const replayEvents = this.getEvents(sessionId, fromSeq)
      state.queue.push(...replayEvents)
    }

    const unsubscribe = () => {
      subscriber.closed = true
      state.closeIterator()
      sessionSubs?.delete(subscriber)
    }

    return { iterator: createEventIterator(state, subscriber), unsubscribe }
  }

  private notifySubscribers(sessionId: string, event: StoredEvent): void {
    // Notify session-specific subscribers
    const sessionSubs = this.subscribers.get(sessionId)
    if (sessionSubs) {
      for (const subscriber of sessionSubs) {
        if (!subscriber.closed) {
          subscriber.callback(event)
        }
      }
    }

    // Notify global subscribers (receives ALL events)
    for (const subscriber of this.globalSubscribers.values()) {
      if (!subscriber.closed) {
        subscriber.callback(event)
      }
    }
  }

  /**
   * Subscribe to ALL events across ALL sessions.
   * Unlike subscribe() which is session-specific, this receives every event.
   * Used by WebSocket clients to receive real-time updates for all sessions.
   *
   * Returns an async iterator that yields events and an unsubscribe function
   */
  subscribeAll(): { iterator: AsyncIterableIterator<StoredEvent>; unsubscribe: () => void } {
    const state = createIteratorState()
    const wsId = ++this.globalSubscriberIdCounter

    const subscriber = createSubscriber(state, { wsId }) as GlobalSubscriber

    this.globalSubscribers.set(wsId, subscriber)

    const unsubscribe = () => {
      subscriber.closed = true
      state.closeIterator()
      this.globalSubscribers.delete(wsId)
    }

    return { iterator: createEventIterator(state, subscriber), unsubscribe }
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  /**
   * Delete all events for a session
   */
  deleteSession(sessionId: string): void {
    this.db.prepare(`DELETE FROM events WHERE session_id = ?`).run(sessionId)

    // Close all subscribers for this session
    const sessionSubs = this.subscribers.get(sessionId)
    if (sessionSubs) {
      for (const subscriber of sessionSubs) {
        subscriber.closed = true
        subscriber.close() // Resolve any pending next() calls
      }
      this.subscribers.delete(sessionId)
    }
  }

  /**
   * Delete all events up to (and including) a given sequence number.
   * This is used to clean up events that are now contained in a snapshot.
   * 
   * @param sessionId - The session ID
   * @param upToSeq - The sequence number to delete up to (inclusive)
   * @returns The number of events deleted
   */
  deleteEventsUpToSeq(sessionId: string, upToSeq: number): number {
    const result = this.db
      .prepare(`DELETE FROM events WHERE session_id = ? AND seq <= ?`)
      .run(sessionId, upToSeq)

    return result.changes as number
  }

  /**
   * Clean up old events, keeping only:
   * - session.initialized event (seq 1)
   * - All snapshot events
   * - State-changing events (criteria.set, criterion.updated, mode.changed, phase.changed, context.state, etc.)
   * - Events after the latest snapshot (current window)
   * 
   * This is the recommended cleanup method that preserves all snapshots and state.
   * 
   * @param sessionId - The session ID
   * @returns The number of events deleted
   */
  cleanupOldEvents(sessionId: string): number {
    // Get the latest snapshot sequence
    const latestSnapshotSeq = this.getLatestSnapshotSeq(sessionId)
    
    if (latestSnapshotSeq === 0) {
      // No snapshots yet, nothing to clean up
      return 0
    }

    // Delete all events before the latest snapshot, except:
    // - seq 1 (session.initialized)
    // - State-changing events that define session state
    // Old snapshots are also deleted — the latest snapshot is always a
    // superset of all previous ones (messages are cumulative).
    const result = this.db
      .prepare(`
        DELETE FROM events
        WHERE session_id = ? AND seq > 1 AND seq < ?
        AND event_type NOT IN (
          'criteria.set',
          'criterion.updated',
          'mode.changed',
          'phase.changed',
          'todo.updated',
          'context.state'
        )
      `)
      .run(sessionId, latestSnapshotSeq)

    return result.changes as number
  }

  /**
   * One-time storage optimization: delete old snapshots and strip
   * promptContext.messages from remaining snapshots across all sessions.
   * Safe to run multiple times (idempotent).
   */
  optimizeStorage(): { deletedSnapshots: number; strippedSnapshots: number } {
    let deletedSnapshots = 0
    let strippedSnapshots = 0

    // 1. Delete all non-latest snapshots per session
    const deleteResult = this.db
      .prepare(`
        DELETE FROM events
        WHERE event_type = 'turn.snapshot'
        AND id NOT IN (
          SELECT e1.id FROM events e1
          WHERE e1.event_type = 'turn.snapshot'
          AND e1.seq = (
            SELECT MAX(e2.seq) FROM events e2
            WHERE e2.session_id = e1.session_id
            AND e2.event_type = 'turn.snapshot'
          )
        )
      `)
      .run()
    deletedSnapshots = deleteResult.changes as number

    // 2. Strip promptContext.messages from all but the last assistant message
    //    in each remaining snapshot
    const snapshots = this.db
      .prepare(`SELECT id, payload FROM events WHERE event_type = 'turn.snapshot'`)
      .all() as Array<{ id: number; payload: string }>

    const updateStmt = this.db.prepare(`UPDATE events SET payload = ? WHERE id = ?`)

    for (const row of snapshots) {
      const data = JSON.parse(row.payload)
      const messages = data.messages as import('./types.js').SnapshotMessage[]
      if (!messages) continue

      // Find last assistant message with promptContext
      const changed = stripPromptContextMessages(messages)

      if (changed) {
        updateStmt.run(JSON.stringify(data), row.id)
        strippedSnapshots++
      }
    }

    return { deletedSnapshots, strippedSnapshots }
  }

  /**
   * Get the latest snapshot sequence number for a session
   * @returns The sequence number of the latest snapshot, or 0 if none
   */
  getLatestSnapshotSeq(sessionId: string): number {
    const row = this.db
      .prepare(`
        SELECT seq FROM events 
        WHERE session_id = ? AND event_type = 'turn.snapshot' 
        ORDER BY seq DESC LIMIT 1
      `)
      .get(sessionId) as { seq: number } | undefined

    return row?.seq ?? 0
  }

  /**
   * Consolidate orphaned events into a new snapshot and delete raw events.
   * Uses transaction to ensure atomicity.
   * @returns Object with snapshotSeq and deletedCount, or null if no events to consolidate
   */
  consolidateSession(sessionId: string): { snapshotSeq: number; deletedCount: number } | null {
    const transaction = this.db.transaction(() => {
      const events = this.getEvents(sessionId)
      if (events.length === 0) return null

      const latestSnapshot = [...events].reverse().find(e => e.type === 'turn.snapshot')
      const eventsAfterSnapshot = events.filter(e => e.seq > (latestSnapshot?.seq ?? 0))

      if (eventsAfterSnapshot.length === 0) return null

      const initEvent = events.find(e => e.type === 'session.initialized')
      const initialWindowId = initEvent && typeof initEvent.data === 'object' && 'contextWindowId' in initEvent.data
        ? (initEvent.data as { contextWindowId: string }).contextWindowId
        : 'legacy-window-1'

      const latestSeq = events[events.length - 1]!.seq

      const snapshotMessages = latestSnapshot?.data && typeof latestSnapshot.data === 'object' && 'messages' in latestSnapshot.data
        ? (latestSnapshot.data as { messages: SnapshotMessage[] }).messages
        : []

      const foldedState = foldSessionState(events, initialWindowId, 200000, snapshotMessages)
      const newSnapshot = buildSnapshot(foldedState, latestSeq)

      const deleteResult = this.db.prepare(`
        DELETE FROM events 
        WHERE session_id = ? AND seq <= ?
      `).run(sessionId, latestSeq)

      const snapshotEvent = this.append(sessionId, {
        type: 'turn.snapshot',
        data: newSnapshot,
      })

      return {
        snapshotSeq: snapshotEvent.seq,
        deletedCount: deleteResult.changes as number,
      }
    })

    try {
      return transaction()
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      logger.error('Failed to consolidate session', { sessionId, error: err.message, stack: err.stack })
      return null
    }
  }

  /**
   * Find session IDs that have orphaned events (events after latest snapshot)
   * and are not currently running.
   */
  findOrphanedSessions(): string[] {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    logger.debug('Looking for orphaned sessions', { cutoff })

    const sessions = this.db.prepare(`
      SELECT id, is_running 
      FROM sessions 
      WHERE is_running = 0 AND updated_at < ?
    `).all(cutoff) as Array<{ id: string; is_running: number }>

    logger.debug('Idle sessions found', { count: sessions.length })

    const orphaned: string[] = []

    for (const session of sessions) {
      const hasSnapshot = this.db.prepare(`
        SELECT 1 FROM events WHERE session_id = ? AND event_type = 'turn.snapshot' LIMIT 1
      `).get(session.id)

      if (hasSnapshot) {
        const latestSnapshotSeq = this.getLatestSnapshotSeq(session.id)
        const eventsAfter = this.db.prepare(`
          SELECT 1 FROM events WHERE session_id = ? AND seq > ? LIMIT 1
        `).get(session.id, latestSnapshotSeq)

        if (eventsAfter) {
          orphaned.push(session.id)
        }
      }
    }

    logger.info('Orphaned sessions found', { count: orphaned.length, ids: orphaned })
    return orphaned
  }
}

// ============================================================================
// Singleton instance (will be initialized with the main database)
// ============================================================================

let eventStoreInstance: EventStore | null = null

export function initEventStore(db: Database.Database): EventStore {
  eventStoreInstance = new EventStore(db)

  // Reset stale running states from previous server runs.
  // Sessions cannot actually be running when server starts - any session
  // that shows as running was interrupted (crash, restart, etc.).
  resetStaleRunningSessions(eventStoreInstance, db)

  // Optimize storage: remove old snapshots and strip bloated promptContext data.
  // Idempotent — fast no-op on already-optimized databases.
  const result = eventStoreInstance.optimizeStorage()
  if (result.deletedSnapshots > 0 || result.strippedSnapshots > 0) {
    logger.info('Storage optimized', result)
  }

  // Consolidate orphaned sessions asynchronously (don't block startup)
  setImmediate(() => {
    try {
      logger.info('Starting orphaned session consolidation')
      const orphanedSessions = eventStoreInstance!.findOrphanedSessions()
      if (orphanedSessions.length > 0) {
        logger.info('Found orphaned sessions to consolidate', { count: orphanedSessions.length })
        let consolidated = 0
        for (const sessionId of orphanedSessions) {
          const result = eventStoreInstance!.consolidateSession(sessionId)
          if (result) {
            consolidated++
            logger.debug('Consolidated session', { sessionId, deletedCount: result.deletedCount })
          }
        }
        logger.info('Sessions consolidated', { consolidated, total: orphanedSessions.length })
      } else {
        logger.info('No orphaned sessions to consolidate')
      }
    } catch {
      // Ignore errors during startup consolidation - this is best-effort
    }
  })

  return eventStoreInstance
}

/**
 * Find sessions that would fold to isRunning=true and emit running.changed=false
 * to clean up stale running states from server crashes/restarts.
 */
function resetStaleRunningSessions(eventStore: EventStore, db: Database.Database): void {
  // Get all session IDs
  const sessions = db.prepare(`SELECT id FROM sessions`).all() as { id: string }[]

  let resetCount = 0
  for (const { id: sessionId } of sessions) {
    // Get the last running.changed event for this session
    const lastRunningEvent = db.prepare(`
      SELECT payload FROM events 
      WHERE session_id = ? AND event_type = 'running.changed'
      ORDER BY seq DESC LIMIT 1
    `).get(sessionId) as { payload: string } | undefined

    if (lastRunningEvent) {
      const data = JSON.parse(lastRunningEvent.payload) as { isRunning: boolean }
      if (data.isRunning === true) {
        // This session was left in running state - emit false to reset
        eventStore.append(sessionId, {
          type: 'running.changed',
          data: { isRunning: false },
        })
        resetCount++
      }
    }
  }

  if (resetCount > 0) {
    logger.info('EventStore reset stale running sessions', { count: resetCount })
  }
}

export function getEventStore(): EventStore {
  if (!eventStoreInstance) {
    throw new Error('EventStore not initialized. Call initEventStore first.')
  }
  return eventStoreInstance
}
