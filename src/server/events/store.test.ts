/**
 * EventStore Tests (v3 conversation tree)
 *
 * Sessions are (tree_id, cursor_event_id) over a shared tree of events.
 * Streaming chunks are ephemeral; a message is persisted once as a single
 * `message` node. Branches fork at message boundaries; forks share the tree
 * (O(1)); large payloads are externalized to blobs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { EventStore, initEventStore, getStaleRunningSessionIds } from './store.js'
import type { TurnEvent, StoredEvent } from './types.js'
import type { ToolResult } from '../../shared/types.js'
import { buildContextMessagesFromStoredEvents } from './folding.js'
import { foldContextState } from './fold-state.js'

const SESSIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    workdir TEXT,
    is_running INTEGER DEFAULT 0,
    tree_id TEXT,
    cursor_event_id TEXT,
    message_count INTEGER DEFAULT 0,
    updated_at TEXT
  )
`

function insertSession(db: Database.Database, id: string, opts?: { treeId?: string; cursor?: string | null }) {
  db.prepare(
    `INSERT INTO sessions (id, project_id, is_running, tree_id, cursor_event_id, updated_at) VALUES (?, 'p', 0, ?, ?, ?)`,
  ).run(id, opts?.treeId ?? id, opts?.cursor ?? null, new Date().toISOString())
}

function getSessionCount(db: Database.Database, id: string): number {
  const row = db.prepare(`SELECT message_count FROM sessions WHERE id = ?`).get(id) as { message_count: number }
  return row?.message_count ?? 0
}

/** Drive a realistic assistant turn through the store's single append path. */
function runAssistantTurn(
  store: EventStore,
  sessionId: string,
  messageId: string,
  chunks: TurnEvent[],
  options?: { contextWindowId?: string },
): void {
  store.append(sessionId, {
    type: 'message.start',
    data: {
      messageId,
      role: 'assistant',
      ...(options?.contextWindowId ? { contextWindowId: options.contextWindowId } : {}),
    },
  })
  for (const chunk of chunks) store.append(sessionId, chunk)
  store.append(sessionId, {
    type: 'message.done',
    data: { messageId, ...(chunks.length > 0 ? {} : {}) },
  })
}

function userMessage(
  store: EventStore,
  sessionId: string,
  content: string,
  messageId?: string,
  opts?: Record<string, unknown>,
): string {
  const id = messageId ?? crypto.randomUUID()
  store.append(sessionId, {
    type: 'message.start',
    data: { messageId: id, role: 'user', content, ...opts },
  })
  store.append(sessionId, { type: 'message.done', data: { messageId: id } })
  return id
}

function toolResult(store: EventStore, sessionId: string, messageId: string, toolCallId: string, result: object): void {
  store.append(sessionId, { type: 'tool.result', data: { messageId, toolCallId, result: result as ToolResult } })
}

describe('EventStore (v3 tree)', () => {
  let db: Database.Database
  let store: EventStore

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(SESSIONS_TABLE)
    store = new EventStore(db)
  })

  afterEach(() => {
    db.close()
  })

  // ============================================================================
  // Merge semantics
  // ============================================================================

  describe('message merging', () => {
    it('persists a full assistant turn as ONE message node', () => {
      insertSession(db, 's1')
      store.append('s1', {
        type: 'session.initialized',
        data: { projectId: 'p', workdir: '/w', contextWindowId: 'w1' },
      })
      const messageId = 'msg-a1'
      runAssistantTurn(store, 's1', messageId, [
        { type: 'message.thinking', data: { messageId, content: 'let me think' } },
        { type: 'message.delta', data: { messageId, content: 'Hello ' } },
        { type: 'message.delta', data: { messageId, content: 'world' } },
        {
          type: 'tool.call',
          data: { messageId, toolCall: { id: 'tc1', name: 'read_file', arguments: { path: 'a.ts' } } },
        },
      ])

      const events = store.getEvents('s1')
      const messages = events.filter((e) => e.type === 'message')
      expect(messages).toHaveLength(1)
      const msg = messages[0]!
      expect(msg.data).toMatchObject({
        messageId,
        role: 'assistant',
        content: 'Hello world',
        thinkingContent: 'let me think',
      })
      const toolCalls = (msg.data as { toolCalls: Array<{ id: string; name: string }> }).toolCalls
      expect(toolCalls).toEqual([{ id: 'tc1', name: 'read_file', arguments: { path: 'a.ts' } }])

      // No chunk nodes persisted — only the merged message + tree root.
      const types = events.map((e) => e.type)
      expect(types).toEqual(['session.initialized', 'message'])
      // The persisted node carries a real (non-ephemeral) seq.
      expect(msg.seq).toBe(2)
      expect(msg.eventId).toBe(messageId)
    })

    it('persists a user message on start (no second node on done)', () => {
      insertSession(db, 's1')
      const id = userMessage(store, 's1', 'Hi there')
      const events = store.getEvents('s1')
      const messages = events.filter((e) => e.type === 'message')
      expect(messages).toHaveLength(1)
      expect(messages[0]!.data).toMatchObject({ messageId: id, role: 'user', content: 'Hi there' })
    })

    it('tool results persist as their own nodes attached after the message', () => {
      insertSession(db, 's1')
      store.append('s1', {
        type: 'session.initialized',
        data: { projectId: 'p', workdir: '/w', contextWindowId: 'w1' },
      })
      userMessage(store, 's1', 'do it', 'u1')
      runAssistantTurn(store, 's1', 'a1', [
        { type: 'message.delta', data: { messageId: 'a1', content: 'ok' } },
        {
          type: 'tool.call',
          data: { messageId: 'a1', toolCall: { id: 'tc1', name: 'run_command', arguments: { command: 'ls' } } },
        },
      ])
      toolResult(store, 's1', 'a1', 'tc1', { success: true, output: 'file.txt' })

      const events = store.getEvents('s1')
      expect(events.map((e) => e.type)).toEqual(['session.initialized', 'message', 'message', 'tool.result'])
      const tr = events[3]!
      expect(tr.eventId).toBe('tr_tc1')
      expect(tr.data).toMatchObject({ messageId: 'a1', toolCallId: 'tc1' })
      expect((tr.data as { result: { output: string } }).result.output).toBe('file.txt')
    })

    it('stores the merged message timestamp at message START (not done)', () => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
        insertSession(db, 's1')
        store.append('s1', {
          type: 'session.initialized',
          data: { projectId: 'p', workdir: '/w', contextWindowId: 'w1' },
        })
        store.append('s1', { type: 'message.start', data: { messageId: 'a1', role: 'assistant' } })
        vi.setSystemTime(new Date('2026-01-01T00:01:00Z'))
        store.append('s1', { type: 'message.delta', data: { messageId: 'a1', content: 'streaming' } })
        vi.setSystemTime(new Date('2026-01-01T00:02:00Z'))
        store.append('s1', { type: 'message.done', data: { messageId: 'a1' } })

        const msg = store.getEvents('s1').find((e) => e.type === 'message')!
        expect(msg.timestamp).toBe(Date.parse('2026-01-01T00:00:00Z'))
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('injected messages (mid-turn user messages)', () => {
    it('persists a mid-turn injected message after the merged assistant message', () => {
      insertSession(db, 's1')
      store.append('s1', {
        type: 'session.initialized',
        data: { projectId: 'p', workdir: '/w', contextWindowId: 'w1' },
      })
      userMessage(store, 's1', 'create workspace', 'u1', { contextWindowId: 'w1' })

      store.append('s1', {
        type: 'message.start',
        data: { messageId: 'a1', role: 'assistant', contextWindowId: 'w1' },
      })
      store.append('s1', {
        type: 'tool.call',
        data: { messageId: 'a1', toolCall: { id: 'tc1', name: 'workspace', arguments: { action: 'create' } } },
      })
      // A system-reminder user message injected during tool execution.
      store.append('s1', {
        type: 'message.start',
        data: {
          messageId: 'inj1',
          role: 'user',
          content: '<system-reminder>now in workspace</system-reminder>',
          isSystemGenerated: true,
          messageKind: 'auto-prompt',
          contextWindowId: 'w1',
        },
      })
      store.append('s1', { type: 'message.done', data: { messageId: 'inj1' } })

      // In-flight view: the streaming assistant plus the complete injection.
      const inflight = store.getInflightMessages('s1')
      expect(inflight.map((m) => m.id)).toEqual(['a1', 'inj1'])
      expect(inflight[0]).toMatchObject({ role: 'assistant', isStreaming: true })
      expect(inflight[1]).toMatchObject({
        role: 'user',
        isStreaming: false,
        content: '<system-reminder>now in workspace</system-reminder>',
      })

      store.append('s1', { type: 'message.delta', data: { messageId: 'a1', content: 'done' } })
      toolResult(store, 's1', 'a1', 'tc1', { success: true, output: 'created' })
      store.append('s1', { type: 'message.done', data: { messageId: 'a1' } })
      expect(store.getInflightMessages('s1')).toHaveLength(0)

      // Path order matches the v1 live order: u1 → a1 → injected → result.
      const events = store.getEvents('s1')
      expect(events.map((e) => e.eventId)).toEqual(['evt_1', 'u1', 'a1', 'inj1', 'tr_tc1'])

      // Context parity with the v1 chunk encoding: the tool message is
      // inserted between the assistant and the injected reminder.
      expect(buildContextMessagesFromStoredEvents(events, 'w1')).toEqual([
        { role: 'user', content: 'create workspace' },
        {
          role: 'assistant',
          content: 'done',
          toolCalls: [{ id: 'tc1', name: 'workspace', arguments: { action: 'create' } }],
        },
        { role: 'tool', content: 'created', toolCallId: 'tc1' },
        { role: 'user', content: '<system-reminder>now in workspace</system-reminder>' },
      ])
    })
  })

  describe('live notification parity', () => {
    it('subscribers see the original chunk events, never the merged node', async () => {
      insertSession(db, 's1')
      store.append('s1', {
        type: 'session.initialized',
        data: { projectId: 'p', workdir: '/w', contextWindowId: 'w1' },
      })
      const { iterator, unsubscribe } = store.subscribe('s1')
      const received: string[] = []
      const consumer = (async () => {
        for await (const event of iterator) {
          received.push(event.type)
          if (received.length === 4) break
        }
      })()
      runAssistantTurn(store, 's1', 'a1', [{ type: 'message.delta', data: { messageId: 'a1', content: 'hi' } }])
      toolResult(store, 's1', 'a1', 'tc1', { success: true })
      await consumer
      unsubscribe()

      expect(received).toEqual(['message.start', 'message.delta', 'message.done', 'tool.result'])
      // No merged `message` event is ever pushed to live clients.
      expect(received).not.toContain('message')
    })

    it('exposes in-flight messages until done, then not', () => {
      insertSession(db, 's1')
      store.append('s1', {
        type: 'session.initialized',
        data: { projectId: 'p', workdir: '/w', contextWindowId: 'w1' },
      })
      store.append('s1', { type: 'message.start', data: { messageId: 'a1', role: 'assistant' } })
      store.append('s1', { type: 'message.delta', data: { messageId: 'a1', content: 'partial ' } })

      const inflight = store.getInflightMessages('s1')
      expect(inflight).toHaveLength(1)
      expect(inflight[0]).toMatchObject({ id: 'a1', role: 'assistant', content: 'partial ', isStreaming: true })

      store.append('s1', { type: 'message.done', data: { messageId: 'a1' } })
      expect(store.getInflightMessages('s1')).toHaveLength(0)
    })

    it('replays path events on subscribe(fromSeq) for reconnect catch-up', async () => {
      insertSession(db, 's1')
      store.append('s1', {
        type: 'session.initialized',
        data: { projectId: 'p', workdir: '/w', contextWindowId: 'w1' },
      })
      userMessage(store, 's1', 'one', 'u1')
      userMessage(store, 's1', 'two', 'u2')

      const { iterator, unsubscribe } = store.subscribe('s1', 2)
      const replayed: string[] = []
      const consumer = (async () => {
        for await (const event of iterator) {
          replayed.push(event.type)
          break
        }
      })()
      await consumer
      unsubscribe()
      expect(replayed[0]).toBe('message')
    })
  })

  // ============================================================================
  // Cursors, branches, forks
  // ============================================================================

  describe('cursors and branching', () => {
    function buildBaseTree(): void {
      insertSession(db, 's1')
      store.append('s1', {
        type: 'session.initialized',
        data: { projectId: 'p', workdir: '/w', contextWindowId: 'w1' },
      })
      userMessage(store, 's1', 'first', 'u1')
      runAssistantTurn(store, 's1', 'a1', [{ type: 'message.delta', data: { messageId: 'a1', content: 'ans1' } }])
    }

    it('advances the cursor (in DB and process) past every persisted node', () => {
      buildBaseTree()
      expect(store.getCursorEventId('s1')).toBe('a1')
      const row = db.prepare(`SELECT cursor_event_id FROM sessions WHERE id = ?`).get('s1') as {
        cursor_event_id: string
      }
      expect(row.cursor_event_id).toBe('a1')
    })

    it('resend creates a sibling node and moves the cursor (original branch survives)', () => {
      buildBaseTree()
      const siblingId = store.resendMessage('s1', 'u1', { content: 'first (edited)' })

      expect(store.getCursorEventId('s1')).toBe(siblingId)
      const path = store.getEvents('s1')
      const pathContents = path.map((e) => (e.type === 'message' ? (e.data as { content?: string }).content : e.type))
      expect(pathContents).toEqual(['session.initialized', 'first (edited)'])

      // The original u1 → a1 branch is still in the tree, exposed as a tip.
      const tips = store.getBranchTips('s1')
      const tipIds = tips.map((t) => t.eventId)
      expect(tipIds).toContain('a1')
      const a1Tip = tips.find((t) => t.eventId === 'a1')!
      expect(a1Tip.preview).toContain('ans1')
      expect(a1Tip.role).toBe('assistant')

      // Message count reflects the (shorter) active path.
      expect(getSessionCount(db, 's1')).toBe(1) // only the sibling message
    })

    it('normalizes lifecycle-node leaves up to their message boundary in tips', () => {
      buildBaseTree()
      store.resendMessage('s1', 'u1', { content: 'first (edited)' })
      // The sibling branch gets a reply, then a trailing lifecycle node...
      runAssistantTurn(store, 's1', 'a1e', [{ type: 'message.delta', data: { messageId: 'a1e', content: 'ans1e' } }])
      store.append('s1', { type: 'mode.changed', data: { mode: 'builder', auto: false } })
      // ...and the session switches back to the original branch, abandoning it.
      store.setCursor('s1', 'a1')

      // ...so the abandoned branch's raw leaf is the mode.changed node. The
      // tip must still point at the switchable message boundary (a1e).
      const tips = store.getBranchTips('s1')
      const tipIds = tips.map((t) => t.eventId)
      expect(tipIds).toEqual(['a1e'])
      expect(tips.find((t) => t.eventId === 'a1e')!.preview).toContain('ans1e')
      expect(tips.find((t) => t.eventId === 'a1e')!.role).toBe('assistant')
    })

    it('resend preserves attachments and context window of the original message', () => {
      buildBaseTree()
      const attachments = [
        {
          id: 'att1',
          filename: 'a.png',
          mimeType: 'image/png' as const,
          size: 10,
          data: 'data:image/png;base64,x',
        },
      ]
      const id = store.resendMessage('s1', 'u1', { attachments })
      const msg = store.getEvents('s1').find((e) => e.eventId === id)!
      expect((msg.data as { attachments?: unknown[] }).attachments).toHaveLength(1)
    })

    it('refuses to resend assistant / system-generated messages', () => {
      buildBaseTree()
      expect(() => store.resendMessage('s1', 'a1')).toThrow(/Only plain user messages/)
      userMessage(store, 's1', 'system note', 'sys1', { isSystemGenerated: true })
      expect(() => store.resendMessage('s1', 'sys1')).toThrow(/Only plain user messages/)
    })

    it('fork is O(1): shares the tree, copies no events', () => {
      buildBaseTree()
      const before = db.prepare(`SELECT COUNT(*) as n FROM events`).get() as { n: number }
      const treeId = store.getTreeId('s1')

      insertSession(db, 's2', { treeId, cursor: 'u1' })
      store.setCursor('s2', 'u1')

      const after = db.prepare(`SELECT COUNT(*) as n FROM events`).get() as { n: number }
      expect(after.n).toBe(before.n) // nothing copied

      // Fork path shares the exact same node ids as the source (no copies).
      const forkPath = store.getEvents('s2')
      const sourcePath = store.getEvents('s1')
      expect(forkPath.map((e) => e.eventId)).toEqual(sourcePath.map((e) => e.eventId).slice(0, -1))

      // The source's tail (a1) is a switchable tip from the fork.
      const tips = store.getBranchTips('s2').map((t) => t.eventId)
      expect(tips).toContain('a1')
    })

    it('setCursor validates message boundaries', () => {
      buildBaseTree()
      toolResult(store, 's1', 'a1', 'tc1', { success: true })
      expect(() => store.setCursor('s1', 'tr_tc1')).toThrow(/message boundaries/)
      expect(() => store.setCursor('s1', 'nope')).toThrow(/not found/)

      store.setCursor('s1', 'u1')
      expect(store.getCursorEventId('s1')).toBe('u1')
      expect(store.getEvents('s1').map((e) => e.type)).toEqual(['session.initialized', 'message'])
      expect(getSessionCount(db, 's1')).toBe(1)
    })

    it('maintains message_count for sessions sharing the tree', () => {
      buildBaseTree()
      const treeId = store.getTreeId('s1')
      insertSession(db, 's2', { treeId, cursor: 'u1' })
      store.setCursor('s2', 'u1')
      expect(getSessionCount(db, 's1')).toBe(2) // u1 + a1
      expect(getSessionCount(db, 's2')).toBe(1) // u1

      // A new message appended by s1 only bumps s1 (s2's cursor was not the parent).
      userMessage(store, 's1', 'second', 'u2')
      expect(getSessionCount(db, 's1')).toBe(3)
      expect(getSessionCount(db, 's2')).toBe(1)

      // A fork whose cursor IS the append parent must not be bumped: the new
      // node extends s1's path, not the fork's.
      insertSession(db, 's3', { treeId, cursor: 'u2' })
      store.setCursor('s3', 'u2')
      expect(getSessionCount(db, 's3')).toBe(3) // u1 + a1 + u2
      userMessage(store, 's1', 'third', 'u3')
      expect(getSessionCount(db, 's1')).toBe(4)
      expect(getSessionCount(db, 's3')).toBe(3) // path unchanged
    })
  })

  // ============================================================================
  // Issue #334 regression: fork of a compacted session
  // ============================================================================

  describe('compaction + fork (issue #334)', () => {
    it('fork at a closed-window message never re-injects discarded history', () => {
      insertSession(db, 's1')
      store.append('s1', {
        type: 'session.initialized',
        data: { projectId: 'p', workdir: '/w', contextWindowId: 'w1' },
      })

      // Window 1: a long old conversation.
      userMessage(store, 's1', 'OLD user message one', 'old-u1', { contextWindowId: 'w1' })
      runAssistantTurn(
        store,
        's1',
        'old-a1',
        [{ type: 'message.delta', data: { messageId: 'old-a1', content: 'OLD assistant answer one' } }],
        { contextWindowId: 'w1' },
      )

      // Compaction closes window 1 and opens window 2.
      store.append('s1', {
        type: 'context.compacted',
        data: {
          closedWindowId: 'w1',
          newWindowId: 'w2',
          beforeTokens: 50000,
          afterTokens: 2000,
          summary: 'Discussed old stuff.',
        },
      })
      userMessage(store, 's1', '[compaction summary]', 'comp-1', {
        isCompactionSummary: true,
        contextWindowId: 'w2',
      })

      // Window 2: the current conversation.
      userMessage(store, 's1', 'NEW question', 'new-u1', { contextWindowId: 'w2' })
      runAssistantTurn(
        store,
        's1',
        'new-a1',
        [{ type: 'message.delta', data: { messageId: 'new-a1', content: 'NEW answer' } }],
        { contextWindowId: 'w2' },
      )

      // Fork at the NEW question (window 2).
      const treeId = store.getTreeId('s1')
      insertSession(db, 's2', { treeId, cursor: 'new-u1' })
      store.setCursor('s2', 'new-u1')

      // The served LLM context of the fork (current window filter) contains the
      // window-2 conversation and the compaction summary — but NONE of the
      // discarded window-1 messages.
      const forkContext = buildContextMessagesFromStoredEvents(store.getEvents('s2'), 'w2', {
        includeVerifier: false,
      })
      // The fork serves exactly the window-2 prefix up to the fork point —
      // summary + the forked message, and NONE of the discarded window-1 history.
      expect(forkContext.map((m) => m.content)).toEqual(['[compaction summary]', 'NEW question'])
      const forkText = forkContext.map((m) => m.content).join('\n')
      expect(forkText).not.toContain('OLD user message one')
      expect(forkText).not.toContain('OLD assistant answer one')

      // Prefix-cache coherence: the fork's context is a byte-identical prefix
      // of the source's context.
      const sourceContext = buildContextMessagesFromStoredEvents(store.getEvents('s1'), 'w2', {
        includeVerifier: false,
      })
      expect(sourceContext.slice(0, forkContext.length)).toEqual(forkContext)

      // Fork at the last OLD message (window 1): the window-1 filter shows the
      // old conversation; the session's CURRENT window (post-compaction w2)
      // serves the same coherent context as the source — no re-injection.
      insertSession(db, 's3', { treeId, cursor: 'old-a1' })
      store.setCursor('s3', 'old-a1')
      const oldForkW1 = buildContextMessagesFromStoredEvents(store.getEvents('s3'), 'w1', {
        includeVerifier: false,
      })
      const oldW1Text = oldForkW1.map((m) => m.content).join('\n')
      expect(oldW1Text).toContain('OLD user message one')
      expect(oldW1Text).toContain('OLD assistant answer one')
      expect(oldW1Text).not.toContain('NEW question')

      // s3's path predates the compaction event — its current window is still
      // w1, so it continues the OLD conversation without window-2 content.
      expect(foldContextState(store.getEvents('s3'), 'w1').currentContextWindowId).toBe('w1')
      expect(foldContextState(store.getEvents('s2'), 'w1').currentContextWindowId).toBe('w2')
    })
  })

  // ============================================================================
  // Blob externalization
  // ============================================================================

  describe('blob externalization', () => {
    it('externalizes tool results over 256KB and hydrates byte-identically', () => {
      insertSession(db, 's1')
      store.append('s1', {
        type: 'session.initialized',
        data: { projectId: 'p', workdir: '/w', contextWindowId: 'w1' },
      })
      userMessage(store, 's1', 'big output', 'u1')
      runAssistantTurn(store, 's1', 'a1', [
        {
          type: 'tool.call',
          data: { messageId: 'a1', toolCall: { id: 'tc1', name: 'run_command', arguments: { command: 'cat big' } } },
        },
      ])
      const big = 'x'.repeat(300 * 1024)
      const result = { success: true, output: big, metadata: { durationMs: 12 } }
      toolResult(store, 's1', 'a1', 'tc1', result)

      // Persisted payload carries a blob ref, not the full content.
      const raw = db.prepare(`SELECT payload FROM events WHERE tree_id = 's1' AND event_id = 'tr_tc1'`).get() as {
        payload: string
      }
      const rawPayload = JSON.parse(raw.payload) as { result: { blobRef?: string; output?: string } }
      expect(rawPayload.result.blobRef).toBeTruthy()
      expect(rawPayload.result.output).toBeUndefined()

      // The blob stores the FULL serialized result.
      const blob = db.prepare(`SELECT content FROM blobs WHERE content_hash = ?`).get(rawPayload.result.blobRef) as {
        content: string
      }
      expect(JSON.parse(blob.content)).toEqual(result)

      // Hydration is byte-identical to the original object.
      const hydrated = store.getEvents('s1').find((e) => e.eventId === 'tr_tc1')!
      expect((hydrated.data as { result: object }).result).toEqual(result)
    })

    it('dedupes identical large results into one blob', () => {
      insertSession(db, 's1')
      store.append('s1', {
        type: 'session.initialized',
        data: { projectId: 'p', workdir: '/w', contextWindowId: 'w1' },
      })
      userMessage(store, 's1', 'one', 'u1')
      runAssistantTurn(store, 's1', 'a1', [
        { type: 'tool.call', data: { messageId: 'a1', toolCall: { id: 'tc1', name: 'run_command', arguments: {} } } },
      ])
      userMessage(store, 's1', 'two', 'u2')
      runAssistantTurn(store, 's1', 'a2', [
        { type: 'tool.call', data: { messageId: 'a2', toolCall: { id: 'tc2', name: 'run_command', arguments: {} } } },
      ])
      const big = { success: true, output: 'y'.repeat(300 * 1024) }
      toolResult(store, 's1', 'a1', 'tc1', big)
      toolResult(store, 's1', 'a2', 'tc2', big)

      const blobs = db.prepare(`SELECT COUNT(*) as n FROM blobs`).get() as { n: number }
      expect(blobs.n).toBe(1)
    })

    it('externalizes message content over 1MB and hydrates it back', () => {
      insertSession(db, 's1')
      store.append('s1', {
        type: 'session.initialized',
        data: { projectId: 'p', workdir: '/w', contextWindowId: 'w1' },
      })
      const huge = 'z'.repeat(1_100_000)
      userMessage(store, 's1', huge, 'u1')

      const raw = db.prepare(`SELECT payload FROM events WHERE tree_id = 's1' AND event_id = 'u1'`).get() as {
        payload: string
      }
      const rawPayload = JSON.parse(raw.payload) as { content: { blobRef?: string } }
      expect(rawPayload.content.blobRef).toBeTruthy()

      const hydrated = store.getEvents('s1').find((e) => e.eventId === 'u1')!
      expect((hydrated.data as { content: string }).content).toBe(huge)
    })

    it('keeps small payloads inline (no blobs)', () => {
      insertSession(db, 's1')
      store.append('s1', {
        type: 'session.initialized',
        data: { projectId: 'p', workdir: '/w', contextWindowId: 'w1' },
      })
      userMessage(store, 's1', 'small', 'u1')
      runAssistantTurn(store, 's1', 'a1', [
        { type: 'tool.call', data: { messageId: 'a1', toolCall: { id: 'tc1', name: 'read_file', arguments: {} } } },
      ])
      toolResult(store, 's1', 'a1', 'tc1', { success: true, output: 'ok' })
      const blobs = db.prepare(`SELECT COUNT(*) as n FROM blobs`).get() as { n: number }
      expect(blobs.n).toBe(0)
    })
  })

  // ============================================================================
  // updateEventPayload / prompts / tree view
  // ============================================================================

  describe('payload update and tree views', () => {
    it('updateEventPayload rewrites a node in place and invalidates caches', () => {
      insertSession(db, 's1')
      store.append('s1', {
        type: 'session.initialized',
        data: { projectId: 'p', workdir: '/w', contextWindowId: 'w1' },
      })
      userMessage(store, 's1', 'original', 'u1')
      expect((store.getEvents('s1')[1]!.data as { content: string }).content).toBe('original')

      const data = { messageId: 'u1', role: 'user', content: 'enriched', attachments: [] }
      store.updateEventPayload('s1', 'u1', data)
      expect((store.getEvents('s1')[1]!.data as { content: string }).content).toBe('enriched')
      expect(() => store.updateEventPayload('s1', 'missing', {})).toThrow(/not found/)
    })

    it('getRecentUserPrompts returns real user prompts newest-first', () => {
      vi.useFakeTimers()
      try {
        let t = Date.parse('2026-01-01T00:00:00Z')
        vi.setSystemTime(t)
        insertSession(db, 's1')
        store.append('s1', {
          type: 'session.initialized',
          data: { projectId: 'p', workdir: '/w', contextWindowId: 'w1' },
        })
        userMessage(store, 's1', 'first prompt', 'u1')
        vi.setSystemTime((t += 1000))
        userMessage(store, 's1', 'system reminder', 'sys1', { isSystemGenerated: true, messageKind: 'auto-prompt' })
        vi.setSystemTime((t += 1000))
        userMessage(store, 's1', 'second prompt', 'u2')

        const prompts = store.getRecentUserPrompts('s1', 10)
        expect(prompts.map((p) => p.content)).toEqual(['second prompt', 'first prompt'])

        // Memoized until the next append.
        vi.setSystemTime((t += 1000))
        userMessage(store, 's1', 'third prompt', 'u3')
        expect(store.getRecentUserPrompts('s1', 2).map((p) => p.content)).toEqual(['third prompt', 'second prompt'])
      } finally {
        vi.useRealTimers()
      }
    })

    it('getConversationTree returns nodes, tips and cursor', () => {
      insertSession(db, 's1')
      store.append('s1', {
        type: 'session.initialized',
        data: { projectId: 'p', workdir: '/w', contextWindowId: 'w1' },
      })
      userMessage(store, 's1', 'branch point', 'u1')
      runAssistantTurn(store, 's1', 'a1', [{ type: 'message.delta', data: { messageId: 'a1', content: 'ans1' } }])
      const sibling = store.resendMessage('s1', 'u1', { content: 'branch point v2' })

      const tree = store.getConversationTree('s1')
      expect(tree.treeId).toBe('s1')
      expect(tree.cursor).toBe(sibling)
      expect(tree.nodes.map((n) => n.eventId).sort()).toEqual([tree.nodes[0]!.eventId, 'u1', 'a1', sibling].sort())
      expect(tree.tips).toContain('a1')
      const u1Node = tree.nodes.find((n) => n.eventId === 'u1')!
      expect(u1Node.preview).toBe('branch point')
      expect(u1Node.role).toBe('user')
    })
  })

  // ============================================================================
  // Import / delete / GC
  // ============================================================================

  describe('import, delete, GC', () => {
    it('importEvents inserts v2 tree nodes; v1 (no eventId) is rejected', () => {
      insertSession(db, 's1')
      const v1Events: StoredEvent[] = [
        {
          seq: 1,
          timestamp: 1,
          sessionId: 's1',
          type: 'session.initialized',
          data: { projectId: 'p', workdir: '/w', contextWindowId: 'w1' },
        },
      ]
      expect(() => store.importEvents('s1', v1Events)).toThrow(/v2/)

      const v2: StoredEvent[] = [
        {
          seq: 1,
          timestamp: 1,
          sessionId: 'src',
          type: 'session.initialized',
          data: { projectId: 'p', workdir: '/w', contextWindowId: 'w1' },
          eventId: 'init-1',
          parentId: null,
        },
        {
          seq: 2,
          timestamp: 2,
          sessionId: 'src',
          type: 'message',
          data: { messageId: 'm1', role: 'user', content: 'imported' },
          eventId: 'm1',
          parentId: 'init-1',
        },
      ]
      const stored = store.importEvents('s1', v2)
      expect(stored).toHaveLength(2)
      store.setCursor('s1', 'm1')
      const events = store.getEvents('s1')
      expect(events.map((e) => e.type)).toEqual(['session.initialized', 'message'])
      expect((events[1]!.data as { content: string }).content).toBe('imported')
    })

    it('deleteSession removes an unowned tree (events + blobs)', () => {
      insertSession(db, 's1')
      store.append('s1', {
        type: 'session.initialized',
        data: { projectId: 'p', workdir: '/w', contextWindowId: 'w1' },
      })
      userMessage(store, 's1', 'hi', 'u1')
      runAssistantTurn(store, 's1', 'a1', [
        { type: 'tool.call', data: { messageId: 'a1', toolCall: { id: 'tc1', name: 'run_command', arguments: {} } } },
      ])
      toolResult(store, 's1', 'a1', 'tc1', { success: true, output: 'B'.repeat(300 * 1024) })
      expect((db.prepare(`SELECT COUNT(*) as n FROM events`).get() as { n: number }).n).toBeGreaterThan(0)
      expect((db.prepare(`SELECT COUNT(*) as n FROM blobs`).get() as { n: number }).n).toBe(1)

      store.deleteSession('s1')
      expect((db.prepare(`SELECT COUNT(*) as n FROM events WHERE tree_id = 's1'`).get() as { n: number }).n).toBe(0)
      expect((db.prepare(`SELECT COUNT(*) as n FROM blobs`).get() as { n: number }).n).toBe(0)
    })

    it('deleteSession keeps a shared tree (forks still reference it)', () => {
      insertSession(db, 's1')
      store.append('s1', {
        type: 'session.initialized',
        data: { projectId: 'p', workdir: '/w', contextWindowId: 'w1' },
      })
      userMessage(store, 's1', 'hi', 'u1')
      const treeId = store.getTreeId('s1')
      insertSession(db, 's2', { treeId, cursor: 'u1' })
      store.setCursor('s2', 'u1')

      store.deleteSession('s1')
      expect(
        (db.prepare(`SELECT COUNT(*) as n FROM events WHERE tree_id = ?`).get(treeId) as { n: number }).n,
      ).toBeGreaterThan(0)
      expect(store.getEvents('s2')).toHaveLength(2)
    })

    it('appends after deleteSession are no-ops (no orphan tree resurrected)', () => {
      insertSession(db, 's1')
      store.append('s1', {
        type: 'session.initialized',
        data: { projectId: 'p', workdir: '/w', contextWindowId: 'w1' },
      })
      userMessage(store, 's1', 'hi', 'u1')
      runAssistantTurn(store, 's1', 'a1', [{ type: 'message.delta', data: { messageId: 'a1', content: 'partial ' } }])
      expect((db.prepare(`SELECT COUNT(*) as n FROM events`).get() as { n: number }).n).toBeGreaterThan(0)

      store.deleteSession('s1')

      // A turn in flight at deletion time notices the abort asynchronously —
      // its late finalization appends must not recreate an orphan tree.
      store.append('s1', { type: 'message.done', data: { messageId: 'a1' } })
      store.append('s1', { type: 'chat.done', data: { messageId: 'a1', reason: 'stopped' } })
      userMessage(store, 's1', 'late', 'u2')

      expect((db.prepare(`SELECT COUNT(*) as n FROM events`).get() as { n: number }).n).toBe(0)
      expect(store.getEvents('s1')).toEqual([])
    })

    it('gcDeadBranches reclaims unreferenced branches and their exclusive blobs', () => {
      insertSession(db, 's1')
      store.append('s1', {
        type: 'session.initialized',
        data: { projectId: 'p', workdir: '/w', contextWindowId: 'w1' },
      })
      userMessage(store, 's1', 'anchor', 'u1')
      runAssistantTurn(store, 's1', 'a1', [
        { type: 'tool.call', data: { messageId: 'a1', toolCall: { id: 'tc1', name: 'run_command', arguments: {} } } },
      ])
      toolResult(store, 's1', 'a1', 'tc1', { success: true, output: 'dead-blob'.repeat(50_000) })

      // Branch away: sibling resend orphans a1 + its tool result.
      const sibling = store.resendMessage('s1', 'u1', { content: 'anchor v2' })

      // New live branch: another assistant turn under the sibling, carrying a
      // DIFFERENT large result (its blob must survive GC).
      runAssistantTurn(store, 's1', 'a2', [
        { type: 'tool.call', data: { messageId: 'a2', toolCall: { id: 'tc2', name: 'run_command', arguments: {} } } },
      ])
      toolResult(store, 's1', 'a2', 'tc2', { success: true, output: 'live-blob'.repeat(50_000) })

      const before = db.prepare(`SELECT COUNT(*) as n FROM events WHERE tree_id = 's1'`).get() as { n: number }
      expect((db.prepare(`SELECT COUNT(*) as n FROM blobs`).get() as { n: number }).n).toBe(2)

      const report = store.gcDeadBranches()
      // Dead nodes: u1 + a1 + tr_tc1 (the abandoned branch, incl. the
      // original message — the sibling replaced it at the same parent).
      expect(report.eventsDeleted).toBe(3)
      expect(report.blobsDeleted).toBe(1) // the dead branch's exclusive blob
      expect(getSessionCount(db, 's1')).toBe(2) // sibling, a2 — stable through GC

      const after = db.prepare(`SELECT COUNT(*) as n FROM events WHERE tree_id = 's1'`).get() as { n: number }
      expect(after.n).toBe(before.n - report.eventsDeleted)
      // Live path still hydrates from its blob.
      const livePath = store.getEvents('s1')
      expect(livePath.map((e) => e.eventId)).toContain(sibling)
      const trLive = livePath.find((e) => e.eventId === 'tr_tc2')
      expect(trLive).toBeDefined()
      expect((trLive!.data as { result: { output: string } }).result.output).toContain('live-blob')
    })

    it('gcDeadBranches honors the grace period for recent dead branches', () => {
      insertSession(db, 's1')
      store.append('s1', {
        type: 'session.initialized',
        data: { projectId: 'p', workdir: '/w', contextWindowId: 'w1' },
      })
      userMessage(store, 's1', 'anchor', 'u1')
      runAssistantTurn(store, 's1', 'a1', [{ type: 'message.delta', data: { messageId: 'a1', content: 'x' } }])
      store.resendMessage('s1', 'u1', { content: 'anchor v2' }) // orphans a1 (just now)

      const recent = store.gcDeadBranches(24 * 60 * 60 * 1000)
      expect(recent.eventsDeleted).toBe(0) // fresh orphan — still switchable

      // Age the WHOLE dead branch past the grace period (grace is keyed on the
      // newest dead node); a fresh store (post-restart) re-reads the rows.
      db.prepare(`UPDATE events SET timestamp = ? WHERE tree_id = 's1' AND event_id IN ('u1', 'a1')`).run(
        Date.now() - 8 * 24 * 60 * 60 * 1000,
      )
      const freshStore = new EventStore(db)
      const aged = freshStore.gcDeadBranches(24 * 60 * 60 * 1000)
      expect(aged.eventsDeleted).toBe(2)
    })

    it('gcDeadBranches reclaims orphaned trees in full', () => {
      insertSession(db, 's1')
      store.append('s1', {
        type: 'session.initialized',
        data: { projectId: 'p', workdir: '/w', contextWindowId: 'w1' },
      })
      userMessage(store, 's1', 'hi', 'u1')

      // Simulate an orphaned tree: events exist, no session row references it.
      db.prepare(`DELETE FROM sessions WHERE id = 's1'`).run()
      const report = store.gcDeadBranches()
      expect(report.trees).toBe(1)
      expect(report.eventsDeleted).toBe(2)
      expect((db.prepare(`SELECT COUNT(*) as n FROM events WHERE tree_id = 's1'`).get() as { n: number }).n).toBe(0)
    })
  })

  // ============================================================================
  // initEventStore boot hygiene
  // ============================================================================

  describe('initEventStore boot hygiene', () => {
    it('resets stale running sessions and rejects stale confirmations (path-scoped)', async () => {
      const bootDb = new Database(':memory:')
      bootDb.exec(SESSIONS_TABLE)
      insertSession(bootDb, 'stale-1')
      const warm = new EventStore(bootDb)
      warm.append('stale-1', {
        type: 'session.initialized',
        data: { projectId: 'p', workdir: '/w', contextWindowId: 'w1' },
      })
      warm.append('stale-1', { type: 'running.changed', data: { isRunning: true } })
      warm.append('stale-1', {
        type: 'path.confirmation_pending',
        data: { callId: 'c1', tool: 'read_file', paths: ['/etc/passwd'], workdir: '/w', reason: 'sensitive_file' },
      })
      warm.append('stale-1', { type: 'running.changed', data: { isRunning: true } })
      // The store's DB cursor writes go through the app database — in fixtures
      // we set the sessions-table cursor directly (the new store reads it).
      const lastSeq = warm.getLatestSeq('stale-1')
      bootDb
        .prepare(`UPDATE sessions SET is_running = 1, cursor_event_id = ? WHERE id = 'stale-1'`)
        .run(`evt_${lastSeq}`)

      const booted = initEventStore(bootDb)
      expect(booted).toBeInstanceOf(EventStore)

      // is_running reset synchronously.
      const running = (
        bootDb.prepare(`SELECT is_running FROM sessions WHERE id = 'stale-1'`).get() as {
          is_running: number
        }
      ).is_running
      expect(running).toBe(0)

      // Hygiene runs on setImmediate — flush the loop.
      await new Promise((r) => setTimeout(r, 20))
      expect(getStaleRunningSessionIds()).toEqual(['stale-1'])
      const events = booted.getEvents('stale-1')
      const lastRunning = [...events].reverse().find((e) => e.type === 'running.changed')!
      expect((lastRunning.data as { isRunning: boolean }).isRunning).toBe(false)
      const responded = events.find((e) => e.type === 'path.confirmation_responded')!
      expect((responded.data as { callId: string; approved: boolean }).callId).toBe('c1')
      expect((responded.data as { approved: boolean }).approved).toBe(false)
      bootDb.close()
    })
  })
})
