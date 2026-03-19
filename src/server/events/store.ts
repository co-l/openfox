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
import type { TurnEvent, StoredEvent, SessionSnapshot } from './types.js'

// ============================================================================
// Types
// ============================================================================

interface Subscriber {
  sessionId: string
  callback: (event: StoredEvent) => void
  close: () => void // Function to close the iterator
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
// EventStore Implementation
// ============================================================================

export class EventStore {
  private db: Database.Database
  private subscribers: Map<string, Set<Subscriber>> = new Map()

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
    const queue: StoredEvent[] = []
    let resolveNext: ((value: IteratorResult<StoredEvent>) => void) | null = null
    let closed = false

    const closeIterator = () => {
      closed = true
      if (resolveNext) {
        resolveNext({ value: undefined, done: true })
        resolveNext = null
      }
    }

    const subscriber: Subscriber = {
      sessionId,
      callback: (event: StoredEvent) => {
        if (closed) return

        if (resolveNext) {
          resolveNext({ value: event, done: false })
          resolveNext = null
        } else {
          queue.push(event)
        }
      },
      close: closeIterator,
      closed: false,
    }

    // Add to subscribers
    let sessionSubs = this.subscribers.get(sessionId)
    if (!sessionSubs) {
      sessionSubs = new Set()
      this.subscribers.set(sessionId, sessionSubs)
    }
    sessionSubs.add(subscriber)

    // Replay events if fromSeq is provided
    if (fromSeq !== undefined) {
      const replayEvents = this.getEvents(sessionId, fromSeq)
      queue.push(...replayEvents)
    }

    const iterator: AsyncIterableIterator<StoredEvent> = {
      [Symbol.asyncIterator]() {
        return this
      },
      async next(): Promise<IteratorResult<StoredEvent>> {
        if (closed) {
          return { value: undefined, done: true }
        }

        const queued = queue.shift()
        if (queued) {
          return { value: queued, done: false }
        }

        // Wait for next event
        return new Promise((resolve) => {
          resolveNext = resolve
        })
      },
      async return(): Promise<IteratorResult<StoredEvent>> {
        closed = true
        subscriber.closed = true
        return { value: undefined, done: true }
      },
    }

    const unsubscribe = () => {
      subscriber.closed = true
      closeIterator()
      sessionSubs?.delete(subscriber)
    }

    return { iterator, unsubscribe }
  }

  private notifySubscribers(sessionId: string, event: StoredEvent): void {
    const sessionSubs = this.subscribers.get(sessionId)
    if (!sessionSubs) return

    for (const subscriber of sessionSubs) {
      if (!subscriber.closed) {
        subscriber.callback(event)
      }
    }
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
    // Log using console.log since logger may not be initialized yet
    console.log(`[EventStore] Reset ${resetCount} stale running session(s)`)
  }
}

export function getEventStore(): EventStore {
  if (!eventStoreInstance) {
    throw new Error('EventStore not initialized. Call initEventStore first.')
  }
  return eventStoreInstance
}
