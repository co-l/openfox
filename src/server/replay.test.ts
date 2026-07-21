import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import Database from 'better-sqlite3'
import { EventStore, initEventStore, getEventStore } from './events/store.js'
import type { SessionManager } from './session/manager.js'

function mountReplayRoute(
  app: express.Express,
  deps: {
    sessionManager: Pick<SessionManager, 'getSession' | 'queueMessage'>
  },
) {
  app.use(express.json())

  app.post('/api/sessions/:id/replay', async (req, res) => {
    const sessionId = req.params.id as string
    const session = deps.sessionManager.getSession(sessionId)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const { messageId } = req.body
    if (typeof messageId !== 'string' || !messageId) {
      return res.status(400).json({ error: 'messageId is required' })
    }

    const { getEventStore } = await import('./events/index.js')
    const { buildMessagesFromStoredEvents } = await import('./events/folding.js')
    const eventStore = getEventStore()
    const events = eventStore.getEvents(sessionId)
    const { messages } = buildMessagesFromStoredEvents(events)

    const msgIndex = messages.findIndex((m) => m.id === messageId)
    if (msgIndex === -1) {
      return res.status(400).json({ error: 'Message not found' })
    }

    const msg = messages[msgIndex]!
    if (msg.role !== 'user' || msg.isSystemGenerated) {
      return res.status(400).json({ error: 'Can only replay user messages' })
    }

    const { truncateSessionMessages } = await import('./events/index.js')
    truncateSessionMessages(sessionId, msgIndex - 1)

    deps.sessionManager.queueMessage(sessionId, 'asap', msg.content, msg.attachments, msg.messageKind)

    res.json({ success: true })
  })
}

async function fetchJson(url: string, options?: RequestInit): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, options)
  const body = await response.json()
  return { status: response.status, body }
}

async function closeServer(srv: Server): Promise<void> {
  return new Promise((resolve) => srv.close(() => resolve()))
}

describe('Replay endpoint', () => {
  let db: Database.Database
  let eventStore: EventStore
  let app: express.Express
  let server: Server
  let port: number
  let sessionManager: {
    getSession: ReturnType<typeof vi.fn>
    queueMessage: ReturnType<typeof vi.fn>
  }
  let append: (event: import('./events/types.js').TurnEvent) => void

  beforeEach(async () => {
    db = new Database(':memory:')
    db.exec(`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, is_running INTEGER DEFAULT 0)`)
    initEventStore(db)
    eventStore = getEventStore()
    append = (event) => eventStore.append('session-1', event)

    sessionManager = {
      getSession: vi.fn(),
      queueMessage: vi.fn(),
    }

    app = express()
    mountReplayRoute(app, {
      sessionManager: sessionManager as unknown as Pick<SessionManager, 'getSession' | 'queueMessage'>,
    })

    server = createServer(app)
    await new Promise<void>((resolve) => server.listen(0, () => resolve()))
    port = (server.address() as { port: number }).port
  })

  afterEach(async () => {
    await closeServer(server)
    db.close()
  })

  function url(path: string): string {
    return `http://127.0.0.1:${port}${path}`
  }

  it('returns 404 if session not found', async () => {
    sessionManager.getSession.mockReturnValue(null)

    const { status } = await fetchJson(url('/api/sessions/nonexistent/replay'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: 'msg-1' }),
    })
    expect(status).toBe(404)
  })

  it('returns 400 if messageId is missing', async () => {
    sessionManager.getSession.mockReturnValue({ id: 'session-1', messages: [] })

    const { status, body } = await fetchJson(url('/api/sessions/session-1/replay'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(status).toBe(400)
    expect(body).toEqual({ error: 'messageId is required' })
  })

  it('returns 400 if messageId is not a string', async () => {
    sessionManager.getSession.mockReturnValue({ id: 'session-1', messages: [] })

    const { status, body } = await fetchJson(url('/api/sessions/session-1/replay'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: 123 }),
    })
    expect(status).toBe(400)
    expect(body).toEqual({ error: 'messageId is required' })
  })

  it('returns 400 if message not found', async () => {
    sessionManager.getSession.mockReturnValue({ id: 'session-1', messages: [] })

    const { status, body } = await fetchJson(url('/api/sessions/session-1/replay'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: 'nonexistent' }),
    })
    expect(status).toBe(400)
    expect(body).toEqual({ error: 'Message not found' })
  })

  it('returns 400 if message is an assistant message', async () => {
    sessionManager.getSession.mockReturnValue({ id: 'session-1', messages: [] })

    // Initialize session and add an assistant message
    append({ type: 'session.initialized', data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' } })
    append({
      type: 'message.start',
      data: { messageId: 'assistant-1', role: 'assistant', content: 'Hello!' },
    })
    append({ type: 'message.done', data: { messageId: 'assistant-1' } })

    const { status, body } = await fetchJson(url('/api/sessions/session-1/replay'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: 'assistant-1' }),
    })
    expect(status).toBe(400)
    expect(body).toEqual({ error: 'Can only replay user messages' })
  })

  it('returns 400 if message is system-generated', async () => {
    sessionManager.getSession.mockReturnValue({ id: 'session-1', messages: [] })

    append({ type: 'session.initialized', data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' } })
    append({
      type: 'message.start',
      data: { messageId: 'sys-1', role: 'user', content: 'auto prompt', isSystemGenerated: true },
    })
    append({ type: 'message.done', data: { messageId: 'sys-1' } })

    const { status, body } = await fetchJson(url('/api/sessions/session-1/replay'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: 'sys-1' }),
    })
    expect(status).toBe(400)
    expect(body).toEqual({ error: 'Can only replay user messages' })
  })

  it('successfully replays a user message', async () => {
    sessionManager.getSession.mockReturnValue({ id: 'session-1', messages: [] })
    sessionManager.queueMessage.mockReturnValue({ queueId: 'q-1' })

    // Initialize session and add messages
    append({ type: 'session.initialized', data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' } })
    append({
      type: 'message.start',
      data: { messageId: 'user-1', role: 'user', content: 'First message' },
    })
    append({ type: 'message.done', data: { messageId: 'user-1' } })
    append({
      type: 'message.start',
      data: { messageId: 'assistant-1', role: 'assistant', content: 'First response' },
    })
    append({ type: 'message.done', data: { messageId: 'assistant-1' } })
    append({
      type: 'message.start',
      data: { messageId: 'user-2', role: 'user', content: 'Second message' },
    })
    append({ type: 'message.done', data: { messageId: 'user-2' } })

    const { status, body } = await fetchJson(url('/api/sessions/session-1/replay'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: 'user-2' }),
    })
    expect(status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(sessionManager.queueMessage).toHaveBeenCalledWith(
      'session-1',
      'asap',
      'Second message',
      undefined,
      undefined,
    )
  })

  it('handles multi-window sessions correctly', async () => {
    sessionManager.getSession.mockReturnValue({ id: 'session-1', messages: [] })
    sessionManager.queueMessage.mockReturnValue({ queueId: 'q-1' })

    // Window 1 messages
    append({ type: 'session.initialized', data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' } })
    append({
      type: 'message.start',
      data: { messageId: 'w1-user-1', role: 'user', content: 'Window 1 message', contextWindowId: 'window-1' },
    })
    append({ type: 'message.done', data: { messageId: 'w1-user-1' } })

    // Compaction creates window 2
    append({
      type: 'context.compacted',
      data: {
        closedWindowId: 'window-1',
        newWindowId: 'window-2',
        beforeTokens: 1000,
        afterTokens: 100,
        summary: 'compacted',
      },
    })

    // Window 2 messages
    append({
      type: 'message.start',
      data: { messageId: 'w2-user-1', role: 'user', content: 'Window 2 message', contextWindowId: 'window-2' },
    })
    append({ type: 'message.done', data: { messageId: 'w2-user-1' } })
    append({
      type: 'message.start',
      data: {
        messageId: 'w2-assistant-1',
        role: 'assistant',
        content: 'Window 2 response',
        contextWindowId: 'window-2',
      },
    })
    append({ type: 'message.done', data: { messageId: 'w2-assistant-1' } })

    const { status, body } = await fetchJson(url('/api/sessions/session-1/replay'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: 'w2-user-1' }),
    })
    expect(status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(sessionManager.queueMessage).toHaveBeenCalledWith(
      'session-1',
      'asap',
      'Window 2 message',
      undefined,
      undefined,
    )
  })

  it('handles replaying the first message (index 0)', async () => {
    sessionManager.getSession.mockReturnValue({ id: 'session-1', messages: [] })
    sessionManager.queueMessage.mockReturnValue({ queueId: 'q-1' })

    append({ type: 'session.initialized', data: { projectId: 'p1', workdir: '/tmp', contextWindowId: 'window-1' } })
    append({
      type: 'message.start',
      data: { messageId: 'first-msg', role: 'user', content: 'First ever message' },
    })
    append({ type: 'message.done', data: { messageId: 'first-msg' } })
    append({
      type: 'message.start',
      data: { messageId: 'resp-1', role: 'assistant', content: 'Response' },
    })
    append({ type: 'message.done', data: { messageId: 'resp-1' } })

    const { status, body } = await fetchJson(url('/api/sessions/session-1/replay'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: 'first-msg' }),
    })
    expect(status).toBe(200)
    expect(body).toEqual({ success: true })
    // Should truncate everything (msgIndex - 1 = -1, keeps 0 messages) and re-queue
    expect(sessionManager.queueMessage).toHaveBeenCalledWith(
      'session-1',
      'asap',
      'First ever message',
      undefined,
      undefined,
    )
  })
})
