/**
 * EventStore — Conversation-Tree event storage
 *
 * Sessions are stored as TREES of events. Every persisted event is a node
 * (tree_id, event_id, parent_id) inside a tree owned by one or more
 * sessions. A session is (tree_id, cursor_event_id) — its active
 * conversation path. Forks are O(1): a new session row pointing at an
 * existing tree with a different cursor.
 *
 * Write path (append):
 * - Streaming chunks (message.delta / message.thinking / tool.output /
 *   tool.preparing) and queue events are EPHEMERAL: forwarded to live WS
 *   subscribers but never persisted. Chunks merge into an in-memory message
 *   buffer.
 * - user/system message.start is persisted immediately as a single `message`
 *   node (content is known up front).
 * - Assistant messages persist once, at message.done, as a single `message`
 *   node (merged content/thinking/tool calls — WITHOUT results).
 * - tool.result persists as its own node; payloads above the threshold are
 *   externalized to the content-addressed blobs table and hydrated on read.
 * - All other events (lifecycle, context, chat.*, …) persist as nodes.
 * - turn.snapshot is ignored (removed in v3 — trees need no snapshots).
 *
 * Every persisted node becomes the session's new cursor (parent = previous
 * cursor). Branching only happens at message boundaries, which correspond
 * to previously served LLM request boundaries — prefix caches stay coherent.
 *
 * Reads (getEvents) return the session's active path (root → cursor),
 * hydrated. Paths are immutable, so path results are permanently cacheable
 * (bounded LRU).
 *
 * No snapshots, no tombstones, no seq-range GC: structurally incompatible
 * with shared trees and unnecessary in this design. Dead branches are
 * reclaimed by gcDeadBranches (no session cursor references the subtree).
 */

import type Database from 'better-sqlite3'
import type { Attachment } from '../../shared/types.js'
import type { TurnEvent, StoredEvent, ExternalizedContent } from './types.js'
import {
  createMessageBuffer,
  applyBufferEvent,
  finalizeBuffer,
  mergeBufferToMessageEvent,
  buildUserMessageEvent,
  bufferToInflightMessage,
  injectedToInflightMessage,
  resolvePath,
  getTipsOutsidePath,
  getDeadEventIds,
  externalizeText,
  externalizeToolResult,
  isExternalized,
  BLOB_EXTERNALIZE_THRESHOLD,
  MESSAGE_EXTERNALIZE_THRESHOLD,
  type MessageBuffer,
  type TreeEventRow,
  type MessageBufferStart,
} from './tree.js'
import { foldPendingConfirmations } from './fold-state.js'
import { logger } from '../utils/logger.js'

// ============================================================================
// Types
// ============================================================================

interface Subscriber {
  sessionId: string
  callback: (event: StoredEvent) => void
  close: () => void
  closed: boolean
}

interface GlobalSubscriber {
  wsId: number
  callback: (event: StoredEvent) => void
  close: () => void
  closed: boolean
}

/** Raw row as stored in the events table (payload un-parsed). */
interface CachedTreeRow extends TreeEventRow {
  payloadBytes: number
  /** Lazily parsed payload (shared with path caches until invalidated). */
  parsedData?: unknown
}

interface PathCacheEntry {
  events: StoredEvent[]
  bytes: number
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

export interface EventStoreOptions {
  /** Externalize serialized tool results larger than this many bytes (default 256 KB). */
  blobExternalizeThreshold?: number
  /** Externalize serialized message payloads larger than this many bytes (default 1 MB). */
  messageExternalizeThreshold?: number
}

export class EventStore {
  private db: Database.Database
  private blobExternalizeThreshold: number
  private messageExternalizeThreshold: number
  private subscribers: Map<string, Set<Subscriber>> = new Map()
  private globalSubscribers: Map<number, GlobalSubscriber> = new Map()
  private globalSubscriberIdCounter = 0

  // In-flight message buffers (chunks are not persisted — merged at done).
  private buffers: Map<string, Map<string, MessageBuffer>> = new Map()

  // Session cursors. The sessions table is authoritative (durable); the map
  // mirrors it in-process and serves as fallback for test fixtures without a
  // sessions table.
  private cursors: Map<string, string | null> = new Map()

  // Sessions deleted while a turn was still in flight: appends for them become
  // no-ops (no persist, no notify). Without this, a turn aborted after
  // deletion would recreate an orphan tree via the getTreeId fallback and
  // re-broadcast chat events to clients that already got session.deleted.
  private deletedSessions: Set<string> = new Set()

  // Tree row cache: treeId → eventId → raw row. Grows incrementally on
  // append; invalidated on payload update and GC.
  private treeRows: Map<string, Map<string, CachedTreeRow>> = new Map()

  // Path cache: treeId → cursorId → hydrated path. Paths are immutable, so
  // entries stay valid forever; bounded LRU keeps memory under control.
  private pathsCache: Map<string, Map<string, PathCacheEntry>> = new Map()
  private pathsCacheBytes = 0
  private static readonly PATHS_CACHE_MAX_BYTES = 256 * 1024 * 1024

  // Recent user prompts per session (sidebar list) — memoized per session.
  private promptsCache: Map<string, Array<{ id: string; content: string; timestamp: string }>> = new Map()
  private static readonly PROMPTS_CACHE_MAX_ENTRIES = 64

  constructor(db: Database.Database, options?: EventStoreOptions) {
    this.db = db
    this.blobExternalizeThreshold = options?.blobExternalizeThreshold ?? BLOB_EXTERNALIZE_THRESHOLD
    this.messageExternalizeThreshold = options?.messageExternalizeThreshold ?? MESSAGE_EXTERNALIZE_THRESHOLD
    this.initSchema()
  }

  // --------------------------------------------------------------------------
  // Schema
  // --------------------------------------------------------------------------

  private initSchema(): void {
    // Defensive mirror of the db/index.ts migration (tests may create the
    // store on a bare in-memory database). Legacy linear-shaped events
    // tables are dropped — v3 does not carry over pre-v3 history.
    try {
      const cols = this.db.prepare(`PRAGMA table_info(events)`).all() as { name: string }[]
      if (cols.length > 0 && !cols.some((c) => c.name === 'event_id')) {
        this.db.exec(`DROP TABLE events`)
      }
    } catch {
      // No events table yet — fine.
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tree_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        parent_id TEXT,
        seq INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        UNIQUE(tree_id, event_id)
      )
    `)

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_tree_seq ON events(tree_id, seq)
    `)
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_tree_type ON events(tree_id, event_type)
    `)
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_tree_parent ON events(tree_id, parent_id)
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS blobs (
        content_hash TEXT PRIMARY KEY,
        size INTEGER NOT NULL,
        content TEXT NOT NULL
      )
    `)

    this.db.exec(`DROP TABLE IF EXISTS tombstones`)
  }

  // --------------------------------------------------------------------------
  // Tree / cursor resolution
  // --------------------------------------------------------------------------

  /**
   * The tree a session writes into. Resolved from the sessions table
   * (tree_id); falls back to the session's own id (new sessions own their
   * tree; fixtures without a sessions table behave the same).
   */
  getTreeId(sessionId: string): string {
    const row = this.tryGetDbRow(`SELECT tree_id FROM sessions WHERE id = ?`, sessionId) as
      { tree_id: string | null } | undefined
    return row?.tree_id ?? sessionId
  }

  /** The session's active path endpoint (tree node id), or null at root. */
  getCursorEventId(sessionId: string): string | null {
    const row = this.tryGetDbRow(`SELECT cursor_event_id FROM sessions WHERE id = ?`, sessionId) as
      { cursor_event_id: string | null } | undefined
    if (row && row.cursor_event_id) return row.cursor_event_id
    return this.cursors.get(sessionId) ?? null
  }

  // The sessions-table writes go through THIS store's database (not the app
  // singleton) so test fixtures with their own database behave identically.
  private updateDbCursor(sessionId: string, cursorEventId: string | null): void {
    try {
      this.db.prepare(`UPDATE sessions SET cursor_event_id = ? WHERE id = ?`).run(cursorEventId, sessionId)
    } catch {
      // No sessions table (test fixture) — the in-process cursor map covers it.
    }
  }

  private setSessionMessageCountSafe(sessionId: string, count: number): void {
    try {
      this.db.prepare(`UPDATE sessions SET message_count = ? WHERE id = ?`).run(count, sessionId)
    } catch {
      // No sessions table (test fixture).
    }
  }

  private bumpMessageCountSafe(sessionId: string, delta: number): void {
    try {
      this.db.prepare(`UPDATE sessions SET message_count = message_count + ? WHERE id = ?`).run(delta, sessionId)
    } catch {
      // No sessions table (test fixture).
    }
  }

  private tryGetDbRow(sql: string, ...params: unknown[]): unknown {
    try {
      return this.db.prepare(sql).get(...params)
    } catch {
      return undefined
    }
  }

  private tryGetDbRows(sql: string, ...params: unknown[]): unknown[] {
    try {
      return this.db.prepare(sql).all(...params)
    } catch {
      return []
    }
  }

  // --------------------------------------------------------------------------
  // Append (the single write path)
  // --------------------------------------------------------------------------

  /**
   * Ingest one event. Persists durable events as tree nodes (advancing the
   * session's cursor), merges streaming chunks into the in-flight message
   * buffer, and notifies live subscribers. Ephemeral events (chunks, queue)
   * are notified but never persisted.
   */
  append(sessionId: string, event: TurnEvent): StoredEvent {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('Invalid sessionId: must be a non-empty string')
    }
    if (!event || typeof event.type !== 'string' || !event.type) {
      throw new Error('Invalid event: must have a type property')
    }
    if (!event.data || typeof event.data !== 'object') {
      throw new Error('Invalid event: must have a data object')
    }

    if (this.deletedSessions.has(sessionId)) {
      return this.ephemeral(sessionId, Date.now(), event)
    }

    const treeId = this.getTreeId(sessionId)
    const timestamp = Date.now()

    switch (event.type) {
      // Message lifecycle
      case 'message.start': {
        const data = event.data
        if (data.role === 'assistant') {
          // Buffer the in-flight message; persisted at message.done.
          this.ensureBuffer(sessionId, data.messageId, data)
          const stored = this.ephemeral(sessionId, timestamp, event)
          this.notify(sessionId, stored)
          return stored
        }
        // User/system content is known up front. While an assistant turn is
        // in flight, buffer the message so it persists AFTER the merged
        // assistant node at completion — preserving the v1 live order in
        // which an injected message (e.g. a system-reminder during tool
        // execution) follows the turn it interrupted.
        const merged = buildUserMessageEvent(event)
        const inFlight = this.getInFlightBuffer(sessionId)
        if (inFlight) {
          inFlight.injected.push({ message: merged, timestamp })
          const stored = this.ephemeral(sessionId, timestamp, event)
          this.notify(sessionId, stored)
          return stored
        }
        return this.persistNode(sessionId, treeId, merged, data.messageId, timestamp, event)
      }

      case 'message.delta':
      case 'message.thinking':
      case 'tool.call':
      case 'tool.preparing': {
        const messageId = (event.data as { messageId: string }).messageId
        const buffer = this.getBuffer(sessionId, messageId)
        if (buffer) applyBufferEvent(buffer, event)
        const stored = this.ephemeral(sessionId, timestamp, event)
        this.notify(sessionId, stored)
        return stored
      }

      case 'message.done': {
        const buffer = this.takeBuffer(sessionId, event.data.messageId)
        if (buffer) {
          finalizeBuffer(buffer, event)
          const merged = mergeBufferToMessageEvent(buffer, event.data.messageId)
          // Node timestamp = the message START time (v1 parity: UI and stats
          // timestamps). persistNode already forwarded the original done event.
          this.persistNode(sessionId, treeId, merged, event.data.messageId, buffer.startedAt, event)
          // Persist messages injected during the turn after the merged
          // assistant message (v1 live order). Already live-notified on
          // arrival, so no re-notify.
          for (const inj of buffer.injected) {
            this.persistNode(
              sessionId,
              treeId,
              inj.message,
              inj.message.data.messageId,
              inj.timestamp,
              inj.message,
              undefined,
              false,
            )
          }
          // Persist stashed tool results after the merged message (and any
          // injected messages), so path order is message → results (matching
          // what the fold and context builder expect for KV parity). They
          // were already live-notified on arrival, so no re-notify.
          for (const tr of buffer.toolResults) {
            const resultEvent: TurnEvent = {
              type: 'tool.result',
              data: { messageId: event.data.messageId, toolCallId: tr.toolCallId, result: tr.result },
            }
            this.persistNode(
              sessionId,
              treeId,
              resultEvent,
              `tr_${tr.toolCallId}`,
              tr.timestamp,
              resultEvent,
              undefined,
              false,
            )
          }
          return this.ephemeral(sessionId, timestamp, event)
        }
        // No buffer (user/system messages persist on start): still notify the
        // done so the live client view finalizes, exactly like the v1 raw done.
        const stored = this.ephemeral(sessionId, timestamp, event)
        this.notify(sessionId, stored)
        return stored
      }

      // Runtime queue state — owned by the session manager's in-memory queue.
      case 'queue.added':
      case 'queue.drained':
      case 'queue.cancelled': {
        const stored = this.ephemeral(sessionId, timestamp, event)
        this.notify(sessionId, stored)
        return stored
      }

      // Tool results: buffered while their message is in flight (persisted
      // as children of the merged message at message.done); persisted
      // immediately otherwise (externalized when large).
      case 'tool.result': {
        const data = event.data
        const buffer = this.getBuffer(sessionId, data.messageId)
        if (buffer) {
          const existing = buffer.toolResults.find((r) => r.toolCallId === data.toolCallId)
          if (existing) {
            existing.result = data.result
          } else {
            buffer.toolResults.push({ toolCallId: data.toolCallId, result: data.result, timestamp })
          }
          const stored = this.ephemeral(sessionId, timestamp, event)
          this.notify(sessionId, stored)
          return stored
        }
        return this.persistNode(sessionId, treeId, event, `tr_${data.toolCallId}`, timestamp, event)
      }

      // Everything else persists as a tree node.
      default: {
        return this.persistNode(sessionId, treeId, event, undefined, timestamp, event)
      }
    }
  }

  private ephemeral(sessionId: string, timestamp: number, event: TurnEvent): StoredEvent {
    return { seq: 0, timestamp, sessionId, type: event.type, data: event.data }
  }

  /**
   * Persist one event as a tree node: parent = the session's current cursor
   * (or an explicit parent for sibling nodes), then advance the cursor.
   * Externalizes oversized payloads to blobs. Notifies subscribers with the
   * ORIGINAL event (WS protocol parity) and returns the stored record.
   */
  private persistNode(
    sessionId: string,
    treeId: string,
    event: TurnEvent,
    explicitEventId: string | undefined,
    timestamp: number,
    notifyEvent: TurnEvent,
    explicitParent?: string | null,
    notify?: boolean,
  ): StoredEvent {
    const parentCursor = explicitParent !== undefined ? explicitParent : this.getCursorEventId(sessionId)
    const seq = this.nextSeq(treeId)
    const eventId = explicitEventId ?? `evt_${seq}`

    // Externalize oversized payloads (persisted form may carry blob refs;
    // reads hydrate them back to the byte-identical content).
    let payloadData: unknown = event.data
    if (event.type === 'tool.result') {
      const data = event.data as { result: Parameters<typeof externalizeToolResult>[0] }
      if (!isExternalized(data.result)) {
        const ref = externalizeToolResult(data.result, this.blobExternalizeThreshold)
        if (ref) {
          this.storeBlob(ref.blobRef, JSON.stringify(data.result))
          payloadData = { ...data, result: ref }
        }
      }
    } else if (event.type === 'message') {
      const data = event.data as { content: string }
      if (typeof data.content === 'string' && !isExternalized(data.content)) {
        if (JSON.stringify(data).length > this.messageExternalizeThreshold) {
          // The payload is over budget — externalize unconditionally (0
          // threshold); small content with oversized side-fields stays inline.
          const ref = externalizeText(data.content, 0)
          if (ref) {
            this.storeBlob(ref.blobRef, data.content)
            payloadData = { ...data, content: ref }
          }
        }
      }
    }

    const payload = JSON.stringify(payloadData)

    this.db
      .prepare(
        `INSERT INTO events (tree_id, event_id, parent_id, seq, timestamp, event_type, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(treeId, eventId, parentCursor, seq, timestamp, event.type, payload)

    this.cacheRow(treeId, {
      eventId,
      parentId: parentCursor,
      seq,
      timestamp,
      event_type: event.type,
      payload,
      payloadBytes: payload.length,
    })

    // Advance the session's cursor to the new node.
    this.cursors.set(sessionId, eventId)
    this.updateDbCursor(sessionId, eventId)

    // Sidebar counts: only the appending session's path gains a message —
    // fork sessions sharing the tree keep their own (unchanged) paths.
    // Sibling appends (resend) carry an explicit parent and recompute the
    // count absolutely by the caller.
    if (event.type === 'message' && explicitParent === undefined) {
      this.bumpMessageCountSafe(sessionId, 1)
    }

    this.promptsCache.delete(sessionId)

    // Live view: forward the original event (start/done/… mappings in the
    // WS protocol), not the merged node shape. Pass notify=false for nodes
    // whose original event was already live-forwarded (buffered tool
    // results re-persisted at message completion).
    if (notify !== false) {
      const notifyStored: StoredEvent = {
        seq,
        timestamp,
        sessionId,
        type: notifyEvent.type,
        data: notifyEvent.data,
        eventId,
        parentId: parentCursor,
      }
      this.notify(sessionId, notifyStored)
    }

    return {
      seq,
      timestamp,
      sessionId,
      type: event.type,
      // The persisted payload may carry blob refs (externalization) —
      // consumers always read hydrated events via getEvents.
      data: payloadData as TurnEvent['data'],
      eventId,
      parentId: parentCursor,
    }
  }

  private nextSeq(treeId: string): number {
    let maxSeq: number | undefined
    for (const row of this.treeRows.get(treeId)?.values() ?? []) {
      if (row.seq > (maxSeq ?? 0)) maxSeq = row.seq
    }
    if (maxSeq === undefined) {
      const row = this.db.prepare(`SELECT MAX(seq) as max_seq FROM events WHERE tree_id = ?`).get(treeId) as
        { max_seq: number | null } | undefined
      maxSeq = row?.max_seq ?? 0
    }
    return maxSeq + 1
  }

  // --------------------------------------------------------------------------
  // Message buffers
  // --------------------------------------------------------------------------

  private ensureBuffer(sessionId: string, messageId: string, start: MessageBufferStart): void {
    let map = this.buffers.get(sessionId)
    if (!map) {
      map = new Map()
      this.buffers.set(sessionId, map)
    }
    if (!map.has(messageId)) {
      map.set(messageId, createMessageBuffer(start))
    }
  }

  private getBuffer(sessionId: string, messageId: string): MessageBuffer | undefined {
    return this.buffers.get(sessionId)?.get(messageId)
  }

  /** The session's currently streaming buffer (if any). */
  private getInFlightBuffer(sessionId: string): MessageBuffer | undefined {
    const map = this.buffers.get(sessionId)
    if (!map) return undefined
    for (const buffer of map.values()) {
      if (buffer.isStreaming) return buffer
    }
    return undefined
  }

  private takeBuffer(sessionId: string, messageId: string): MessageBuffer | undefined {
    const map = this.buffers.get(sessionId)
    if (!map) return undefined
    const buffer = map.get(messageId)
    map.delete(messageId)
    if (map.size === 0) this.buffers.delete(sessionId)
    return buffer
  }

  /** In-flight (streaming) messages for state sync / reconnect parity. */
  getInflightMessages(sessionId: string): ReturnType<typeof bufferToInflightMessage>[] {
    const map = this.buffers.get(sessionId)
    if (!map) return []
    const result: ReturnType<typeof bufferToInflightMessage>[] = []
    for (const [messageId, buffer] of map) {
      if (!buffer.isStreaming) continue
      result.push(bufferToInflightMessage(buffer, messageId))
      // Injected messages (buffered during the turn) are complete — include
      // them so a reconnecting client's view matches the live one.
      for (const inj of buffer.injected) {
        result.push(injectedToInflightMessage(inj.message, inj.timestamp))
      }
    }
    return result
  }

  // --------------------------------------------------------------------------
  // Retrieval (active paths)
  // --------------------------------------------------------------------------

  /**
   * All events on the session's active path (root → cursor), hydrated.
   * With fromSeq: only path events with seq >= fromSeq (reconnect replay).
   */
  getEvents(sessionId: string, fromSeq?: number): StoredEvent[] {
    const events = this.getPath(sessionId)
    if (fromSeq !== undefined) {
      return events.filter((e) => e.seq >= fromSeq)
    }
    return events
  }

  /** The session's active path (root → cursor) as hydrated StoredEvents. */
  getPath(sessionId: string): StoredEvent[] {
    const treeId = this.getTreeId(sessionId)
    const cursor = this.getCursorEventId(sessionId)
    if (!cursor) return []
    return this.buildPath(treeId, cursor)
  }

  /**
   * Resolve a tree path root→cursor. Reuses the deepest cached prefix and
   * only parses new suffix nodes. Cached results are immutable — evicted
   * only by the byte budget.
   */
  private buildPath(treeId: string, cursorId: string): StoredEvent[] {
    const cached = this.pathsCache.get(treeId)?.get(cursorId)
    if (cached) return cached.events

    const rows = this.ensureTreeRows(treeId)

    // Chain from cursor to root.
    const chain: CachedTreeRow[] = []
    let current: CachedTreeRow | undefined = rows.get(cursorId)
    if (!current) return [] // dangling cursor (GC raced) — empty path
    const seen = new Set<string>()
    while (current) {
      if (seen.has(current.eventId)) break // cycle guard (corrupt data)
      seen.add(current.eventId)
      chain.push(current)
      current = current.parentId ? rows.get(current.parentId) : undefined
    }
    chain.reverse() // root-first

    // Deepest cached prefix (cache entries are full paths — self-contained).
    let base: StoredEvent[] = []
    let startIdx = 0
    for (let i = 0; i < chain.length; i++) {
      const prefix = this.pathsCache.get(treeId)?.get(chain[i]!.eventId)
      if (prefix) {
        base = prefix.events
        startIdx = i + 1
        break
      }
    }

    const suffix = chain.slice(startIdx).map((row) => this.rowToHydratedEvent(treeId, row))
    const events = base.length + suffix.length === 0 ? [] : [...base, ...suffix]

    this.cachePath(treeId, cursorId, events, chain)
    return events
  }

  private cachePath(treeId: string, cursorId: string, events: StoredEvent[], chain: CachedTreeRow[]): void {
    const bytes = chain.reduce((sum, row) => sum + row.payloadBytes, 0)
    const byTree = this.pathsCache.get(treeId) ?? new Map<string, PathCacheEntry>()
    const existing = byTree.get(cursorId)
    if (existing) this.pathsCacheBytes -= existing.bytes
    byTree.set(cursorId, { events, bytes })
    this.pathsCache.set(treeId, byTree)
    this.pathsCacheBytes += bytes

    // Evict oldest entries when over budget.
    while (this.pathsCacheBytes > EventStore.PATHS_CACHE_MAX_BYTES) {
      let evicted = false
      for (const [t, byCursor] of this.pathsCache) {
        const oldest = byCursor.keys().next().value
        if (oldest === undefined) continue
        const entry = byCursor.get(oldest)
        if (entry) this.pathsCacheBytes -= entry.bytes
        byCursor.delete(oldest)
        if (byCursor.size === 0) {
          this.pathsCache.delete(t)
          this.treeRows.delete(t) // rows were only needed to build evicted paths
        }
        evicted = true
        break
      }
      if (!evicted) break
    }
  }

  private ensureTreeRows(treeId: string): Map<string, CachedTreeRow> {
    const existing = this.treeRows.get(treeId)
    if (existing) return existing

    const rows = new Map<string, CachedTreeRow>()
    const raw = this.db
      .prepare(
        `SELECT event_id, parent_id, seq, timestamp, event_type, payload, length(payload) as payload_bytes
         FROM events WHERE tree_id = ?`,
      )
      .all(treeId) as Array<{
      event_id: string
      parent_id: string | null
      seq: number
      timestamp: number
      event_type: string
      payload: string
      payload_bytes: number
    }>

    for (const row of raw) {
      rows.set(row.event_id, {
        eventId: row.event_id,
        parentId: row.parent_id,
        seq: row.seq,
        timestamp: row.timestamp,
        event_type: row.event_type,
        payload: row.payload,
        payloadBytes: row.payload_bytes,
      })
    }
    this.treeRows.set(treeId, rows)
    return rows
  }

  private cacheRow(treeId: string, row: CachedTreeRow): void {
    let rows = this.treeRows.get(treeId)
    if (!rows) {
      rows = new Map()
      this.treeRows.set(treeId, rows)
    }
    rows.set(row.eventId, row)
  }

  private invalidateTree(treeId: string): void {
    const byCursor = this.pathsCache.get(treeId)
    if (byCursor) {
      for (const entry of byCursor.values()) {
        this.pathsCacheBytes -= entry.bytes
      }
      this.pathsCache.delete(treeId)
    }
    this.treeRows.delete(treeId)
  }

  /**
   * Row → hydrated StoredEvent. Blob-referenced payloads (externalized tool
   * results / message content) are resolved transparently; the hydrated
   * data object is cached on the row for reuse.
   */
  private rowToHydratedEvent(treeId: string, row: CachedTreeRow): StoredEvent {
    if (row.parsedData === undefined) {
      try {
        row.parsedData = JSON.parse(row.payload)
      } catch {
        row.parsedData = {}
      }
    }
    let data: unknown = row.parsedData

    if (row.event_type === 'tool.result') {
      const d = data as { result?: unknown }
      if (isExternalized(d.result)) {
        const blob = this.loadBlob(d.result.blobRef)
        data = {
          ...d,
          result: blob !== null ? (safeJsonParse(blob) ?? { success: false, error: 'Blob content unavailable' }) : null,
        }
      }
    } else if (row.event_type === 'message') {
      const d = data as { content?: unknown }
      if (isExternalized(d.content)) {
        const blob = this.loadBlob(d.content.blobRef)
        data = { ...d, content: blob ?? (d.content as ExternalizedContent).preview }
      }
    }

    return {
      seq: row.seq,
      timestamp: row.timestamp,
      sessionId: treeId,
      type: row.event_type as TurnEvent['type'],
      data: data as TurnEvent['data'],
      eventId: row.eventId,
      parentId: row.parentId,
    }
  }

  // --------------------------------------------------------------------------
  // Blobs
  // --------------------------------------------------------------------------

  private storeBlob(contentHash: string, content: string): void {
    this.db
      .prepare(`INSERT OR IGNORE INTO blobs (content_hash, size, content) VALUES (?, ?, ?)`)
      .run(contentHash, Buffer.byteLength(content, 'utf8'), content)
  }

  private loadBlob(contentHash: string): string | null {
    const row = this.db.prepare(`SELECT content FROM blobs WHERE content_hash = ?`).get(contentHash) as
      { content: string } | undefined
    return row?.content ?? null
  }

  /**
   * Delete blobs no longer referenced by ANY event row. Candidate refs are
   * harvested from payloads that mention a blobRef; only unreferenced ones
   * (from the given deleted set) are removed.
   */
  private deleteUnreferencedBlobs(deletedRefs: string[]): number {
    if (deletedRefs.length === 0) return 0
    const candidates = this.db.prepare(`SELECT payload FROM events WHERE payload LIKE '%"blobRef"%'`).all() as {
      payload: string
    }[]
    const referenced = new Set<string>()
    for (const { payload } of candidates) {
      for (const ref of extractBlobRefs(payload)) {
        referenced.add(ref)
      }
    }
    let deleted = 0
    const del = this.db.prepare(`DELETE FROM blobs WHERE content_hash = ?`)
    for (const ref of deletedRefs) {
      if (referenced.has(ref)) continue
      deleted += del.run(ref).changes
    }
    return deleted
  }

  // --------------------------------------------------------------------------
  // Cursor operations (branch / rewind / resend / fork)
  // --------------------------------------------------------------------------

  /**
   * Move the session's cursor to an existing message node (branch switch /
   * rewind). Only message boundaries are legal branch points.
   */
  setCursor(sessionId: string, eventId: string): void {
    const treeId = this.getTreeId(sessionId)
    const row = this.ensureTreeRows(treeId).get(eventId)
    if (!row) {
      throw new Error(`Event ${eventId} not found in conversation tree`)
    }
    if (row.event_type !== 'message') {
      throw new Error('Can only switch conversation branches at message boundaries')
    }
    this.cursors.set(sessionId, eventId)
    this.updateDbCursor(sessionId, eventId)
    const count = this.getPath(sessionId).filter((e) => e.type === 'message').length
    this.setSessionMessageCountSafe(sessionId, count)
    this.promptsCache.delete(sessionId)
  }

  /**
   * Restore the cursor to an exact imported node. Unlike setCursor (branch
   * switch), the node may be of any type — append always advances the cursor,
   * so a source session's cursor may point past the last message.
   */
  restoreCursor(sessionId: string, eventId: string): void {
    const treeId = this.getTreeId(sessionId)
    const row = this.ensureTreeRows(treeId).get(eventId)
    if (!row) {
      throw new Error(`Event ${eventId} not found in conversation tree`)
    }
    this.cursors.set(sessionId, eventId)
    this.updateDbCursor(sessionId, eventId)
    const count = this.getPath(sessionId).filter((e) => e.type === 'message').length
    this.setSessionMessageCountSafe(sessionId, count)
    this.promptsCache.delete(sessionId)
  }

  /** Find a `message` node by its message id (== event id) in a tree. */
  findMessageEvent(treeId: string, messageId: string): CachedTreeRow | undefined {
    const row = this.ensureTreeRows(treeId).get(messageId)
    if (!row || row.event_type !== 'message') return undefined
    return row
  }

  /**
   * Edit & resend: persist a SIBLING message node (same parent, fresh id,
   * new/edited content) and move the session's cursor to it. Non-destructive
   * — the original branch stays switchable.
   */
  resendMessage(
    sessionId: string,
    messageId: string,
    options: { content?: string; attachments?: Attachment[] } = {},
  ): string {
    const treeId = this.getTreeId(sessionId)
    const row = this.findMessageEvent(treeId, messageId)
    if (!row) {
      throw new Error(`Message ${messageId} not found`)
    }
    let data = this.parseRowData(row) as Extract<TurnEvent, { type: 'message' }>['data'] | undefined
    if (!data) throw new Error(`Message ${messageId} has no payload`)
    if (data.role !== 'user' || data.isSystemGenerated || data.isCompactionSummary) {
      throw new Error('Only plain user messages can be resent')
    }
    // Externalized content must be hydrated before it can be resent.
    if (isExternalized(data.content)) {
      const blob = this.loadBlob(data.content.blobRef)
      data = { ...data, content: blob ?? data.content.preview }
    }

    const siblingId = crypto.randomUUID()
    const content = options.content ?? data.content
    const attachments = options.attachments ?? (data.attachments as Attachment[] | undefined)
    const siblingData: Extract<TurnEvent, { type: 'message' }>['data'] = {
      messageId: siblingId,
      role: 'user',
      content,
      ...(data.contextWindowId !== undefined ? { contextWindowId: data.contextWindowId } : {}),
      ...(attachments !== undefined ? { attachments } : {}),
      ...(data.messageKind !== undefined ? { messageKind: data.messageKind } : {}),
      ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
    }

    // The sibling is a CHILD OF THE ORIGINAL MESSAGE (same parent) — not of
    // the current cursor, which may sit deep in an abandoned descendant.
    this.persistNode(
      sessionId,
      treeId,
      { type: 'message', data: siblingData },
      siblingId,
      Date.now(),
      {
        type: 'message.start',
        data: {
          messageId: siblingId,
          role: 'user',
          content,
          ...(data.contextWindowId !== undefined ? { contextWindowId: data.contextWindowId } : {}),
          ...(attachments !== undefined ? { attachments } : {}),
          ...(data.messageKind !== undefined ? { messageKind: data.messageKind } : {}),
          ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
        },
      },
      row.parentId,
    )

    // persistNode already advanced the cursor to the sibling; recompute the
    // message count for the (moved) path.
    const count = this.getPath(sessionId).filter((e) => e.type === 'message').length
    this.setSessionMessageCountSafe(sessionId, count)

    return siblingId
  }

  /**
   * Branch tips for the branch switcher: leaves outside the session's active
   * path, each normalized up to its nearest message ancestor (branch
   * switching only accepts message boundaries, and lifecycle nodes trail
   * behind replies). Duplicate boundaries are collapsed.
   */
  getBranchTips(
    sessionId: string,
  ): Array<{ eventId: string; timestamp: number; type: string; preview?: string; role?: string }> {
    const treeId = this.getTreeId(sessionId)
    const rows = this.ensureTreeRows(treeId) as unknown as Map<string, TreeEventRow>
    const cursor = this.getCursorEventId(sessionId)
    const path = cursor ? resolvePath(rows, cursor) : []
    const onPath = new Set(path.map((row) => row.eventId))
    const leaves = getTipsOutsidePath(rows, path)

    const tips: Array<{ eventId: string; timestamp: number; type: string; preview?: string; role?: string }> = []
    const seen = new Set<string>()
    for (const leaf of leaves) {
      // Walk up to the nearest message boundary outside the active path.
      let current: TreeEventRow | undefined = leaf
      while (current && current.event_type !== 'message' && !onPath.has(current.eventId)) {
        current = current.parentId ? rows.get(current.parentId) : undefined
      }
      if (!current || current.event_type !== 'message' || onPath.has(current.eventId)) continue
      if (seen.has(current.eventId)) continue
      seen.add(current.eventId)
      const boundary = current

      const out: { eventId: string; timestamp: number; type: string; preview?: string; role?: string } = {
        eventId: boundary.eventId,
        timestamp: boundary.timestamp,
        type: boundary.event_type,
      }
      const d = this.parseRowData(boundary as unknown as CachedTreeRow) as { content?: string; role?: string } | null
      if (d) {
        const content = isExternalized(d.content) ? (d.content as ExternalizedContent).preview : d.content
        if (content) out.preview = content.slice(0, 120)
        if (d.role) out.role = d.role
      }
      tips.push(out)
    }
    return tips
  }

  /** Full tree structure for the conversation-tree endpoint. */
  getConversationTree(sessionId: string): {
    treeId: string
    cursor: string | null
    tips: string[]
    nodes: Array<{
      eventId: string
      parentId: string | null
      seq: number
      timestamp: number
      type: string
      messageId?: string
      role?: string
      preview?: string
    }>
  } {
    const treeId = this.getTreeId(sessionId)
    const rows = this.ensureTreeRows(treeId)
    const cursor = this.getCursorEventId(sessionId)
    const path = cursor ? resolvePath(rows as unknown as Map<string, TreeEventRow>, cursor) : []
    const tips = getTipsOutsidePath(rows as unknown as Map<string, TreeEventRow>, path)

    const nodes: Array<{
      eventId: string
      parentId: string | null
      seq: number
      timestamp: number
      type: string
      messageId?: string
      role?: string
      preview?: string
    }> = []
    for (const row of rows.values()) {
      const node: (typeof nodes)[number] = {
        eventId: row.eventId,
        parentId: row.parentId,
        seq: row.seq,
        timestamp: row.timestamp,
        type: row.event_type,
      }
      if (row.event_type === 'message') {
        node.messageId = row.eventId
        const d = this.parseRowData(row as unknown as CachedTreeRow) as { content?: string; role?: string } | null
        if (d) {
          const content = isExternalized(d.content) ? (d.content as ExternalizedContent).preview : d.content
          if (content) node.preview = content.slice(0, 120)
          if (d.role) node.role = d.role
        }
      }
      nodes.push(node)
    }

    return {
      treeId,
      cursor,
      tips: tips.map((t) => t.eventId),
      nodes,
    }
  }

  private parseRowData(row: CachedTreeRow): unknown {
    if (row.parsedData === undefined) {
      try {
        row.parsedData = JSON.parse(row.payload)
      } catch {
        row.parsedData = {}
      }
    }
    return row.parsedData
  }

  // --------------------------------------------------------------------------
  // Misc retrieval
  // --------------------------------------------------------------------------

  /** Latest (max) sequence number in the session's tree. */
  getLatestSeq(sessionId: string): number | undefined {
    const treeId = this.getTreeId(sessionId)
    let maxSeq: number | undefined
    for (const row of this.treeRows.get(treeId)?.values() ?? []) {
      if (row.seq > (maxSeq ?? 0)) maxSeq = row.seq
    }
    if (maxSeq === undefined) {
      const row = this.db.prepare(`SELECT MAX(seq) as max_seq FROM events WHERE tree_id = ?`).get(treeId) as
        { max_seq: number | null } | undefined
      maxSeq = row?.max_seq ?? undefined
    }
    return maxSeq
  }

  /**
   * The most recent real user prompts on the session's active path,
   * memoized per session (sidebar list).
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

    const events = this.getEvents(sessionId)
    const promptMap = new Map<string, { id: string; content: string; timestamp: string }>()
    for (const event of events) {
      if (event.type !== 'message') continue
      const msg = event.data as {
        messageId: string
        role: string
        content: string
        isSystemGenerated?: boolean
        messageKind?: string
        subAgentType?: string
      }
      if (!isRealUserMessage(msg)) continue
      promptMap.set(msg.messageId, {
        id: msg.messageId,
        content: msg.content,
        timestamp: new Date(event.timestamp).toISOString(),
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

  // --------------------------------------------------------------------------
  // Subscriptions
  // --------------------------------------------------------------------------

  /**
   * Subscribe to events for a session. Optional fromSeq replays path events
   * with seq >= fromSeq first (reconnect catch-up).
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
      state.queue.push(...this.getEvents(sessionId, fromSeq))
    }

    const unsubscribe = () => {
      subscriber.closed = true
      state.closeIterator()
      sessionSubs?.delete(subscriber)
    }

    return { iterator: createEventIterator(state, subscriber), unsubscribe }
  }

  private notify(sessionId: string, event: StoredEvent): void {
    const sessionSubs = this.subscribers.get(sessionId)
    if (sessionSubs) {
      const subscribersCopy = Array.from(sessionSubs)
      for (const subscriber of subscribersCopy) {
        if (!subscriber.closed) {
          subscriber.callback(event)
        }
      }
    }

    const globalSubscribersCopy = Array.from(this.globalSubscribers.values())
    for (const subscriber of globalSubscribersCopy) {
      if (!subscriber.closed) {
        subscriber.callback(event)
      }
    }
  }

  /**
   * Subscribe to ALL events across ALL sessions (every append on every tree,
   * including ephemeral chunk events). Used by WebSocket clients.
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
  // In-place payload update (enrichment, e.g. vision descriptions)
  // --------------------------------------------------------------------------

  /**
   * Update the payload of an existing node in place (by event id).
   * Invalidates the tree's caches — the payload is part of path contents.
   */
  updateEventPayload(sessionId: string, eventId: string, data: unknown): void {
    const treeId = this.getTreeId(sessionId)
    const row = this.ensureTreeRows(treeId).get(eventId)
    if (!row) {
      throw new Error(`Event ${eventId} not found in conversation tree`)
    }
    const payload = JSON.stringify(data)
    this.db.prepare(`UPDATE events SET payload = ? WHERE tree_id = ? AND event_id = ?`).run(payload, treeId, eventId)
    this.invalidateTree(treeId)
    this.promptsCache.delete(sessionId)
  }

  // --------------------------------------------------------------------------
  // Import / deletion / garbage collection
  // --------------------------------------------------------------------------

  /**
   * Import v2 tree events (each carries eventId/parentId) into the session's
   * tree. Intended for a fresh session (the import target owns its tree).
   * Pre-v3 (linear) exports are not importable in v3.
   */
  importEvents(sessionId: string, events: StoredEvent[]): StoredEvent[] {
    if (events.length === 0) return []

    const treeId = this.getTreeId(sessionId)
    for (const event of events) {
      if (typeof event.eventId !== 'string' || event.eventId.length === 0) {
        throw new Error(
          'Import requires v2 conversation-tree events (eventId is missing) — pre-v3 exports are not supported',
        )
      }
    }

    const insert = this.db.prepare(
      `INSERT INTO events (tree_id, event_id, parent_id, seq, timestamp, event_type, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tree_id, event_id) DO NOTHING`,
    )

    const stored: StoredEvent[] = []
    const transaction = this.db.transaction(() => {
      for (const event of events) {
        insert.run(
          treeId,
          event.eventId,
          event.parentId ?? null,
          event.seq,
          event.timestamp,
          event.type,
          JSON.stringify(event.data),
        )
        stored.push({ ...event, sessionId })
      }
    })
    transaction()

    for (const event of stored) {
      this.notify(sessionId, event)
    }

    this.invalidateTree(treeId)
    this.cursors.delete(sessionId) // caller sets the imported cursor explicitly
    this.promptsCache.delete(sessionId)
    return stored
  }

  /**
   * Delete a session's store footprint: in-flight buffers, cursor, and — when
   * no other session shares the tree — the whole tree plus unreferenced
   * blobs. Shared trees are kept (the GC reclaims dead branches later).
   */
  deleteSession(sessionId: string): void {
    this.deletedSessions.add(sessionId)
    const treeId = this.getTreeId(sessionId)
    this.buffers.delete(sessionId)
    this.cursors.delete(sessionId)

    const others = (this.tryGetDbRows(`SELECT id FROM sessions WHERE tree_id = ?`, treeId) as { id: string }[]).filter(
      (s) => s.id !== sessionId,
    )

    if (others.length === 0) {
      const rows = this.ensureTreeRows(treeId)
      const refs = collectBlobRefsFromRows(rows)
      const result = this.db.prepare(`DELETE FROM events WHERE tree_id = ?`).run(treeId)
      if (result.changes > 0) {
        const blobsDeleted = this.deleteUnreferencedBlobs(refs)
        logger.debug('Deleted conversation tree', { treeId, events: result.changes, blobsDeleted })
      }
      this.invalidateTree(treeId)
    }

    this.promptsCache.delete(sessionId)

    // Close all subscribers for this session
    const sessionSubs = this.subscribers.get(sessionId)
    if (sessionSubs) {
      for (const subscriber of sessionSubs) {
        subscriber.closed = true
        subscriber.close()
      }
      this.subscribers.delete(sessionId)
    }
  }

  /**
   * Reclaim dead branches: event subtrees referenced by no session cursor,
   * plus blobs they exclusively referenced.
   *
   * @param maxAgeMs - When set, a tree is only reclaimed if its newest dead
   *   node is older than this (grace period for abandoned-but-switchable
   *   branches). Omit to reclaim immediately.
   */
  gcDeadBranches(maxAgeMs?: number): { trees: number; eventsDeleted: number; blobsDeleted: number } {
    const report = { trees: 0, eventsDeleted: 0, blobsDeleted: 0 }

    const treeIds = (this.tryGetDbRows(`SELECT DISTINCT tree_id FROM events`) as { tree_id: string }[]).map(
      (r) => r.tree_id,
    )

    for (const treeId of treeIds) {
      const sessions = this.tryGetDbRows(`SELECT id FROM sessions WHERE tree_id = ?`, treeId) as { id: string }[]
      if (sessions.length === 0) {
        // Orphaned tree (owning session deleted without cleanup) — reclaim in full.
        const rows = this.ensureTreeRows(treeId)
        const refs = collectBlobRefsFromRows(rows)
        const result = this.db.prepare(`DELETE FROM events WHERE tree_id = ?`).run(treeId)
        report.eventsDeleted += result.changes
        report.blobsDeleted += this.deleteUnreferencedBlobs(refs)
        this.invalidateTree(treeId)
        report.trees++
        continue
      }

      const aliveCursors = sessions
        .map((s) => this.getCursorEventId(s.id))
        .filter((c): c is string => typeof c === 'string' && c.length > 0)

      const rows = this.ensureTreeRows(treeId)
      const dead = getDeadEventIds(rows as unknown as Map<string, TreeEventRow>, aliveCursors)
      if (dead.size === 0) continue

      if (maxAgeMs !== undefined) {
        let newest = 0
        for (const id of dead) {
          const row = rows.get(id)
          if (row && row.timestamp > newest) newest = row.timestamp
        }
        if (newest === 0 || Date.now() - newest < maxAgeMs) continue
      }

      const refs = collectBlobRefsFromDeadRows(rows, dead)
      let deleted = 0
      const deadIds = [...dead]
      for (let i = 0; i < deadIds.length; i += 1000) {
        const chunk = deadIds.slice(i, i + 1000)
        // All-anonymous placeholders (mixing ? and ?NNN breaks better-sqlite3).
        const delById = this.db.prepare(
          `DELETE FROM events WHERE tree_id = ? AND event_id IN (${chunk.map(() => '?').join(',')})`,
        )
        deleted += delById.run(treeId, ...chunk).changes
      }
      report.eventsDeleted += deleted
      report.blobsDeleted += this.deleteUnreferencedBlobs(refs)
      this.invalidateTree(treeId)
      report.trees++
    }

    if (report.eventsDeleted > 0 || report.blobsDeleted > 0) {
      logger.info('Dead-branch GC', report)
    }
    return report
  }

  // --------------------------------------------------------------------------
  // Maintenance
  // --------------------------------------------------------------------------

  /** All session ids in the sessions table (empty on fixtures without one). */
  listSessionIds(): string[] {
    return this.tryGetDbRows(`SELECT id FROM sessions`)
      .map((r) => (r as { id: string }).id)
      .filter((id) => typeof id === 'string')
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

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function extractBlobRefs(payload: string): string[] {
  const refs: string[] = []
  if (!payload.includes('"blobRef"')) return refs
  const parsed = safeJsonParse(payload)
  if (parsed && typeof parsed === 'object') {
    collectRefsFromValue(parsed, refs)
  }
  return refs
}

function collectRefsFromValue(value: unknown, out: string[]): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) collectRefsFromValue(item, out)
    return
  }
  const obj = value as Record<string, unknown>
  if (isExternalized(obj)) {
    out.push(obj.blobRef)
    return
  }
  for (const v of Object.values(obj)) collectRefsFromValue(v, out)
}

function collectBlobRefsFromRows(rows: Map<string, CachedTreeRow>): string[] {
  const refs = new Set<string>()
  for (const row of rows.values()) {
    for (const ref of extractBlobRefs(row.payload)) refs.add(ref)
  }
  return [...refs]
}

function collectBlobRefsFromDeadRows(rows: Map<string, CachedTreeRow>, dead: Set<string>): string[] {
  const refs = new Set<string>()
  for (const id of dead) {
    const row = rows.get(id)
    if (!row) continue
    for (const ref of extractBlobRefs(row.payload)) refs.add(ref)
  }
  return [...refs]
}

// ============================================================================
// Singleton instance (initialized with the main database)
// ============================================================================

let eventStoreInstance: EventStore | null = null

// Session IDs that were left running when the server stopped (detected at
// startup). Consumed by the opt-in boot auto-continuation (Settings > Advanced).
let staleRunningSessionIds: string[] = []

export function getStaleRunningSessionIds(): string[] {
  return staleRunningSessionIds
}

export function initEventStore(db: Database.Database, options?: EventStoreOptions): EventStore {
  eventStoreInstance = new EventStore(db, options)

  // Reset stale running states from previous server runs.
  // Sessions cannot actually be running when the server starts.
  try {
    db.prepare(`UPDATE sessions SET is_running = 0`).run()
  } catch {
    // Column may not exist in test fixtures without full schema
  }

  // Path-scoped hygiene (stale running flags, stale confirmations) walks each
  // session's active path — background it so a large database never blocks
  // startup.
  setImmediate(() => {
    try {
      resetStaleRunningSessions(eventStoreInstance!)
      rejectStaleConfirmations(eventStoreInstance!)
    } catch (error) {
      logger.warn('Post-boot session hygiene failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  // Dead-branch GC at startup: reclaim abandoned branches (7-day grace so
  // freshly abandoned branches stay switchable) and orphaned trees.
  setImmediate(() => {
    try {
      eventStoreInstance!.gcDeadBranches(7 * 24 * 60 * 60 * 1000)
    } catch (error) {
      logger.debug('Dead-branch GC failed at startup', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  // Collapse the WAL into the main database in the background.
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
 * Find sessions whose active path folds to isRunning=true (crashed mid-turn)
 * and emit running.changed=false.
 */
function resetStaleRunningSessions(eventStore: EventStore): void {
  const sessions = eventStore.listSessionIds()
  let resetCount = 0
  staleRunningSessionIds = []

  for (const sessionId of sessions) {
    const events = eventStore.getEvents(sessionId)
    let wasRunning = false
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]!
      if (event.type !== 'running.changed') continue
      wasRunning = (event.data as { isRunning: boolean }).isRunning
      break
    }
    if (wasRunning) {
      eventStore.append(sessionId, { type: 'running.changed', data: { isRunning: false } })
      resetCount++
      staleRunningSessionIds.push(sessionId)
    }
  }

  if (resetCount > 0) {
    logger.info('EventStore reset stale running sessions', { count: resetCount })
  }
}

/** Reject unresponded path confirmations from a previous server run. */
function rejectStaleConfirmations(eventStore: EventStore): void {
  const sessions = eventStore.listSessionIds()
  let rejectedCount = 0

  for (const sessionId of sessions) {
    const events = eventStore.getEvents(sessionId)
    const pending = foldPendingConfirmations(events)
    for (const pendingConfirmation of pending) {
      eventStore.append(sessionId, {
        type: 'path.confirmation_responded',
        data: { callId: pendingConfirmation.callId, approved: false, alwaysAllow: false },
      })
      rejectedCount++
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
