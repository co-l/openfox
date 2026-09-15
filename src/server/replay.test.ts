/**
 * POST /api/sessions/:id/replay — edit & resend (v3 conversation tree).
 *
 * The route delegates to sessionManager.resendMessage, which persists a
 * SIBLING message node (same parent, fresh id), moves the cursor to it, and
 * queues the turn with the existing id. The original branch stays
 * switchable (non-destructive). This file covers the route wiring: body
 * validation, error mapping, and response shape.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import type { SessionManager } from './session/manager.js'

function mountReplayRoute(
  app: express.Express,
  deps: {
    sessionManager: Pick<SessionManager, 'getSession' | 'resendMessage' | 'queueMessage' | 'getQueueState'>
  },
) {
  app.use(express.json())

  app.post('/api/sessions/:id/replay', async (req, res) => {
    const sessionId = req.params.id as string
    const session = deps.sessionManager.getSession(sessionId)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const { messageId, content, attachments } = req.body
    if (typeof messageId !== 'string' || !messageId) {
      return res.status(400).json({ error: 'messageId is required' })
    }
    if (content !== undefined && (typeof content !== 'string' || !content.trim())) {
      return res.status(400).json({ error: 'content must be a non-empty string if provided' })
    }
    if (attachments !== undefined && !Array.isArray(attachments)) {
      return res.status(400).json({ error: 'attachments must be an array if provided' })
    }

    // resendMessage persists the sibling AND queues the turn (with the
    // existing id, so the processor does not re-add the message).
    let siblingId: string
    try {
      siblingId = deps.sessionManager.resendMessage(sessionId, messageId, {
        ...(content !== undefined ? { content } : {}),
        ...(attachments !== undefined ? { attachments } : {}),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('not found')) {
        return res.status(404).json({ error: message })
      }
      return res.status(400).json({ error: message })
    }

    res.json({ success: true, messageId: siblingId, queueState: deps.sessionManager.getQueueState(sessionId) })
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

describe('Replay endpoint (edit & resend)', () => {
  let app: express.Express
  let server: Server
  let port: number
  let sessionManager: {
    getSession: ReturnType<typeof vi.fn>
    resendMessage: ReturnType<typeof vi.fn>
    queueMessage: ReturnType<typeof vi.fn>
    getQueueState: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    sessionManager = {
      getSession: vi.fn(),
      resendMessage: vi.fn(() => 'sib-1'),
      queueMessage: vi.fn(),
      getQueueState: vi.fn(() => [{ id: 'q-1', content: 'resent message' }]),
    }

    app = express()
    mountReplayRoute(app, {
      sessionManager: sessionManager as unknown as Pick<
        SessionManager,
        'getSession' | 'resendMessage' | 'queueMessage' | 'getQueueState'
      >,
    })

    server = createServer(app)
    await new Promise<void>((resolve) => server.listen(0, () => resolve()))
    port = (server.address() as { port: number }).port
  })

  afterEach(async () => {
    await closeServer(server)
  })

  function url(path: string): string {
    return `http://127.0.0.1:${port}${path}`
  }

  function post(body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
    return fetchJson(url('/api/sessions/session-1/replay'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('returns 404 if session not found', async () => {
    sessionManager.getSession.mockReturnValue(null)

    const { status } = await post({ messageId: 'msg-1' })
    expect(status).toBe(404)
    expect(sessionManager.resendMessage).not.toHaveBeenCalled()
  })

  it('returns 400 if messageId is missing', async () => {
    sessionManager.getSession.mockReturnValue({ id: 'session-1' })

    const { status, body } = await post({})
    expect(status).toBe(400)
    expect(body).toEqual({ error: 'messageId is required' })
  })

  it('returns 400 if messageId is not a string', async () => {
    sessionManager.getSession.mockReturnValue({ id: 'session-1' })

    const { status, body } = await post({ messageId: 123 })
    expect(status).toBe(400)
    expect(body).toEqual({ error: 'messageId is required' })
  })

  it('returns 400 for an empty-string edit', async () => {
    sessionManager.getSession.mockReturnValue({ id: 'session-1' })

    const { status, body } = await post({ messageId: 'user-1', content: '   ' })
    expect(status).toBe(400)
    expect(body).toEqual({ error: 'content must be a non-empty string if provided' })
  })

  it('returns 400 if attachments is not an array', async () => {
    sessionManager.getSession.mockReturnValue({ id: 'session-1' })

    const { status, body } = await post({ messageId: 'msg-1', attachments: 'not-an-array' })
    expect(status).toBe(400)
    expect(body).toEqual({ error: 'attachments must be an array if provided' })
  })

  it('maps a not-found message to 404', async () => {
    sessionManager.getSession.mockReturnValue({ id: 'session-1' })
    sessionManager.resendMessage.mockImplementation((_id: string, messageId: string) => {
      throw new Error(`Message ${messageId} not found`)
    })

    const { status, body } = await post({ messageId: 'nonexistent' })
    expect(status).toBe(404)
    expect(body).toEqual({ error: 'Message nonexistent not found' })
  })

  it('maps assistant messages to 400 (only plain user messages can be resent)', async () => {
    sessionManager.getSession.mockReturnValue({ id: 'session-1' })
    sessionManager.resendMessage.mockImplementation((_id: string, messageId: string) => {
      if (messageId === 'assistant-1') throw new Error('Only plain user messages can be resent')
      return 'sib-1'
    })

    const { status, body } = await post({ messageId: 'assistant-1' })
    expect(status).toBe(400)
    expect(body).toEqual({ error: 'Only plain user messages can be resent' })
  })

  it('maps system-generated messages to 400', async () => {
    sessionManager.getSession.mockReturnValue({ id: 'session-1' })
    sessionManager.resendMessage.mockImplementation((_id: string, messageId: string) => {
      if (messageId === 'sys-1') throw new Error('Only plain user messages can be resent')
      return 'sib-1'
    })

    const { status, body } = await post({ messageId: 'sys-1' })
    expect(status).toBe(400)
    expect(body).toEqual({ error: 'Only plain user messages can be resent' })
  })

  it('resends without edits (sibling keeps the original content) and reports the queue', async () => {
    sessionManager.getSession.mockReturnValue({ id: 'session-1' })
    sessionManager.resendMessage.mockReturnValue('sib-2')

    const { status, body } = await post({ messageId: 'user-2' })
    expect(status).toBe(200)
    expect(body).toEqual({
      success: true,
      messageId: 'sib-2',
      queueState: [{ id: 'q-1', content: 'resent message' }],
    })
    expect(sessionManager.resendMessage).toHaveBeenCalledWith('session-1', 'user-2', {})
  })

  it('passes an edited content to the resend', async () => {
    sessionManager.getSession.mockReturnValue({ id: 'session-1' })

    const { status } = await post({ messageId: 'user-1', content: 'Edited question' })
    expect(status).toBe(200)
    expect(sessionManager.resendMessage).toHaveBeenCalledWith('session-1', 'user-1', {
      content: 'Edited question',
    })
  })

  it('passes an explicit empty attachments array (removes the original ones)', async () => {
    sessionManager.getSession.mockReturnValue({ id: 'session-1' })

    const { status } = await post({ messageId: 'user-att', content: 'No attachment now', attachments: [] })
    expect(status).toBe(200)
    expect(sessionManager.resendMessage).toHaveBeenCalledWith('session-1', 'user-att', {
      content: 'No attachment now',
      attachments: [],
    })
  })

  it('resends the first message of the session', async () => {
    sessionManager.getSession.mockReturnValue({ id: 'session-1' })
    sessionManager.resendMessage.mockReturnValue('sib-first')

    const { status, body } = await post({ messageId: 'first-msg' })
    expect(status).toBe(200)
    expect(body).toEqual({
      success: true,
      messageId: 'sib-first',
      queueState: [{ id: 'q-1', content: 'resent message' }],
    })
  })
})
