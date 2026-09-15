/**
 * Reload parity (v3 tree)
 *
 * The v1 "empty conversation after reload" bug came from snapshots + event
 * cleanup racing. In v3 the tree is append-only: a reload (or a full server
 * restart) rebuilds the conversation by reading the active path — no cleanup
 * can ever make history disappear. These tests pin that invariant.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { getContextMessages, getCurrentContextWindowId, getSessionState } from './session.js'
import { EventStore, initEventStore, getEventStore } from './index.js'
import { foldSessionState } from './fold-state.js'

const SESSIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    workdir TEXT NOT NULL,
    is_running INTEGER DEFAULT 0,
    tree_id TEXT,
    cursor_event_id TEXT,
    message_count INTEGER DEFAULT 0,
    updated_at TEXT
  )
`

function seedTurn(store: EventStore, sessionId: string, msgPrefix: string, withTools: boolean): void {
  const windowId = 'window-1'
  store.append(sessionId, {
    type: 'message.start',
    data: { messageId: `${msgPrefix}-u`, role: 'user', content: `${msgPrefix} question`, contextWindowId: windowId },
  })
  store.append(sessionId, { type: 'message.done', data: { messageId: `${msgPrefix}-u` } })

  store.append(sessionId, {
    type: 'message.start',
    data: { messageId: `${msgPrefix}-a`, role: 'assistant', content: '', contextWindowId: windowId },
  })
  store.append(sessionId, {
    type: 'message.delta',
    data: { messageId: `${msgPrefix}-a`, content: `${msgPrefix} answer` },
  })
  if (withTools) {
    store.append(sessionId, {
      type: 'tool.call',
      data: {
        messageId: `${msgPrefix}-a`,
        toolCall: { id: `${msgPrefix}-tc`, name: 'read_file', arguments: { path: 'a.txt' } },
      },
    })
    store.append(sessionId, {
      type: 'tool.result',
      data: {
        messageId: `${msgPrefix}-a`,
        toolCallId: `${msgPrefix}-tc`,
        result: { success: true, output: 'file contents', durationMs: 5, truncated: false },
      },
    })
  }
  store.append(sessionId, { type: 'message.done', data: { messageId: `${msgPrefix}-a` } })
  store.append(sessionId, { type: 'chat.done', data: { messageId: `${msgPrefix}-a`, reason: 'complete' } })
}

describe('Session Reload (v3 tree)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(SESSIONS_TABLE)
    db.prepare(
      `INSERT INTO sessions (id, project_id, workdir, tree_id, updated_at) VALUES (?, 'proj-1', '/tmp', ?, 'now')`,
    ).run('session-1', 'session-1')
    initEventStore(db)
  })

  afterEach(() => {
    db.close()
  })

  it('preserves the full conversation across a reload', () => {
    const sessionId = 'session-1'
    const eventStore = getEventStore()
    eventStore.append(sessionId, {
      type: 'session.initialized',
      data: { projectId: 'proj-1', workdir: '/tmp', contextWindowId: 'window-1' },
    })
    seedTurn(eventStore, sessionId, 'first', false)
    seedTurn(eventStore, sessionId, 'second', true)

    const state = getSessionState(sessionId)
    expect(state).toBeDefined()
    expect(state!.messages.map((m) => m.content)).toEqual([
      'first question',
      'first answer',
      'second question',
      'second answer',
    ])
    const toolCalls = state!.messages[3]!.toolCalls
    expect(toolCalls?.[0]?.name).toBe('read_file')
    expect(toolCalls?.[0]?.result?.output).toBe('file contents')

    // Context messages for the LLM.
    const windowId = getCurrentContextWindowId(sessionId)
    expect(windowId).toBe('window-1')
    const context = getContextMessages(sessionId)
    expect(context.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'tool'])
    expect(context[4]!.content).toBe('file contents')
  })

  it('survives a full server restart (fresh store, same database)', () => {
    const sessionId = 'session-1'
    const eventStore = getEventStore()
    eventStore.append(sessionId, {
      type: 'session.initialized',
      data: { projectId: 'proj-1', workdir: '/tmp', contextWindowId: 'window-1' },
    })
    seedTurn(eventStore, sessionId, 'first', false)
    seedTurn(eventStore, sessionId, 'second', true)

    // "Restart": a fresh store instance over the same database, folding the
    // active path (identical to what getSessionState does on the singleton).
    const restarted = new EventStore(db)
    const events = restarted.getEvents(sessionId)
    const initialWindowId =
      (events.find((e) => e.type === 'session.initialized')?.data as { contextWindowId?: string })?.contextWindowId ??
      ''
    const state = foldSessionState(events, initialWindowId, 200000)
    expect(state.messages.map((m) => m.content)).toEqual([
      'first question',
      'first answer',
      'second question',
      'second answer',
    ])
  })

  it('keeps the in-flight view separate from the persisted path', () => {
    const sessionId = 'session-1'
    const eventStore = getEventStore()
    eventStore.append(sessionId, {
      type: 'session.initialized',
      data: { projectId: 'proj-1', workdir: '/tmp', contextWindowId: 'window-1' },
    })
    seedTurn(eventStore, sessionId, 'first', false)
    // In-flight assistant message (turn not yet done).
    eventStore.append(sessionId, {
      type: 'message.start',
      data: { messageId: 'live-a', role: 'assistant', content: '' },
    })
    eventStore.append(sessionId, { type: 'message.delta', data: { messageId: 'live-a', content: 'partial ' } })

    const inflight = eventStore.getInflightMessages(sessionId)
    expect(inflight.map((m) => m.id)).toEqual(['live-a'])
    expect(inflight[0]!.content).toBe('partial ')
    expect(inflight[0]!.isStreaming).toBe(true)

    // The persisted path holds everything EXCEPT the in-flight message.
    const events = eventStore.getEvents(sessionId)
    expect(events.filter((e) => e.type === 'message')).toHaveLength(2)
  })
})
