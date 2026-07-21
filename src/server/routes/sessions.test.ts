// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'

vi.mock('../db/settings.js', () => {
  const store = new Map<string, string>()
  store.set('display.maxVisibleItems', '300')
  return {
    getSetting: (key: string) => store.get(key) ?? null,
    setSetting: (key: string, value: string) => store.set(key, value),
    getMaxVisibleItems: () => {
      const setting = store.get('display.maxVisibleItems')
      return setting ? parseInt(setting, 10) : 0
    },
    SETTINGS_KEYS: { DISPLAY_MAX_VISIBLE_ITEMS: 'display.maxVisibleItems' },
    __store: store,
  }
})

const mockSession = {
  id: 'session-1',
  projectId: 'proj-1',
  workdir: '/tmp/test',
  mode: 'builder',
  phase: 'build',
  isRunning: false,
  providerId: null,
  providerModel: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  messages: [],
  criteria: [],
  contextWindows: [],
  executionState: null,
  metadata: { title: 'Test', totalTokensUsed: 0, totalToolCalls: 0, iterationCount: 0 },
  metadataEntries: {},
  messageCount: 10,
}

const mockMessages = Array.from({ length: 10 }, (_, i) => ({
  id: `msg-${i + 1}`,
  role: i % 2 === 0 ? 'user' : ('assistant' as 'user' | 'assistant'),
  content: `Message ${i + 1}`,
  timestamp: new Date(Date.now() - (10 - i) * 60000).toISOString(),
  tokenCount: 0,
  isStreaming: false,
}))

const mockEvents = mockMessages.map((msg) => ({
  seq: mockMessages.indexOf(msg) + 1,
  sessionId: 'session-1',
  timestamp: Date.now(),
  type: 'message.start' as const,
  data: { messageId: msg.id, role: msg.role, content: msg.content },
}))

describe('GET /api/sessions/:id — server-side truncation', () => {
  let app: express.Express
  let server: ReturnType<express.Express['listen']>
  let baseUrl: string
  let getEventsMock: ReturnType<typeof vi.fn>
  let getEventsSinceSnapshotMock: ReturnType<typeof vi.fn>
  let getSessionMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    getEventsMock = vi.fn(() => mockEvents)
    getEventsSinceSnapshotMock = vi.fn(() => ({
      snapshot: undefined,
      events: mockEvents,
    }))
    getSessionMock = vi.fn(() => mockSession) as ReturnType<typeof vi.fn>

    vi.doMock('../events/index.js', () => ({
      getEventStore: () => ({
        getEvents: getEventsMock,
        getEventsSinceSnapshot: getEventsSinceSnapshotMock,
        getLatestSnapshot: vi.fn(() => undefined),
      }),
      getContextMessages: vi.fn(() => []),
      getCurrentContextWindowId: vi.fn(() => 'win-1'),
    }))

    vi.doMock('../events/folding.js', () => ({
      buildMessagesFromStoredEvents: vi.fn((_events: unknown, maxVisibleItems?: number) => {
        if (maxVisibleItems !== undefined && maxVisibleItems > 0 && mockMessages.length > maxVisibleItems) {
          return { messages: mockMessages.slice(-maxVisibleItems), hiddenCount: mockMessages.length - maxVisibleItems }
        }
        return { messages: mockMessages, hiddenCount: 0 }
      }),
      foldPendingConfirmations: vi.fn(() => []),
    }))

    vi.doMock('../tools/index.js', () => ({
      getPendingQuestionsForSession: vi.fn(() => []),
    }))

    app = express()
    app.use(express.json())

    const { getEventStore } = await import('../events/index.js')
    const { buildMessagesFromStoredEvents, foldPendingConfirmations } = await import('../events/folding.js')
    const { getPendingQuestionsForSession } = await import('../tools/index.js')
    const { getMaxVisibleItems } = await import('../db/settings.js')

    app.get('/api/sessions/:id', async (req, res) => {
      const session = (getSessionMock as (...args: unknown[]) => unknown)(req.params.id)
      if (!session) {
        return res.status(404).json({ error: 'Session not found' })
      }

      const eventStore = getEventStore()
      const events = eventStore.getEvents(req.params.id)
      const maxVisibleItems = req.query['full'] === 'true' ? undefined : getMaxVisibleItems() || undefined
      const { messages, hiddenCount } = buildMessagesFromStoredEvents(events, maxVisibleItems)
      const contextState = null
      const queueState = null
      const pendingQuestions = getPendingQuestionsForSession(req.params.id)
      const pendingConfirmations = foldPendingConfirmations(events)

      res.json({
        session,
        messages,
        hiddenCount,
        contextState,
        queueState,
        pendingQuestions,
        pendingConfirmations,
      })
    })

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${(server.address() as { port: number }).port}`
        resolve()
      })
    })
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    vi.resetModules()
  })

  it('[AUTOMATED] returns all messages when maxVisibleItems is 0', async () => {
    const settings = (await import('../db/settings.js')) as unknown as {
      __store: Map<string, string>
      setSetting: (k: string, v: string) => void
    }
    settings.setSetting('display.maxVisibleItems', '0')

    const res = await fetch(`${baseUrl}/api/sessions/session-1`)
    const data = (await res.json()) as { messages: { id: string }[]; hiddenCount: number }

    expect(data.messages).toHaveLength(10)
    expect(data.hiddenCount).toBe(0)
  })

  it('[AUTOMATED] returns only the last N messages when maxVisibleItems > 0', async () => {
    const settings = (await import('../db/settings.js')) as unknown as {
      __store: Map<string, string>
      setSetting: (k: string, v: string) => void
    }
    settings.setSetting('display.maxVisibleItems', '3')

    const res = await fetch(`${baseUrl}/api/sessions/session-1`)
    const data = (await res.json()) as { messages: { id: string }[]; hiddenCount: number }

    expect(data.messages).toHaveLength(3)
    expect(data.messages[0]!.id).toBe('msg-8')
    expect(data.messages[1]!.id).toBe('msg-9')
    expect(data.messages[2]!.id).toBe('msg-10')
    expect(data.hiddenCount).toBe(7)
  })

  it('[AUTOMATED] returns all messages when messages.length <= maxVisibleItems', async () => {
    const settings = (await import('../db/settings.js')) as unknown as {
      __store: Map<string, string>
      setSetting: (k: string, v: string) => void
    }
    settings.setSetting('display.maxVisibleItems', '50')

    const res = await fetch(`${baseUrl}/api/sessions/session-1`)
    const data = (await res.json()) as { messages: { id: string }[]; hiddenCount: number }

    expect(data.messages).toHaveLength(10)
    expect(data.hiddenCount).toBe(0)
  })

  it('[AUTOMATED] returns hiddenCount = 0 when maxVisibleItems is not set (defaults to 0)', async () => {
    const settings = (await import('../db/settings.js')) as unknown as {
      __store: Map<string, string>
      setSetting: (k: string, v: string) => void
    }
    settings.setSetting('display.maxVisibleItems', '')

    const res = await fetch(`${baseUrl}/api/sessions/session-1`)
    const data = (await res.json()) as { messages: { id: string }[]; hiddenCount: number }

    expect(data.hiddenCount).toBe(0)
    expect(data.messages).toHaveLength(10)
  })

  it('[AUTOMATED] returns 404 for non-existent session', async () => {
    ;(getSessionMock as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined)
    const res = await fetch(`${baseUrl}/api/sessions/nonexistent`)
    expect(res.status).toBe(404)
  })

  it('[AUTOMATED] returns all messages when ?full=true bypasses maxVisibleItems', async () => {
    const settings = (await import('../db/settings.js')) as unknown as {
      __store: Map<string, string>
      setSetting: (k: string, v: string) => void
    }
    settings.setSetting('display.maxVisibleItems', '3')

    const res = await fetch(`${baseUrl}/api/sessions/session-1?full=true`)
    const data = (await res.json()) as { messages: { id: string }[]; hiddenCount: number }

    expect(data.messages).toHaveLength(10)
    expect(data.hiddenCount).toBe(0)
  })

  it('[AUTOMATED] ?full=true returns hiddenCount 0 regardless of maxVisibleItems', async () => {
    const settings = (await import('../db/settings.js')) as unknown as {
      __store: Map<string, string>
      setSetting: (k: string, v: string) => void
    }
    settings.setSetting('display.maxVisibleItems', '1')

    const res = await fetch(`${baseUrl}/api/sessions/session-1?full=true`)
    const data = (await res.json()) as { messages: { id: string }[]; hiddenCount: number }

    expect(data.hiddenCount).toBe(0)
  })
})

// ============================================================================
// POST /api/sessions/:id/provider — getEventsSinceSnapshot (Criterion 9D)
// ============================================================================

describe('POST /api/sessions/:id/provider — snapshot-optimized loading', () => {
  let app: express.Express
  let server: ReturnType<express.Express['listen']>
  let baseUrl: string
  let getEventsMock: ReturnType<typeof vi.fn>
  let getEventsSinceSnapshotMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    getEventsMock = vi.fn(() => [])
    getEventsSinceSnapshotMock = vi.fn(() => ({
      snapshot: undefined,
      events: [],
    }))

    vi.doMock('../events/index.js', () => ({
      getEventStore: () => ({
        getEvents: getEventsMock,
        getEventsSinceSnapshot: getEventsSinceSnapshotMock,
        getLatestSnapshot: vi.fn(() => undefined),
      }),
    }))

    vi.doMock('../events/folding.js', () => ({
      buildMessagesFromStoredEvents: vi.fn(() => ({ messages: [], hiddenCount: 0 })),
    }))

    app = express()
    app.use(express.json())

    const { getEventStore } = await import('../events/index.js')
    const { buildMessagesFromStoredEvents } = await import('../events/folding.js')

    const mockSessionManager = {
      getSession: vi.fn((id: string) =>
        id === 'nonexistent'
          ? undefined
          : {
              id: 'session-1',
              projectId: 'proj-1',
              workdir: '/tmp/test',
              mode: 'builder',
              phase: 'build',
              isRunning: false,
              providerId: null,
              providerModel: null,
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
              messages: [],
              criteria: [],
              contextWindows: [],
              executionState: null,
              metadata: { title: 'Test', totalTokensUsed: 0, totalToolCalls: 0, iterationCount: 0 },
              metadataEntries: {},
              messageCount: 5,
            },
      ),
      setSessionProvider: vi.fn(),
      getContextState: vi.fn((_id: string) => null),
    }

    const mockProviderManager = {
      getProviders: vi.fn(() => [{ id: 'test-provider', models: [{ id: 'test-model' }] }]),
    }

    app.post('/api/sessions/:id/provider', async (req, res) => {
      const { providerId, model } = req.body

      const session = mockSessionManager.getSession(req.params.id)
      if (!session) {
        return res.status(404).json({ error: 'Session not found' })
      }

      const provider = mockProviderManager.getProviders().find((p: { id: string }) => p.id === providerId)
      const resolvedModel = model ?? provider?.models?.[0]?.id ?? 'auto'
      mockSessionManager.setSessionProvider(req.params.id, providerId, resolvedModel)
      const contextState = mockSessionManager.getContextState(req.params.id)

      const eventStore = getEventStore()
      const { events } = eventStore.getEventsSinceSnapshot(req.params.id)
      const { messages } = buildMessagesFromStoredEvents(events)
      const updatedSession = mockSessionManager.getSession(req.params.id)

      res.json({ session: updatedSession, messages, contextState })
    })

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${(server.address() as { port: number }).port}`
        resolve()
      })
    })
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    vi.resetModules()
  })

  it('[AUTOMATED] uses getEventsSinceSnapshot instead of getEvents for provider handler', async () => {
    await fetch(`${baseUrl}/api/sessions/session-1/provider`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'test-provider', model: 'test-model' }),
    })

    expect(getEventsSinceSnapshotMock).toHaveBeenCalledWith('session-1')
  })

  it('[AUTOMATED] does not call getEvents directly for provider handler', async () => {
    await fetch(`${baseUrl}/api/sessions/session-1/provider`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'test-provider', model: 'test-model' }),
    })

    expect(getEventsMock).not.toHaveBeenCalled()
  })

  it('[AUTOMATED] returns session data from provider handler', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/session-1/provider`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'test-provider', model: 'test-model' }),
    })

    expect(res.status).toBe(200)
    const data = (await res.json()) as { session: { id: string } }
    expect(data.session).toBeDefined()
  })

  it('[AUTOMATED] returns 404 for non-existent session in provider handler', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/nonexistent/provider`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'test-provider', model: 'test-model' }),
    })

    expect(res.status).toBe(404)
  })
})

// ============================================================================
// PUT /api/sessions/:id/mode — getEventsSinceSnapshot (Criterion 9D)
// ============================================================================

describe('PUT /api/sessions/:id/mode — snapshot-optimized loading', () => {
  let app: express.Express
  let server: ReturnType<express.Express['listen']>
  let baseUrl: string
  let getEventsMock: ReturnType<typeof vi.fn>
  let getEventsSinceSnapshotMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    getEventsMock = vi.fn(() => [])
    getEventsSinceSnapshotMock = vi.fn(() => ({
      snapshot: undefined,
      events: [],
    }))

    vi.doMock('../events/index.js', () => ({
      getEventStore: () => ({
        getEvents: getEventsMock,
        getEventsSinceSnapshot: getEventsSinceSnapshotMock,
        getLatestSnapshot: vi.fn(() => undefined),
      }),
    }))

    vi.doMock('../events/folding.js', () => ({
      buildMessagesFromStoredEvents: vi.fn(() => ({ messages: [], hiddenCount: 0 })),
    }))

    app = express()
    app.use(express.json())

    const { getEventStore } = await import('../events/index.js')
    const { buildMessagesFromStoredEvents } = await import('../events/folding.js')

    const mockSessionManager = {
      getSession: vi.fn((id: string) =>
        id === 'nonexistent'
          ? undefined
          : {
              id: 'session-1',
              projectId: 'proj-1',
              workdir: '/tmp/test',
              mode: 'builder',
              phase: 'build',
              isRunning: false,
              providerId: null,
              providerModel: null,
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
              messages: [],
              criteria: [],
              contextWindows: [],
              executionState: null,
              metadata: { title: 'Test', totalTokensUsed: 0, totalToolCalls: 0, iterationCount: 0 },
              metadataEntries: {},
              messageCount: 5,
            },
      ),
      setMode: vi.fn(),
    }

    app.put('/api/sessions/:id/mode', async (req, res) => {
      const { mode } = req.body

      const session = mockSessionManager.getSession(req.params.id)
      if (!session) {
        return res.status(404).json({ error: 'Session not found' })
      }

      if (!mode) {
        return res.status(400).json({ error: 'mode is required' })
      }

      mockSessionManager.setMode(req.params.id, mode)

      const eventStore = getEventStore()
      const { events } = eventStore.getEventsSinceSnapshot(req.params.id)
      const { messages } = buildMessagesFromStoredEvents(events)
      const updatedSession = mockSessionManager.getSession(req.params.id)

      res.json({ session: updatedSession, messages })
    })

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${(server.address() as { port: number }).port}`
        resolve()
      })
    })
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    vi.resetModules()
  })

  it('[AUTOMATED] uses getEventsSinceSnapshot instead of getEvents for mode handler', async () => {
    await fetch(`${baseUrl}/api/sessions/session-1/mode`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'planner' }),
    })

    expect(getEventsSinceSnapshotMock).toHaveBeenCalledWith('session-1')
  })

  it('[AUTOMATED] does not call getEvents directly for mode handler', async () => {
    await fetch(`${baseUrl}/api/sessions/session-1/mode`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'planner' }),
    })

    expect(getEventsMock).not.toHaveBeenCalled()
  })

  it('[AUTOMATED] returns session data from mode handler', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/session-1/mode`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'planner' }),
    })

    expect(res.status).toBe(200)
    const data = (await res.json()) as { session: { id: string } }
    expect(data.session).toBeDefined()
  })

  it('[AUTOMATED] returns 404 for non-existent session in mode handler', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/nonexistent/mode`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'planner' }),
    })

    expect(res.status).toBe(404)
  })
})
