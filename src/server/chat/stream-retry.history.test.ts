/**
 * LLM Retry – History Semantics (real EventStore)
 *
 * streamLLMPure is a live single-attempt generator. Two failure shapes:
 *   - Case 1: the request fails before any content → nothing is emitted,
 *     so the event store is untouched (the caller retries the same request).
 *   - Case 2: the request fails mid-stream → the partial content is streamed
 *     live and stays in the store (the caller keeps it and appends a
 *     continuation). Nothing is ever tombstoned or removed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import type { LLMStreamEvent } from '../llm/types.js'
import { EventStore } from '../events/store.js'
import { consumeStreamGenerator, streamLLMPure } from './stream-pure.js'

function createClient(events: LLMStreamEvent[]) {
  return {
    complete: async () => {
      throw new Error('Not implemented')
    },
    getModel: () => 'test-model',
    getProfile: () => ({}) as never,
    getBackend: () => 'unknown' as const,
    setBackend: () => {},
    setModel: () => {},
    stream: async function* () {
      for (const event of events) {
        yield event
      }
    },
  }
}

describe('streamLLMPure history semantics (real EventStore)', () => {
  let db: Database.Database
  let store: EventStore

  beforeEach(() => {
    vi.restoreAllMocks()
    db = new Database(':memory:')
    store = new EventStore(db)
    db.exec(
      `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, is_running INTEGER DEFAULT 0, updated_at INTEGER)`,
    )
  })

  afterEach(() => {
    db.close()
  })

  it('case 1 — leaves the store completely untouched when the request fails before any content', async () => {
    store.append('session-1', { type: 'message.start', data: { messageId: 'seed-1', role: 'user', content: 'hi' } })
    store.append('session-1', { type: 'message.done', data: { messageId: 'seed-1' } })
    const before = store.getEvents('session-1').length

    const client = createClient([{ type: 'error', error: 'boom' }])

    const gen = streamLLMPure({
      messageId: 'assistant-1',
      systemPrompt: 'system',
      llmClient: client,
      messages: [{ role: 'user', content: 'hi' }],
    })

    const result = await consumeStreamGenerator(gen, (event) => {
      store.append('session-1', event)
    })

    expect(result.error).toBe('boom')
    expect(store.getEvents('session-1').length).toBe(before)
  })

  it('case 2 — keeps the streamed partial content in the store (no chat.error, no removal)', async () => {
    store.append('session-1', { type: 'message.start', data: { messageId: 'seed-1', role: 'user', content: 'hi' } })
    store.append('session-1', { type: 'message.done', data: { messageId: 'seed-1' } })

    const client = createClient([
      { type: 'text_delta', content: 'partial ' },
      { type: 'thinking_delta', content: 'thinking so far' },
      { type: 'error', error: 'boom' },
    ])

    const gen = streamLLMPure({
      messageId: 'assistant-1',
      systemPrompt: 'system',
      llmClient: client,
      messages: [{ role: 'user', content: 'hi' }],
    })

    const result = await consumeStreamGenerator(gen, (event) => {
      store.append('session-1', event)
    })

    expect(result.error).toBe('boom')
    const remaining = store.getEvents('session-1')
    // Seed + the partial content, exactly as streamed — nothing removed
    expect(remaining.map((e) => e.type)).toEqual(['message.start', 'message.done', 'message.delta', 'message.thinking'])
    expect((remaining[2]!.data as { content: string }).content).toBe('partial ')
    expect((remaining[3]!.data as { content: string }).content).toBe('thinking so far')
    expect(remaining.some((e) => e.type === 'chat.error')).toBe(false)
  })
})
