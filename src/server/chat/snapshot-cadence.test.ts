/**
 * Snapshot cadence tests.
 *
 * The incident: a turn that runs for hours never reaches its end-of-turn
 * snapshot, so the event log grows without bound (909 MB of payload behind a
 * 95 KB snapshot) while every state load re-reads all of it. The cadence keeps
 * the tail — the only part a state load replays — bounded during the turn.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { initEventStore, getEventStore } from '../events/store.js'
import { emitSessionInitialized, emitUserMessage } from '../events/session.js'
import type { TurnEvent } from '../events/types.js'
import type { SessionManager } from '../session/manager.js'
import { createSnapshotCadence } from './snapshot-cadence.js'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      workdir TEXT NOT NULL
    )
  `)
  initEventStore(db)
})

afterEach(() => {
  vi.useRealTimers()
  db.close()
})

function fakeSessionManager(): SessionManager {
  return {
    requireSession: () => ({
      mode: 'planner',
      phase: 'plan',
      isRunning: true,
      criteria: [],
      executionState: null,
    }),
    getCachedPrompt: () => undefined,
  } as unknown as SessionManager
}

function rawAppend(sessionId: string) {
  return (event: TurnEvent) => {
    getEventStore().append(sessionId, event)
  }
}

function delta(content: string): TurnEvent {
  return { type: 'message.delta', data: { messageId: 'm1', content } }
}

describe('createSnapshotCadence', () => {
  it('snapshots and prunes mid-turn once the tail exceeds the byte budget', () => {
    emitSessionInitialized('s1', 'p', '/tmp', 'win-1')
    emitUserMessage('s1', 'go')
    const store = getEventStore()

    const cadence = createSnapshotCadence({
      sessionManager: fakeSessionManager(),
      sessionId: 's1',
      append: rawAppend('s1'),
      maxBytes: 2_000,
      checkIntervalMs: 0,
    })

    for (let i = 0; i < 40; i++) {
      cadence.append(delta('x'.repeat(200)))
    }

    const snapshotSeq = store.getLatestSnapshotSeq('s1')
    expect(snapshotSeq).toBeGreaterThan(0)
    // Everything the snapshot absorbed is gone: only the initialization, the
    // snapshot itself and the short tail remain.
    expect(store.getEventLogTail('s1', snapshotSeq).events).toBeLessThan(20)
  })

  it('defers the snapshot while a message is streaming', () => {
    emitSessionInitialized('s1', 'p', '/tmp', 'win-1')
    const store = getEventStore()

    const cadence = createSnapshotCadence({
      sessionManager: fakeSessionManager(),
      sessionId: 's1',
      append: rawAppend('s1'),
      maxBytes: 500,
      checkIntervalMs: 0,
    })

    cadence.append({ type: 'message.start', data: { messageId: 'a1', role: 'assistant' } })
    for (let i = 0; i < 10; i++) {
      cadence.append(delta('x'.repeat(200)))
    }

    // Over budget, but snapshotting here would freeze a partial message and the
    // context fold would drop every later delta carrying that messageId.
    expect(store.getLatestSnapshotSeq('s1')).toBe(0)

    cadence.append({ type: 'message.done', data: { messageId: 'a1' } })

    expect(store.getLatestSnapshotSeq('s1')).toBeGreaterThan(0)
  })

  it('defers the snapshot while a tool round is in flight', () => {
    emitSessionInitialized('s1', 'p', '/tmp', 'win-1')
    const store = getEventStore()

    const cadence = createSnapshotCadence({
      sessionManager: fakeSessionManager(),
      sessionId: 's1',
      append: rawAppend('s1'),
      maxBytes: 500,
      checkIntervalMs: 0,
    })

    cadence.append({
      type: 'tool.call',
      data: {
        messageId: 'a1',
        toolCall: { id: 'tc-1', name: 'read_file', arguments: { path: '/tmp/a.ts' } },
      },
    })
    for (let i = 0; i < 10; i++) {
      cadence.append(delta('x'.repeat(200)))
    }

    // The result of this call would be dropped from the context if the snapshot
    // absorbed the round before it lands.
    expect(store.getLatestSnapshotSeq('s1')).toBe(0)

    cadence.append({
      type: 'tool.result',
      data: {
        messageId: 'a1',
        toolCallId: 'tc-1',
        result: { success: true, output: 'ok', durationMs: 5, truncated: false },
      },
    })

    expect(store.getLatestSnapshotSeq('s1')).toBeGreaterThan(0)
  })

  it('snapshots at the next quiet point when the periodic check found the turn busy', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // The check runs at most every checkIntervalMs, on whatever event comes
    // in. A sub-agent is nearly always streaming or running a tool, so the
    // check kept landing on a busy moment and the snapshot was put off to the
    // end of the turn (seen live: a 7-12 minute sub-agent run, tail over
    // budget, no mid-turn snapshot). Once deferred, the next message or tool
    // round end checks again.
    emitSessionInitialized('s1', 'p', '/tmp', 'win-1')
    const store = getEventStore()
    // Already over budget when the cadence starts.
    for (let i = 0; i < 10; i++)
      store.append('s1', {
        type: 'tool.output',
        data: { messageId: 'm0', toolCallId: 't0', stream: 'stdout', content: 'x'.repeat(200) },
      } as never)

    const cadence = createSnapshotCadence({
      sessionManager: fakeSessionManager(),
      sessionId: 's1',
      append: rawAppend('s1'),
      maxBytes: 500,
      checkIntervalMs: 60 * 60_000,
    })

    // The periodic check lands mid-message: deferred.
    cadence.append({ type: 'message.start', data: { messageId: 'a1', role: 'assistant' } })
    for (let i = 0; i < 10; i++) cadence.append(delta('x'.repeat(200)))
    expect(store.getLatestSnapshotSeq('s1')).toBe(0)

    // Far from the next periodic check, but a message ends: quiet point.
    vi.setSystemTime(Date.now() + 5_000)
    cadence.append({ type: 'message.done', data: { messageId: 'a1' } })

    expect(store.getLatestSnapshotSeq('s1')).toBeGreaterThan(0)
  })

  it('checks a deferred snapshot again at most every 5 s', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // Each check scans the tail; parallel tools or sub-agents can keep the
    // turn busy over many quiet points in a row.
    emitSessionInitialized('s1', 'p', '/tmp', 'win-1')
    const store = getEventStore()
    for (let i = 0; i < 10; i++)
      store.append('s1', {
        type: 'tool.output',
        data: { messageId: 'm0', toolCallId: 't0', stream: 'stdout', content: 'x'.repeat(200) },
      } as never)

    const cadence = createSnapshotCadence({
      sessionManager: fakeSessionManager(),
      sessionId: 's1',
      append: rawAppend('s1'),
      maxBytes: 500,
      checkIntervalMs: 60 * 60_000,
    })
    cadence.append({ type: 'message.start', data: { messageId: 'a1', role: 'assistant' } })
    const tail = vi.spyOn(store, 'getEventLogTail')

    vi.setSystemTime(Date.now() + 4_000)
    cadence.append({ type: 'message.done', data: { messageId: 'a1' } })
    expect(tail).not.toHaveBeenCalled()
    expect(store.getLatestSnapshotSeq('s1')).toBe(0)

    vi.setSystemTime(Date.now() + 1_000)
    cadence.append({ type: 'message.start', data: { messageId: 'a2', role: 'assistant' } })
    cadence.append({ type: 'message.done', data: { messageId: 'a2' } })
    expect(store.getLatestSnapshotSeq('s1')).toBeGreaterThan(0)
  })

  it('is not blocked by a tool call left unresolved by a crash', () => {
    emitSessionInitialized('s1', 'p', '/tmp', 'win-1')
    // Interrupted before its result: nothing will ever close it.
    getEventStore().append('s1', {
      type: 'tool.call',
      data: {
        messageId: 'crashed',
        toolCall: { id: 'tc-leftover', name: 'run_command', arguments: { command: 'sleep 999' } },
      },
    })
    const store = getEventStore()

    const cadence = createSnapshotCadence({
      sessionManager: fakeSessionManager(),
      sessionId: 's1',
      append: rawAppend('s1'),
      maxBytes: 500,
      checkIntervalMs: 0,
    })

    for (let i = 0; i < 10; i++) {
      cadence.append(delta('x'.repeat(200)))
    }

    expect(store.getLatestSnapshotSeq('s1')).toBeGreaterThan(0)
  })

  it('leaves the log alone while the tail stays under the budget', () => {
    emitSessionInitialized('s1', 'p', '/tmp', 'win-1')
    const store = getEventStore()

    const cadence = createSnapshotCadence({
      sessionManager: fakeSessionManager(),
      sessionId: 's1',
      append: rawAppend('s1'),
      maxBytes: 1_000_000,
      checkIntervalMs: 0,
    })

    for (let i = 0; i < 10; i++) {
      cadence.append(delta('x'))
    }

    expect(store.getLatestSnapshotSeq('s1')).toBe(0)
  })

  it('snapshots on a time trigger even under the byte budget', () => {
    emitSessionInitialized('s1', 'p', '/tmp', 'win-1')
    const store = getEventStore()

    const cadence = createSnapshotCadence({
      sessionManager: fakeSessionManager(),
      sessionId: 's1',
      append: rawAppend('s1'),
      maxBytes: Number.MAX_SAFE_INTEGER,
      maxMs: 0,
      checkIntervalMs: 0,
    })

    for (let i = 0; i < 40; i++) {
      cadence.append(delta('x'.repeat(150_000)))
    }

    expect(store.getLatestSnapshotSeq('s1')).toBeGreaterThan(0)
  })

  it('keeps one history entry per compaction and retry across snapshots', () => {
    // A snapshot was built from the previous one plus the events since, and
    // that stream also replays the previous snapshot's compactions and retries
    // as synthetic events: the fold counted them twice, so every snapshot
    // doubled them. Seen live: 7 compactions stored as 2.3 million entries,
    // a 433 MB snapshot rewritten at every turn end, and the disk full.
    emitSessionInitialized('s1', 'p', '/tmp', 'win-1')
    const store = getEventStore()
    store.append('s1', {
      type: 'context.compacted',
      data: { closedWindowId: 'win-1', newWindowId: 'win-2', beforeTokens: 70_000, afterTokens: 0, summary: 'sum' },
    })
    store.append('s1', {
      type: 'pattern.retry',
      data: { attempt: 1, maxAttempts: 3, messageId: 'm1', pattern: 'p', field: 'content', matchedContent: 'x' },
    } as never)
    const cadence = createSnapshotCadence({
      sessionManager: fakeSessionManager(),
      sessionId: 's1',
      append: rawAppend('s1'),
    })

    for (let i = 0; i < 4; i++) {
      cadence.append(delta('more'))
      cadence.flush()
    }

    const snapshot = store.getLatestSnapshot('s1')!.data
    expect(snapshot.contextWindows).toHaveLength(1)
    expect(snapshot.formatRetries).toHaveLength(1)
  })

  it('shrinks a snapshot whose history was already inflated', () => {
    emitSessionInitialized('s1', 'p', '/tmp', 'win-1')
    const store = getEventStore()
    const cadence = createSnapshotCadence({
      sessionManager: fakeSessionManager(),
      sessionId: 's1',
      append: rawAppend('s1'),
    })
    cadence.flush()
    const inflated = store.getLatestSnapshot('s1')!.data
    const compaction = {
      closedWindowId: 'win-1',
      newWindowId: 'win-2',
      beforeTokens: 1,
      afterTokens: 0,
      summary: 's',
      timestamp: 1,
    }
    store.append('s1', {
      type: 'turn.snapshot',
      data: { ...inflated, contextWindows: [compaction, compaction, compaction, compaction] },
    })

    cadence.append(delta('more'))
    cadence.flush()

    expect(store.getLatestSnapshot('s1')!.data.contextWindows).toHaveLength(1)
  })

  it('flush always snapshots and prunes, even with an empty tail', () => {
    emitSessionInitialized('s1', 'p', '/tmp', 'win-1')
    emitUserMessage('s1', 'go')
    const store = getEventStore()

    const cadence = createSnapshotCadence({
      sessionManager: fakeSessionManager(),
      sessionId: 's1',
      append: rawAppend('s1'),
      maxBytes: Number.MAX_SAFE_INTEGER,
    })
    cadence.flush()

    expect(store.getLatestSnapshotSeq('s1')).toBeGreaterThan(1)
    expect(store.getEvents('s1').map((event) => event.type)).toEqual(['session.initialized', 'turn.snapshot'])
  })
})
