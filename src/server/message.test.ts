import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import type { SessionManager } from './session/manager.js'

function mountMessageRoute(
  app: express.Express,
  deps: {
    sessionManager: Pick<SessionManager, 'getSession' | 'queueMessage' | 'getQueueState'>
  },
) {
  app.use(express.json())

  app.post('/api/sessions/:id/message', (req, res) => {
    const sessionId = req.params.id
    const session = deps.sessionManager.getSession(sessionId)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const { content, attachments, messageKind } = req.body
    const hasContent = content?.trim()
    const hasAttachments = Array.isArray(attachments) && attachments.length > 0
    if (!hasContent && !hasAttachments) {
      return res.status(400).json({ error: 'content or attachments is required' })
    }

    deps.sessionManager.queueMessage(sessionId, 'asap', content, attachments, messageKind)

    res.json({ success: true, queueState: deps.sessionManager.getQueueState(sessionId) })
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

describe('POST /api/sessions/:id/message', () => {
  let app: express.Express
  let server: Server
  let port: number
  let sessionManager: {
    getSession: ReturnType<typeof vi.fn>
    queueMessage: ReturnType<typeof vi.fn>
    getQueueState: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    sessionManager = {
      getSession: vi.fn(),
      queueMessage: vi.fn(),
      getQueueState: vi.fn().mockReturnValue([]),
    }

    app = express()
    mountMessageRoute(app, {
      sessionManager: sessionManager as unknown as Pick<
        SessionManager,
        'getSession' | 'queueMessage' | 'getQueueState'
      >,
    })

    server = createServer(app)
    await new Promise<void>((resolve) => server.listen(0, () => resolve()))
    port = (server.address() as { port: number }).port
  })

  afterEach(async () => {
    await closeServer(server)
  })

  it('accepts a message with content only', async () => {
    sessionManager.getSession.mockReturnValue({ id: 'session-1' })

    const { status, body } = await fetchJson(`http://localhost:${port}/api/sessions/session-1/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'hello' }),
    })

    expect(status).toBe(200)
    expect(body).toMatchObject({ success: true })
    expect(sessionManager.queueMessage).toHaveBeenCalledWith('session-1', 'asap', 'hello', undefined, undefined)
  })

  it('accepts a message with attachments only (no content)', async () => {
    sessionManager.getSession.mockReturnValue({ id: 'session-1' })
    const attachments = [{ id: 'att-1', filename: 'img.png', data: 'base64data', mimeType: 'image/png', size: 1024 }]

    const { status } = await fetchJson(`http://localhost:${port}/api/sessions/session-1/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attachments }),
    })

    expect(status).toBe(200)
    expect(sessionManager.queueMessage).toHaveBeenCalledWith('session-1', 'asap', undefined, attachments, undefined)
  })

  it('accepts a message with both content and attachments', async () => {
    sessionManager.getSession.mockReturnValue({ id: 'session-1' })
    const attachments = [{ id: 'att-1', filename: 'img.png', data: 'base64data', mimeType: 'image/png', size: 1024 }]

    const { status } = await fetchJson(`http://localhost:${port}/api/sessions/session-1/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'look at this', attachments }),
    })

    expect(status).toBe(200)
    expect(sessionManager.queueMessage).toHaveBeenCalledWith(
      'session-1',
      'asap',
      'look at this',
      attachments,
      undefined,
    )
  })

  it('rejects a message with neither content nor attachments', async () => {
    sessionManager.getSession.mockReturnValue({ id: 'session-1' })

    const { status, body } = await fetchJson(`http://localhost:${port}/api/sessions/session-1/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(status).toBe(400)
    expect(body).toMatchObject({ error: 'content or attachments is required' })
    expect(sessionManager.queueMessage).not.toHaveBeenCalled()
  })

  it('rejects a message with only whitespace content and no attachments', async () => {
    sessionManager.getSession.mockReturnValue({ id: 'session-1' })

    const { status } = await fetchJson(`http://localhost:${port}/api/sessions/session-1/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '   ' }),
    })

    expect(status).toBe(400)
    expect(sessionManager.queueMessage).not.toHaveBeenCalled()
  })

  it('returns 404 for non-existent session', async () => {
    sessionManager.getSession.mockReturnValue(null)

    const { status, body } = await fetchJson(`http://localhost:${port}/api/sessions/session-1/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'hello' }),
    })

    expect(status).toBe(404)
    expect(body).toMatchObject({ error: 'Session not found' })
  })
})
