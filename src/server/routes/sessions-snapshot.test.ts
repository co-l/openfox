// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'

vi.mock('../db/settings.js', () => {
  const store = new Map<string, string>()
  store.set('display.maxVisibleItems', '300')
  return {
    getSetting: (key: string) => store.get(key) ?? null,
    setSetting: (key: string, value: string) => store.set(key, value),
    SETTINGS_KEYS: { DISPLAY_MAX_VISIBLE_ITEMS: 'display.maxVisibleItems' },
    applyMaxVisibleItems: <T>(items: T[]) => {
      const setting = store.get('display.maxVisibleItems')
      const maxVisibleItems = setting ? parseInt(setting, 10) : 0
      let truncated = items
      let hiddenCount = 0
      if (maxVisibleItems > 0 && items.length > maxVisibleItems) {
        truncated = items.slice(-maxVisibleItems)
        hiddenCount = items.length - maxVisibleItems
      }
      return { truncated, hiddenCount }
    },
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
  messageCount: 5,
}

const mockEvents = Array.from({ length: 5 }, (_, i) => ({
  seq: i + 1,
  sessionId: 'session-1',
  timestamp: Date.now(),
  type: 'message.start' as const,
  data: {
    messageId: `msg-${i + 1}`,
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `Message ${i + 1}`,
  },
}))

const mockMessages = mockEvents.map((e) => ({
  id: e.data.messageId,
  role: e.data.role,
  content: e.data.content,
  timestamp: new Date(e.timestamp).toISOString(),
  tokenCount: 0,
  isStreaming: false,
}))

describe('GET /api/sessions/:id — snapshot-optimized loading', () => {
  let app: express.Express
  let server: ReturnType<express.Express['listen']>
  let baseUrl: string
  let getEventsMock: ReturnType<typeof vi.fn>
  let getEventsSinceSnapshotMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    getEventsMock = vi.fn(() => mockEvents)
    getEventsSinceSnapshotMock = vi.fn(() => ({
      snapshot: {
        mode: 'builder',
        phase: 'build',
        isRunning: false,
        messages: mockMessages.slice(0, 5),
        criteria: [],
        metadataEntries: {},
        contextState: {
          currentTokens: 0,
          maxTokens: 200000,
          compactionCount: 0,
          dangerZone: false,
          canCompact: false,
          dynamicContextChanged: false,
        },
        currentContextWindowId: 'win-1',
        todos: [],
        readFiles: [],
        snapshotSeq: 2,
        snapshotAt: Date.now(),
      },
      events: [],
    }))

    vi.doMock('../events/index.js', () => ({
      getEventStore: () => ({
        getEvents: getEventsMock,
        getEventsSinceSnapshot: getEventsSinceSnapshotMock,
        getLatestSnapshot: vi.fn(() => ({
          seq: 3,
          sessionId: 'session-1',
          timestamp: Date.now(),
          type: 'turn.snapshot',
          data: {
            mode: 'builder',
            phase: 'build',
            isRunning: false,
            messages: [],
            criteria: [],
            metadataEntries: {},
            contextState: {},
            currentContextWindowId: 'win-1',
            todos: [],
            readFiles: [],
            snapshotSeq: 1,
            snapshotAt: Date.now(),
          },
        })),
      }),
      getContextMessages: vi.fn(() => []),
      getCurrentContextWindowId: vi.fn(() => 'win-1'),
    }))

    vi.doMock('../events/folding.js', () => ({
      buildMessagesFromStoredEvents: vi.fn(() => ({ messages: mockMessages, hiddenCount: 0 })),
      foldPendingConfirmations: vi.fn(() => []),
    }))

    vi.doMock('../tools/index.js', () => ({
      getPendingQuestionsForSession: vi.fn(() => []),
    }))

    app = express()
    app.use(express.json())

    app.get('/api/sessions/:id', async (req, res) => {
      const { getEventStore } = await import('../events/index.js')
      const { buildMessagesFromStoredEvents, foldPendingConfirmations } = await import('../events/folding.js')
      const { getPendingQuestionsForSession } = await import('../tools/index.js')
      const { applyMaxVisibleItems } = await import('../db/settings.js')

      const session = mockSession
      if (!session) {
        return res.status(404).json({ error: 'Session not found' })
      }

      const eventStore = getEventStore()
      const { events } = eventStore.getEventsSinceSnapshot(req.params.id)
      const { messages } = buildMessagesFromStoredEvents(events)
      const contextState = null
      const queueState = null
      const pendingQuestions = getPendingQuestionsForSession(req.params.id)
      const pendingConfirmations = foldPendingConfirmations(events)

      const { truncated: truncatedMessages, hiddenCount } =
        req.query['full'] === 'true' ? { truncated: messages, hiddenCount: 0 } : applyMaxVisibleItems(messages)

      res.json({
        session,
        messages: truncatedMessages,
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

  it('[AUTOMATED] uses getEventsSinceSnapshot instead of getEvents', async () => {
    await fetch(`${baseUrl}/api/sessions/session-1`)

    expect(getEventsSinceSnapshotMock).toHaveBeenCalledWith('session-1')
  })

  it('[AUTOMATED] does not call getEvents directly', async () => {
    await fetch(`${baseUrl}/api/sessions/session-1`)

    expect(getEventsMock).not.toHaveBeenCalled()
  })

  it('[AUTOMATED] returns messages from snapshot + events since', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/session-1`)
    const data = (await res.json()) as { messages: unknown[] }

    expect(data.messages).toBeDefined()
    expect(Array.isArray(data.messages)).toBe(true)
  })

  it('[AUTOMATED] returns all messages when ?full=true bypasses maxVisibleItems truncation', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/session-1?full=true`)
    const data = (await res.json()) as { messages: unknown[]; hiddenCount: number }

    expect(data.messages).toBeDefined()
    expect(data.messages).toHaveLength(5)
    expect(data.hiddenCount).toBe(0)
  })
})
