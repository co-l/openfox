/**
 * Mid-turn snapshots + event-log retention.
 *
 * A turn is a single `runTopLevelAgentLoop` call that can run for hours. The
 * end-of-turn snapshot — and the cleanup that runs right after it — therefore
 * never happens while the turn is alive: the log grows without bound and every
 * state load re-reads (and re-parses) everything appended since the last
 * snapshot. On the incident session that reached 909 MB of payload behind a
 * 95 KB snapshot, costing ~12 s of synchronous work per load, several times a
 * minute, which starved the event loop.
 *
 * This cadence snapshots *during* the turn and prunes what the snapshot
 * absorbed, so the tail — the only part a state load has to replay — stays
 * bounded no matter how long the turn runs.
 */

import type { SessionManager } from '../session/manager.js'
import type { TurnEvent } from '../events/types.js'
import { combineEventsWithSnapshot, getEventStore } from '../events/index.js'
import { buildSnapshotFromSessionState } from '../events/folding.js'
import { logger } from '../utils/logger.js'

/** Payload bytes appended since the last snapshot that force a new one. */
const DEFAULT_MAX_BYTES = 48 * 1024 * 1024
/** Wall-clock ceiling between snapshots, so a slow trickle is bounded too. */
const DEFAULT_MAX_MS = 10 * 60 * 1000
/** A time-triggered snapshot still needs some content, or idle turns snapshot for nothing. */
const MIN_BYTES_FOR_TIME_TRIGGER = 4 * 1024 * 1024
/** Minimum delay between two tail measurements. */
const DEFAULT_CHECK_INTERVAL_MS = 30_000
/**
 * Minimum delay between two checks while a snapshot is deferred. Each check
 * scans the tail (~0.1 s at 46 MB), and parallel tools or sub-agents can keep
 * the turn busy across many quiet points in a row.
 */
const DEFAULT_DEFERRED_CHECK_INTERVAL_MS = 5_000

export interface SnapshotCadence {
  /** Append an event; a snapshot is taken when the tail budget is exceeded. */
  append: (event: TurnEvent) => void
  /** Snapshot + prune now (end of turn, or before the turn's state is final). */
  flush: () => void
}

export interface SnapshotCadenceOptions {
  sessionManager: SessionManager
  sessionId: string
  append: (event: TurnEvent) => void
  /** Test seam — production uses the defaults. */
  maxBytes?: number
  maxMs?: number
  checkIntervalMs?: number
  deferredCheckIntervalMs?: number
}

/**
 * Per-session cadence state, shared by every writer of that session's log (the
 * turn, its workflow steps and its sub-agents): they all append to the same
 * events table, so they must not each pay for their own snapshot.
 */
interface CadenceState {
  lastSnapshotSeq: number
  lastSnapshotAt: number
  lastCheckAt: number
  /**
   * In-flight counters already present when this cadence started. A tool call
   * interrupted by a crash never gets its result, and that leftover must not
   * block every later snapshot of the session.
   */
  openMessagesAtRest: number
  pendingToolCallsAtRest: number
  /**
   * A check found the tail over budget but the turn busy. The periodic check
   * nearly always lands on a busy moment in a sub-agent run (streaming or a
   * tool round), so the next quiet point (a message or tool round ending)
   * checks again, at most every DEFAULT_DEFERRED_CHECK_INTERVAL_MS, instead
   * of waiting for the next period.
   */
  deferred: boolean
}

const cadenceStates = new Map<string, CadenceState>()
/** Entries are two numbers; the cap only exists so a long-lived server does not keep one per session forever. */
const MAX_TRACKED_SESSIONS = 256

function readPositiveIntEnv(name: string): number | undefined {
  const raw = process.env[name]
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export function createSnapshotCadence(options: SnapshotCadenceOptions): SnapshotCadence {
  const { sessionManager, sessionId, append } = options
  const eventStore = getEventStore()

  const maxBytes = options.maxBytes ?? readPositiveIntEnv('OPENFOX_SNAPSHOT_MAX_BYTES') ?? DEFAULT_MAX_BYTES
  const maxMs =
    options.maxMs ?? (readPositiveIntEnv('OPENFOX_SNAPSHOT_MAX_MINUTES') ?? DEFAULT_MAX_MS / 60_000) * 60_000
  const checkIntervalMs = options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS
  const deferredCheckIntervalMs = options.deferredCheckIntervalMs ?? DEFAULT_DEFERRED_CHECK_INTERVAL_MS

  let state = cadenceStates.get(sessionId)
  if (!state) {
    state = {
      lastSnapshotSeq: 0,
      lastSnapshotAt: 0,
      lastCheckAt: 0,
      openMessagesAtRest: 0,
      pendingToolCallsAtRest: 0,
      deferred: false,
    }
    cadenceStates.set(sessionId, state)
    if (cadenceStates.size > MAX_TRACKED_SESSIONS) {
      const oldest = cadenceStates.keys().next().value
      if (oldest !== undefined && oldest !== sessionId) cadenceStates.delete(oldest)
    }
  }
  // Whoever enters last owns the freshest view of the log — a sub-agent's
  // cadence must not measure the tail from before its parent's snapshot.
  state.lastSnapshotSeq = eventStore.getLatestSnapshotSeq(sessionId)
  state.lastSnapshotAt = Date.now()
  state.lastCheckAt = Date.now() - checkIntervalMs
  // Anything already in flight at this point predates this cadence (a parent
  // turn's message, a tool the caller is waiting on) — only new opens block.
  const atRest = eventStore.getEventLogTail(sessionId, state.lastSnapshotSeq)
  state.openMessagesAtRest = atRest.openMessages
  state.pendingToolCallsAtRest = atRest.pendingToolCalls

  let insideSnapshot = false

  /**
   * Build the snapshot from the previous one plus the tail, never from the raw
   * log: `buildSnapshotFromSessionState` folds whatever it is given, so feeding
   * it the whole log would reintroduce the cost this module exists to remove.
   */
  const takeSnapshot = (): void => {
    if (insideSnapshot) return
    insideSnapshot = true
    try {
      const session = sessionManager.requireSession(sessionId)
      const { snapshot, events } = eventStore.getEventsSinceSnapshot(sessionId)
      const boundedEvents = combineEventsWithSnapshot(sessionId, snapshot, events)
      const cachedPrompt = sessionManager.getCachedPrompt(sessionId)

      const next = buildSnapshotFromSessionState({
        session,
        events: boundedEvents,
        latestSeq: eventStore.getLatestSeq(sessionId) ?? 0,
        ...(cachedPrompt
          ? { cachedSystemPrompt: cachedPrompt.systemPrompt, dynamicContextHash: cachedPrompt.hash }
          : {}),
      })

      const appended = eventStore.append(sessionId, { type: 'turn.snapshot', data: next })
      const tailBefore = eventStore.getEventLogTail(sessionId, state.lastSnapshotSeq).bytes
      state.lastSnapshotSeq = appended.seq
      state.lastSnapshotAt = Date.now()
      const afterSnapshot = eventStore.getEventLogTail(sessionId, state.lastSnapshotSeq)
      state.openMessagesAtRest = afterSnapshot.openMessages
      state.pendingToolCallsAtRest = afterSnapshot.pendingToolCalls

      const deleted = eventStore.cleanupOldEvents(sessionId)
      if (deleted > 0) {
        logger.info('Pruned event log behind a snapshot', {
          sessionId,
          snapshotSeq: appended.seq,
          tailBytes: tailBefore,
          deleted,
        })
      }
    } catch (error) {
      // Session may have been deleted (e.g. during abort) — the caller's own
      // bookkeeping must not fail because of a snapshot.
      logger.debug('Snapshot failed', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      insideSnapshot = false
    }
  }

  return {
    append: (event) => {
      append(event)

      const now = Date.now()
      const quietPoint = event.type === 'message.done' || event.type === 'tool.result'
      const interval =
        state.deferred && quietPoint ? Math.min(deferredCheckIntervalMs, checkIntervalMs) : checkIntervalMs
      if (now - state.lastCheckAt < interval) return
      state.lastCheckAt = now

      const { events, bytes, openMessages, pendingToolCalls } = eventStore.getEventLogTail(
        sessionId,
        state.lastSnapshotSeq,
      )
      if (events === 0) return

      const overBytes = bytes >= maxBytes
      const overTime = now - state.lastSnapshotAt >= maxMs && bytes >= MIN_BYTES_FOR_TIME_TRIGGER
      if (!overBytes && !overTime) {
        state.deferred = false
        return
      }

      // Snapshot only at a quiescent boundary. A snapshot taken while a message
      // streams (or a tool round is in flight) freezes a partial message, and
      // the context fold then drops every later event carrying that messageId —
      // the rest of the answer, or the tool results of the round.
      if (openMessages > state.openMessagesAtRest || pendingToolCalls > state.pendingToolCallsAtRest) {
        logger.debug('Snapshot cadence deferred, turn in flight', { sessionId, openMessages, pendingToolCalls })
        state.deferred = true
        return
      }

      state.deferred = false
      logger.info('Snapshot cadence triggered', { sessionId, bytes, events, overBytes, overTime })
      takeSnapshot()
    },
    flush: () => takeSnapshot(),
  }
}
