/**
 * Snapshot cadence tests.
 *
 * The incident: a turn that runs for hours never reaches its end-of-turn
 * snapshot, so the event log grows without bound (909 MB of payload behind a
 * 95 KB snapshot) while every state load re-reads all of it. The cadence keeps
 * the tail — the only part a state load replays — bounded during the turn.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
