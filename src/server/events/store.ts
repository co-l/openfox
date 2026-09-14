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
import { existsSync, statSync, unlinkSync } from 'node:fs'
import type { TurnEvent, StoredEvent, SessionSnapshot, SnapshotMessage } from './types.js'
import { logger } from '../utils/logger.js'
import { foldSessionState, buildSnapshot, trimSnapshotStreamingOutput } from './folding.js'
import { SETTINGS_KEYS } from '../db/settings.js'

// Rollback backups (.pre-de-dup.bak) are held for 10 days after creation, then
// auto-pruned on the next migration invocation (startup auto-run or manual
// script). Long enough to recover from a bad migration, short enough that a
// 1GB+ copy is not left on disk forever.
const SNAPSHOT_BACKUP_RETENTION_MS = 10 * 24 * 60 * 60 * 1000

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
  subscriber: Subscriber | GlobalSubscriber,
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
  id: { sessionId: string } | { wsId: number },
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
  // Parsed latest-snapshot cache per session. Snapshots can be tens of MB of
  // JSON; re-parsing them on every session load (REST, WS, sidebar list) costs
  // hundreds of ms. Invalidated on every write path (append, delete, cleanup).
  // This is a pragmatic stopgap: the real fix is shrinking the 47MB snapshots
  // themselves (compaction refactor, out of scope) — the cache hides the cost
  // without removing it.
  private snapshotCache: Map<string, { stored: StoredEvent; bytes: number }> = new Map()
  private snapshotCacheBytes = 0
  private static readonly SNAPSHOT_CACHE_MAX_ENTRIES = 16
  private static readonly SNAPSHOT_CACHE_MAX_BYTES = 128 * 1024 * 1024
  // Recent user prompts per session (sidebar list). Computed once from the
  // snapshot + message.start events, then served from memory. Bounded — small
  // arrays, but a long-lived server must not accumulate one per listed
  // session; entries are also dropped when their session is written to.
  private promptsCache: Map<string, Array<{ id: string; content: string; timestamp: string }>> = new Map()
  private static readonly PROMPTS_CACHE_MAX_ENTRIES = 64
  // Row cap for the message.start query feeding the prompts cache. Kept above
  // any realistic caller limit so the cached result is not clipped to whatever
  // limit the first caller happened to request.
  private static readonly PROMPTS_QUERY_LIMIT = 100

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

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tombstones (
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        UNIQUE(session_id, seq)
      )
    `)

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tombstones_session_seq 
      ON tombstones(session_id, seq)
    `)
  }

  // --------------------------------------------------------------------------
  // Append
  // --------------------------------------------------------------------------

  /**
   * Append a single event to a session
   */
  append(sessionId: string, event: TurnEvent): StoredEvent {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('Invalid sessionId: must be a non-empty string')
    }
    if (!event || typeof event.type !== 'string' || !event.type) {
      throw new Error('Invalid event: must have a type property')
    }
    if (!event.data || typeof event.data !== 'object') {
      throw new Error('Invalid event: must have data object')
    }

    const timestamp = Date.now()
    const seq = this.getNextSeq(sessionId)
    const payload = JSON.stringify(event.data)

    this.db
      .prepare(
        `INSERT INTO events (session_id, seq, timestamp, event_type, payload)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(sessionId, seq, timestamp, event.type, payload)

    this.invalidateSessionCache(sessionId)

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
       VALUES (?, ?, ?, ?, ?)`,
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

    this.invalidateSessionCache(sessionId)

    // Notify after transaction commits
    for (const stored of results) {
      this.notifySubscribers(sessionId, stored)
    }

    return results
  }

  /**
   * Import events verbatim (used by session import).
   * Preserves original seq and timestamp; rewrites the sessionId.
   * Intended for a fresh session (no existing events for the target id).
   */
  importEvents(sessionId: string, events: StoredEvent[]): StoredEvent[] {
    if (events.length === 0) return []

    const insert = this.db.prepare(
      `INSERT INTO events (session_id, seq, timestamp, event_type, payload)
       VALUES (?, ?, ?, ?, ?)`,
    )

    const transaction = this.db.transaction(() => {
      for (const event of events) {
        insert.run(sessionId, event.seq, event.timestamp, event.type, JSON.stringify(event.data))
      }
    })
    transaction()

    this.invalidateSessionCache(sessionId)

    const stored: StoredEvent[] = events.map((event) => ({ ...event, sessionId }))
    for (const event of stored) {
      this.notifySubscribers(sessionId, event)
    }
    return stored
  }

  private getNextSeq(sessionId: string): number {
    const row = this.db.prepare(`SELECT MAX(seq) as max_seq FROM events WHERE session_id = ?`).get(sessionId) as
      { max_seq: number | null } | undefined

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
        ? `SELECT e.* FROM events e
           LEFT JOIN tombstones t ON e.session_id = t.session_id AND e.seq = t.seq
           WHERE e.session_id = ? AND e.seq >= ? AND t.seq IS NULL
           ORDER BY e.seq`
        : `SELECT e.* FROM events e
           LEFT JOIN tombstones t ON e.session_id = t.session_id AND e.seq = t.seq
           WHERE e.session_id = ? AND t.seq IS NULL
           ORDER BY e.seq`

    const rows =
      fromSeq !== undefined
        ? (this.db.prepare(query).all(sessionId, fromSeq) as EventRow[])
        : (this.db.prepare(query).all(sessionId) as EventRow[])

    return rows.map((row) => this.rowToStoredEvent(row))
  }

  /**
   * Soft-delete (tombstone) events by sequence number.
   * Tombstoned events are hidden from getEvents but remain in the database.
   *
   * @param sessionId - The session ID
   * @param seqs - Array of sequence numbers to tombstone
   * @returns The number of events tombstoned
   */
  tombstoneEvents(sessionId: string, seqs: number[]): number {
    if (seqs.length === 0) return 0

    const timestamp = Date.now()
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO tombstones (session_id, seq, timestamp)
       VALUES (?, ?, ?)`,
    )

    let count = 0
    const transaction = this.db.transaction(() => {
      for (const seq of seqs) {
        const result = insert.run(sessionId, seq, timestamp)
        count += result.changes as number
      }
    })

    transaction()
    return count
  }

  /**
   * Update the payload of an existing event in-place.
   * Used to persist enriched data (e.g., vision fallback descriptions) back to the store.
   */
  updateEventPayload(sessionId: string, seq: number, data: unknown): void {
    this.db
      .prepare(`UPDATE events SET payload = ? WHERE session_id = ? AND seq = ?`)
      .run(JSON.stringify(data), sessionId, seq)
    this.invalidateSessionCache(sessionId)
  }

  /**
   * Get the latest sequence number for a session
   */
  getLatestSeq(sessionId: string): number | undefined {
    const row = this.db.prepare(`SELECT MAX(seq) as max_seq FROM events WHERE session_id = ?`).get(sessionId) as
      { max_seq: number | null } | undefined

    return row?.max_seq ?? undefined
  }

  /**
   * Get the latest snapshot event for a session
   */
  getLatestSnapshot(sessionId: string): StoredEvent<Extract<TurnEvent, { type: 'turn.snapshot' }>> | undefined {
    const cached = this.snapshotCache.get(sessionId)
    if (cached) {
      return cached.stored as StoredEvent<Extract<TurnEvent, { type: 'turn.snapshot' }>>
    }

    const row = this.db
      .prepare(
        `SELECT * FROM events 
         WHERE session_id = ? AND event_type = 'turn.snapshot' 
         ORDER BY seq DESC LIMIT 1`,
      )
      .get(sessionId) as EventRow | undefined

    if (!row) return undefined

    const stored = this.rowToStoredEvent(row) as StoredEvent<Extract<TurnEvent, { type: 'turn.snapshot' }>>
    this.cacheSnapshot(sessionId, stored, row.payload.length)
    return stored
  }

  private cacheSnapshot(sessionId: string, stored: StoredEvent, bytes: number): void {
    const existing = this.snapshotCache.get(sessionId)
    if (existing) {
      this.snapshotCacheBytes -= existing.bytes
    }
    this.snapshotCache.set(sessionId, { stored, bytes })
    this.snapshotCacheBytes += bytes

    while (
      this.snapshotCache.size > EventStore.SNAPSHOT_CACHE_MAX_ENTRIES ||
      this.snapshotCacheBytes > EventStore.SNAPSHOT_CACHE_MAX_BYTES
    ) {
      const oldestKey = this.snapshotCache.keys().next().value
      if (oldestKey === undefined || oldestKey === sessionId) break
      const oldest = this.snapshotCache.get(oldestKey)
      if (oldest) {
        this.snapshotCacheBytes -= oldest.bytes
      }
      this.snapshotCache.delete(oldestKey)
    }
  }

  private invalidateSessionCache(sessionId: string): void {
    const entry = this.snapshotCache.get(sessionId)
    if (entry) {
      this.snapshotCacheBytes -= entry.bytes
      this.snapshotCache.delete(sessionId)
    }
    this.promptsCache.delete(sessionId)
  }

  private clearSnapshotCache(): void {
    this.snapshotCache.clear()
    this.snapshotCacheBytes = 0
    this.promptsCache.clear()
  }

  /**
   * Get the most recent real user prompts for a session, cached in memory.
   * Extracts them from the latest snapshot (when present) plus recent
   * message.start events. Parsing a multi-MB snapshot on every sidebar list
   * call dominated the list endpoint, so the result is memoized per session.
   */
  getRecentUserPrompts(sessionId: string, limit: number): Array<{ id: string; content: string; timestamp: string }> {
    const cached = this.promptsCache.get(sessionId)
    if (cached) {
      return cached.slice(0, limit)
    }

    const isRealUserMessage = (msg: {
      role: string
      isSystemGenerated?: boolean
      messageKind?: string
      subAgentType?: string
    }) => msg.role === 'user' && !msg.isSystemGenerated && !msg.messageKind && !msg.subAgentType

    const promptMap = new Map<string, { id: string; content: string; timestamp: string }>()

    const snapshotEvent = this.getLatestSnapshot(sessionId)
    if (snapshotEvent) {
      const snapshot = snapshotEvent.data as {
        messages: Array<{
          id: string
          role: string
          content: string
          timestamp: number
          isSystemGenerated?: boolean
          messageKind?: string
          subAgentType?: string
        }>
      }
      for (const msg of snapshot.messages) {
        if (isRealUserMessage(msg)) {
          promptMap.set(msg.id, {
            id: msg.id,
            content: msg.content,
            timestamp: new Date(msg.timestamp).toISOString(),
          })
        }
      }
    }

    const rows = this.db
      .prepare(
        `
        SELECT payload, timestamp
        FROM events
        WHERE session_id = ? AND event_type = 'message.start'
          AND json_extract(payload, '$.role') = 'user'
          AND json_extract(payload, '$.isSystemGenerated') IS NULL
          AND json_extract(payload, '$.messageKind') IS NULL
          AND json_extract(payload, '$.subAgentType') IS NULL
        ORDER BY timestamp DESC
        LIMIT ?
      `,
      )
      .all(sessionId, EventStore.PROMPTS_QUERY_LIMIT) as { payload: string; timestamp: number }[]

    for (const row of rows) {
      const message = JSON.parse(row.payload) as { messageId: string; content: string }
      promptMap.set(message.messageId, {
        id: message.messageId,
        content: message.content,
        timestamp: new Date(row.timestamp).toISOString(),
      })
    }

    const prompts = [...promptMap.values()].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )
    this.promptsCache.set(sessionId, prompts)
    if (this.promptsCache.size > EventStore.PROMPTS_CACHE_MAX_ENTRIES) {
      const oldestKey = this.promptsCache.keys().next().value
      if (oldestKey !== undefined) this.promptsCache.delete(oldestKey)
    }
    return prompts.slice(0, limit)
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

  /**
   * Get ALL events for a session, including synthetic events reconstructed
   * from the latest snapshot's messages. This provides a unified view of the
   * full event history even after cleanupOldEvents has deleted raw events.
   *
   * Synthetic events have seq=0 and are reconstructed as message.start +
   * message.done pairs from snapshot messages. Real events since the snapshot
   * keep their original seq numbers.
   */
  getAllEvents(sessionId: string): StoredEvent[] {
    const { snapshot, events } = this.getEventsSinceSnapshot(sessionId)

    if (!snapshot) {
      return events
    }

    // Reconstruct synthetic events from snapshot messages
    const syntheticEvents: StoredEvent[] = []
    for (const msg of snapshot.messages) {
      syntheticEvents.push({
        seq: 0,
        timestamp: msg.timestamp,
        sessionId,
        type: 'message.start',
        data: {
          messageId: msg.id,
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
          ...(msg.contextWindowId !== undefined && { contextWindowId: msg.contextWindowId }),
          ...(msg.isSystemGenerated !== undefined && { isSystemGenerated: msg.isSystemGenerated }),
          ...(msg.messageKind !== undefined && { messageKind: msg.messageKind }),
          ...(msg.metadata !== undefined && { metadata: msg.metadata }),
          ...(msg.subAgentId !== undefined && { subAgentId: msg.subAgentId }),
          ...(msg.subAgentType !== undefined && { subAgentType: msg.subAgentType }),
          ...(msg.isCompactionSummary !== undefined && { isCompactionSummary: msg.isCompactionSummary }),
          ...(msg.attachments !== undefined && { attachments: msg.attachments }),
        },
      })
      syntheticEvents.push({
        seq: 0,
        timestamp: msg.timestamp,
        sessionId,
        type: 'message.done',
        data: { messageId: msg.id },
      })
    }

    // Combine synthetic + real events, sorted by timestamp then seq
    return [...syntheticEvents, ...events].sort((a, b) => {
      const tsDiff = a.timestamp - b.timestamp
      if (tsDiff !== 0) return tsDiff
      return a.seq - b.seq
    })
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
    fromSeq?: number,
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
      const subscribersCopy = Array.from(sessionSubs)
      for (const subscriber of subscribersCopy) {
        if (!subscriber.closed) {
          subscriber.callback(event)
        }
      }
    }

    // Notify global subscribers (receives ALL events)
    const globalSubscribersCopy = Array.from(this.globalSubscribers.values())
    for (const subscriber of globalSubscribersCopy) {
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
    this.invalidateSessionCache(sessionId)

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
    const result = this.db.prepare(`DELETE FROM events WHERE session_id = ? AND seq <= ?`).run(sessionId, upToSeq)
    this.invalidateSessionCache(sessionId)

    return result.changes as number
  }

  /**
   * Delete all events after a given sequence number (exclusive).
   * Retains session.initialized (seq 1) and any events at/below fromSeq.
   * Used when truncating session history.
   *
   * @param sessionId - The session ID
   * @param fromSeq - Events with seq > fromSeq will be deleted
   * @returns The number of events deleted
   */
  deleteEventsAfterSeq(sessionId: string, fromSeq: number): number {
    const result = this.db.prepare(`DELETE FROM events WHERE session_id = ? AND seq > ?`).run(sessionId, fromSeq)
    this.invalidateSessionCache(sessionId)

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
      .prepare(
        `
        DELETE FROM events
        WHERE session_id = ? AND seq > 1 AND seq < ?
        AND event_type NOT IN (
          'criteria.set',
          'criterion.updated',
          'mode.changed',
          'phase.changed',
          'todo.updated',
          'context.state',
          'metadata.set'
        )
      `,
      )
      .run(sessionId, latestSnapshotSeq)

    this.invalidateSessionCache(sessionId)

    return result.changes as number
  }

  /**
   * One-time storage optimization: delete old snapshots across all sessions.
   * Safe to run multiple times (idempotent).
   */
  optimizeStorage(): { deletedSnapshots: number } {
    const deleteResult = this.db
      .prepare(
        `
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
      `,
      )
      .run()

    this.clearSnapshotCache()

    return { deletedSnapshots: deleteResult.changes as number }
  }

  /**
   * Get the latest snapshot sequence number for a session
   * @returns The sequence number of the latest snapshot, or 0 if none
   */
  getLatestSnapshotSeq(sessionId: string): number {
    const row = this.db
      .prepare(
        `
        SELECT seq FROM events 
        WHERE session_id = ? AND event_type = 'turn.snapshot' 
        ORDER BY seq DESC LIMIT 1
      `,
      )
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

      const latestSnapshot = [...events].reverse().find((e) => e.type === 'turn.snapshot')
      const eventsAfterSnapshot = events.filter((e) => e.seq > (latestSnapshot?.seq ?? 0))

      if (eventsAfterSnapshot.length === 0) return null

      const initEvent = events.find((e) => e.type === 'session.initialized')
      const initialWindowId =
        initEvent && typeof initEvent.data === 'object' && 'contextWindowId' in initEvent.data
          ? (initEvent.data as { contextWindowId: string }).contextWindowId
          : 'legacy-window-1'

      const latestSeq = events[events.length - 1]!.seq

      const snapshotMessages =
        latestSnapshot?.data && typeof latestSnapshot.data === 'object' && 'messages' in latestSnapshot.data
          ? (latestSnapshot.data as { messages: SnapshotMessage[] }).messages
          : []

      const foldedState = foldSessionState(events, initialWindowId, 200000, snapshotMessages)
      const newSnapshot = buildSnapshot(foldedState, latestSeq)

      const deleteResult = this.db
        .prepare(
          `
        DELETE FROM events 
        WHERE session_id = ? AND seq <= ?
        AND event_type != 'session.initialized'
      `,
        )
        .run(sessionId, latestSeq)

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
      // FK errors mean the session was deleted - nothing to consolidate
      const errnoError = error as NodeJS.ErrnoException
      const isFkError = errnoError.code === 'SQLITE_CONSTRAINT_FOREIGNKEY'
      if (isFkError || err.message.includes('FOREIGN KEY constraint failed')) {
        logger.debug('Session no longer exists during consolidation', { sessionId })
        return null
      }
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

    const sessions = this.db
      .prepare(
        `
      SELECT id, is_running 
      FROM sessions 
      WHERE is_running = 0 AND updated_at < ?
    `,
      )
      .all(cutoff) as Array<{ id: string; is_running: number }>

    logger.debug('Idle sessions found', { count: sessions.length })

    const orphaned: string[] = []

    for (const session of sessions) {
      const hasSnapshot = this.db
        .prepare(
          `
        SELECT 1 FROM events WHERE session_id = ? AND event_type = 'turn.snapshot' LIMIT 1
      `,
        )
        .get(session.id)

      if (hasSnapshot) {
        const latestSnapshotSeq = this.getLatestSnapshotSeq(session.id)
        const eventsAfter = this.db
          .prepare(
            `
          SELECT 1 FROM events WHERE session_id = ? AND seq > ? LIMIT 1
        `,
          )
          .get(session.id, latestSnapshotSeq)

        if (eventsAfter) {
          orphaned.push(session.id)
        }
      }
    }

    logger.info('Orphaned sessions found', { count: orphaned.length, ids: orphaned })
    return orphaned
  }

  /**
   * Remove an expired rollback backup (`<db>.pre-de-dup.bak`) once it has aged
   * past the retention window. Best-effort: failures are logged at debug level
   * and never abort the caller (startup or manual migration).
   */
  private pruneExpiredRollbackBackup(): void {
    const dbName = this.db.name
    if (!dbName || dbName === ':memory:') return

    const backupPath = `${dbName}.pre-de-dup.bak`
    try {
      if (!existsSync(backupPath)) return
      const ageMs = Date.now() - statSync(backupPath).mtimeMs
      if (ageMs <= SNAPSHOT_BACKUP_RETENTION_MS) return
      unlinkSync(backupPath)
      logger.info('Pruned expired rollback backup', {
        backupPath,
        ageDays: Math.round(ageMs / (24 * 60 * 60 * 1000)),
      })
    } catch (error) {
      logger.debug('Could not prune expired rollback backup', {
        backupPath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Rewrite every persisted snapshot with the snapshot streaming
   * de-duplication applied (see trimSnapshotStreamingOutput). Every finished
   * tool call's streaming output is dropped — it is never read again once the
   * call has a result; only pending (in-flight) calls keep their stream.
   *
   * Safe by construction: before the first rewrite it creates a rollback copy
   * of the database (`<db>.pre-de-dup.bak`, only once) — the migration refuses
   * to rewrite if that backup cannot be created. Expired rollback backups are
   * auto-pruned (10-day retention) at the start of every invocation. Idempotent:
   * after a successful run the maintenance flag is set and subsequent runs are
   * a no-op. Returns a report used for the audit trail.
   */
  async migrateSnapshotStreams(): Promise<{
    skipped: boolean
    backupPath: string | null
    scanned: number
    rewritten: number
    droppedStreams: number
    bytesBefore: number
    bytesAfter: number
    kept: { pending: number; samples: Array<{ sessionId: string; tool: string }> }
  }> {
    // Self-maintenance first: expired rollback backups are cleaned up on every
    // invocation, including runs skipped by the flag below.
    this.pruneExpiredRollbackBackup()

    const flag = this.getMaintenanceFlag()
    if (flag === 'true') {
      return {
        skipped: true,
        backupPath: null,
        scanned: 0,
        rewritten: 0,
        droppedStreams: 0,
        bytesBefore: 0,
        bytesAfter: 0,
        kept: { pending: 0, samples: [] },
      }
    }

    // Rollback guarantee: a consistent snapshot of the DB must exist before
    // any in-place rewrite. In-memory databases (tests) are skipped.
    const dbName = this.db.name
    let backupPath: string | null = null
    if (dbName && dbName !== ':memory:') {
      backupPath = `${dbName}.pre-de-dup.bak`
      try {
        if (!existsSync(backupPath)) {
          logger.info('Creating rollback backup before snapshot stream de-dup', { backupPath })
          await this.db.backup(backupPath)
        }
      } catch (error) {
        logger.error('Aborting snapshot stream de-dup: could not create rollback backup', {
          backupPath,
          error: error instanceof Error ? error.message : String(error),
        })
        return {
          skipped: true,
          backupPath: null,
          scanned: 0,
          rewritten: 0,
          droppedStreams: 0,
          bytesBefore: 0,
          bytesAfter: 0,
          kept: { pending: 0, samples: [] },
        }
      }
    }

    const rows = this.db
      .prepare(`SELECT id, session_id, payload FROM events WHERE event_type = 'turn.snapshot'`)
      .all() as Array<{ id: number; session_id: string; payload: string }>

    const update = this.db.prepare(`UPDATE events SET payload = ? WHERE id = ?`)

    const kept: {
      pending: number
      samples: Array<{ sessionId: string; tool: string }>
    } = { pending: 0, samples: [] }

    let rewritten = 0
    let droppedStreams = 0
    let bytesBefore = 0
    let bytesAfter = 0

    this.db.transaction(() => {
      for (const row of rows) {
        bytesBefore += Buffer.byteLength(row.payload)
        let parsed: SessionSnapshot
        try {
          parsed = JSON.parse(row.payload) as SessionSnapshot
        } catch {
          bytesAfter += Buffer.byteLength(row.payload)
          continue
        }

        // Audit: every retained stream is a pending (in-flight) call — finished
        // calls always drop their stream, which is dead weight in the snapshot.
        let snapshotDropped = 0
        for (const message of parsed.messages ?? []) {
          for (const tc of message.toolCalls ?? []) {
            if (!tc.streamingOutput || tc.streamingOutput.length === 0) continue
            if (tc.result === undefined) {
              kept.pending++
              if (kept.samples.length < 20) {
                kept.samples.push({ sessionId: row.session_id, tool: tc.name })
              }
            } else {
              snapshotDropped++
            }
          }
        }

        if (snapshotDropped === 0) {
          bytesAfter += Buffer.byteLength(row.payload)
          continue
        }

        const { messages, droppedStreams: dropped } = trimSnapshotStreamingOutput(parsed.messages ?? [])
        if (dropped === 0) {
          bytesAfter += Buffer.byteLength(row.payload)
          continue
        }

        const next = { ...parsed, messages }
        const nextPayload = JSON.stringify(next)
        update.run(nextPayload, row.id)
        rewritten++
        droppedStreams += dropped
        bytesAfter += Buffer.byteLength(nextPayload)
      }
    })()

    this.setSettingViaDb(SETTINGS_KEYS.MAINTENANCE_SNAPSHOT_STREAMS_MIGRATED, 'true')
    logger.info('Snapshot stream migration complete', {
      scanned: rows.length,
      rewritten,
      droppedStreams,
      keptPending: kept.pending,
      bytesSaved: bytesBefore - bytesAfter,
    })

    return {
      skipped: false,
      backupPath,
      scanned: rows.length,
      rewritten,
      droppedStreams,
      bytesBefore,
      bytesAfter,
      kept,
    }
  }

  /**
   * Read a maintenance flag from the settings table, tolerating databases
   * without that table (e.g. minimal test fixtures).
   */
  private getMaintenanceFlag(): string | null {
    try {
      const row = this.db
        .prepare(`SELECT value FROM settings WHERE key = ?`)
        .get(SETTINGS_KEYS.MAINTENANCE_SNAPSHOT_STREAMS_MIGRATED) as { value: string } | undefined
      return row?.value ?? null
    } catch {
      return null
    }
  }

  /**
   * Upsert a maintenance flag, tolerating databases without the settings table.
   */
  private setSettingViaDb(key: string, value: string): void {
    try {
      const now = new Date().toISOString()
      this.db
        .prepare(
          `INSERT INTO settings (key, value, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .run(key, value, now)
    } catch {
      // Settings table may not exist in minimal test fixtures
    }
  }

  /**
   * Collapse the WAL into the main database and truncate the file. Safe to
   * call anytime; a no-op when the WAL is empty.
   */
  checkpointWal(): { busy: number; log: number; checkpointed: number } {
    const result = this.db.pragma('wal_checkpoint(TRUNCATE)') as Array<{
      busy: number
      log: number
      checkpointed: number
    }>
    const summary = result[0] ?? { busy: 0, log: 0, checkpointed: 0 }
    logger.debug('WAL checkpoint', summary)
    return summary
  }
}

// ============================================================================
// Singleton instance (will be initialized with the main database)
// ============================================================================

let eventStoreInstance: EventStore | null = null

// Session IDs that were left running when the server stopped (detected at
// startup). Consumed by the opt-in boot auto-continuation (Settings > Advanced).
let staleRunningSessionIds: string[] = []

export function getStaleRunningSessionIds(): string[] {
  return staleRunningSessionIds
}

export function initEventStore(db: Database.Database): EventStore {
  eventStoreInstance = new EventStore(db)

  // Reset stale running states from previous server runs.
  // Sessions cannot actually be running when server starts - any session
  // that shows as running was interrupted (crash, restart, etc.).
  try {
    db.prepare(`UPDATE sessions SET is_running = 0`).run()
  } catch {
    // Column may not exist in test fixtures without full schema
  }
  resetStaleRunningSessions(eventStoreInstance, db)
  rejectStaleConfirmations(eventStoreInstance, db)

  // Optimize storage: remove old snapshots.
  // Idempotent — fast no-op on already-optimized databases.
  const result = eventStoreInstance.optimizeStorage()
  if (result.deletedSnapshots > 0) {
    logger.info('Storage optimized', result)
  }

  // Snapshot stream de-dup, asynchronously (don't block startup). Automatic
  // and safe: the migration itself creates a rollback backup before its first
  // rewrite and is idempotent afterwards (settings-flag guarded). Only legacy
  // snapshots are touched — future snapshots are already lean via the
  // write-side choke point.
  setImmediate(() => {
    void (async () => {
      try {
        const report = await eventStoreInstance!.migrateSnapshotStreams()
        if (!report.skipped) {
          logger.info('Snapshot stream de-dup (auto)', {
            rewritten: report.rewritten,
            droppedStreams: report.droppedStreams,
            bytesSaved: report.bytesBefore - report.bytesAfter,
            backupPath: report.backupPath,
          })
        }
      } catch (error) {
        logger.warn('Snapshot stream de-dup failed at startup', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })()
  })

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

  // Collapse the WAL into the main database in the background. A large WAL
  // (e.g. after a bulk write) forces cold reads to walk it; truncating it
  // after startup keeps first queries fast. No-op when the WAL is empty.
  setImmediate(() => {
    try {
      eventStoreInstance!.checkpointWal()
    } catch (error) {
      logger.debug('WAL checkpoint failed at startup', {
        error: error instanceof Error ? error.message : String(error),
      })
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
  staleRunningSessionIds = []

  for (const { id: sessionId } of sessions) {
    // Get the last running.changed event for this session
    const lastRunningEvent = db
      .prepare(
        `
      SELECT payload FROM events 
      WHERE session_id = ? AND event_type = 'running.changed'
      ORDER BY seq DESC LIMIT 1
    `,
      )
      .get(sessionId) as { payload: string } | undefined

    if (lastRunningEvent) {
      const data = JSON.parse(lastRunningEvent.payload) as { isRunning: boolean }
      if (data.isRunning === true) {
        // This session was left in running state - emit false to reset
        eventStore.append(sessionId, {
          type: 'running.changed',
          data: { isRunning: false },
        })
        resetCount++
        staleRunningSessionIds.push(sessionId)
      }
    }
  }

  if (resetCount > 0) {
    logger.info('EventStore reset stale running sessions', { count: resetCount })
  }
}

/**
 * Reject any unresponded path confirmations that survived a server restart.
 * The agent that created them is gone, so they can never be resolved.
 */
function rejectStaleConfirmations(eventStore: EventStore, db: Database.Database): void {
  const sessions = db.prepare(`SELECT id FROM sessions`).all() as { id: string }[]

  let rejectedCount = 0

  for (const { id: sessionId } of sessions) {
    // Find all path.confirmation_pending events without a matching path.confirmation_responded
    // Using raw SQL aggregation since getEvents wouldn't be efficient for all sessions
    const pendingRows = db
      .prepare(
        `
      SELECT e1.seq, e1.payload FROM events e1
      WHERE e1.session_id = ? 
        AND e1.event_type = 'path.confirmation_pending'
        AND NOT EXISTS (
          SELECT 1 FROM events e2
          WHERE e2.session_id = e1.session_id
            AND e2.event_type = 'path.confirmation_responded'
            AND json_extract(e2.payload, '$.callId') = json_extract(e1.payload, '$.callId')
        )
    `,
      )
      .all(sessionId) as Array<{ seq: number; payload: string }>

    for (const row of pendingRows) {
      try {
        const data = JSON.parse(row.payload) as { callId: string }
        eventStore.append(sessionId, {
          type: 'path.confirmation_responded',
          data: { callId: data.callId, approved: false, alwaysAllow: false },
        })
        rejectedCount++
      } catch {
        // Malformed payload — skip
      }
    }
  }

  if (rejectedCount > 0) {
    logger.info('Rejected stale path confirmations from previous server run', { count: rejectedCount })
  }
}

export function getEventStore(): EventStore {
  if (!eventStoreInstance) {
    throw new Error('EventStore not initialized. Call initEventStore first.')
  }
  return eventStoreInstance
}
