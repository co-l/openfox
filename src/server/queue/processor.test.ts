import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { QueueProcessor } from './processor.js'
import { initDatabase, closeDatabase } from '../db/index.js'
import type { Config } from '../config.js'

function createTestConfig(): Config {
  return {
    llm: { baseUrl: 'http://localhost:8000', model: 'test-model' },
    context: { maxTokens: 100000 },
    database: { path: ':memory:' },
    mode: 'test',
  } as Config
}

beforeAll(() => {
  initDatabase(createTestConfig())
})

afterAll(() => {
  closeDatabase()
})

vi.mock('../events/store.js', () => ({
  getEventStore: vi.fn(() => ({
    append: vi.fn(),
    getSessionEvents: vi.fn(() => []),
    getAllEvents: vi.fn(() => []),
    getEvents: vi.fn(() => []),
    getLatestSeq: vi.fn(() => undefined),
    getLatestSnapshot: vi.fn(() => undefined),
  })),
  initEventStore: vi.fn(),
}))

describe('QueueProcessor', () => {
  let mockSessionManager: any
  let mockProviderManager: any
  let mockGetLLMClient: any
  let mockGetActiveProvider: any
  let mockBroadcastForSession: any
  let queueProcessor: QueueProcessor

  // Stateful session mock: mutations via setRunning are reflected in getSession
  let sessionState: {
    id: string
    isRunning: boolean
    metadata?: any
    providerId?: string
    providerModel?: string
    mode?: string
  }
  let queueItems: Array<{ queueId: string; mode: string; content: string; queuedAt: string; attachments?: any[] }>

  beforeEach(() => {
    sessionState = { id: 'sess-1', isRunning: false, metadata: { title: undefined } }
    queueItems = []

    mockSessionManager = {
      subscribe: vi.fn(() => () => {}),
      getSession: vi.fn(() => sessionState),
      hasQueuedMessages: vi.fn(() => queueItems.length > 0),
      setRunning: vi.fn((_id: string, running: boolean) => {
        sessionState = { ...sessionState, isRunning: running }
      }),
      addMessage: vi.fn(() => ({ id: 'msg-1' })),
      cancelQueuedMessage: vi.fn((_id: string, queueId: string) => {
        queueItems = queueItems.filter((q) => q.queueId !== queueId)
      }),
      getQueueState: vi.fn(() => queueItems),
      getContextState: vi.fn(() => ({
        currentTokens: 100,
        maxTokens: 1000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: true,
      })),
    }

    mockProviderManager = {
      getActiveProviderId: vi.fn(),
      getCurrentModel: vi.fn(() => 'test-model'),
      activateProvider: vi.fn(),
      getModelSettings: vi.fn(() => undefined),
      getProviders: vi.fn(() => []),
    }
    mockGetLLMClient = vi.fn(() => ({
      getModel: () => 'test-model',
      getBackend: () => 'test',
      complete: vi.fn().mockResolvedValue({
        id: 'test',
        content: 'Test name',
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      }),
    }))
    mockGetActiveProvider = vi.fn()
    mockBroadcastForSession = vi.fn()

    queueProcessor = new QueueProcessor({
      sessionManager: mockSessionManager as any,
      providerManager: mockProviderManager as any,
      getLLMClient: mockGetLLMClient,
      getActiveProvider: mockGetActiveProvider,
      broadcastForSession: mockBroadcastForSession,
    })
  })

  afterEach(() => {
    queueProcessor.stop()
    vi.clearAllMocks()
  })

  describe('start/stop', () => {
    it('should start and subscribe to session events', () => {
      queueProcessor.start()
      expect(mockSessionManager.subscribe).toHaveBeenCalled()
    })

    it('should stop and clear subscriptions', () => {
      queueProcessor.start()
      queueProcessor.stop()
      // No error should occur
    })

    it('should warn if already started', () => {
      queueProcessor.start()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      queueProcessor.start()
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })
  })

  describe('queue events', () => {
    it('should start turn when queue_added event received for idle session', () => {
      sessionState = { id: 'sess-1', isRunning: false, metadata: { title: undefined } }
      queueItems = [{ queueId: 'q-1', mode: 'asap', content: 'hello', queuedAt: '2024-01-01' }]

      queueProcessor.start()

      const callback = mockSessionManager.subscribe.mock.calls[0][0]
      callback({ type: 'queue_added', sessionId: 'sess-1', queueId: 'q-1', mode: 'asap', content: 'hello' })

      expect(mockSessionManager.setRunning).toHaveBeenCalledWith('sess-1', true)
      expect(mockSessionManager.addMessage).toHaveBeenCalled()
    })

    it('should NOT start turn when session is already running', () => {
      sessionState = { id: 'sess-1', isRunning: true, metadata: { title: undefined } }

      queueProcessor.start()

      const callback = mockSessionManager.subscribe.mock.calls[0][0]
      callback({ type: 'queue_added', sessionId: 'sess-1', queueId: 'q-1', mode: 'asap', content: 'hello' })

      expect(mockSessionManager.setRunning).not.toHaveBeenCalled()
    })

    it('should NOT start turn when no queued messages', () => {
      sessionState = { id: 'sess-1', isRunning: false, metadata: { title: undefined } }
      // queueItems is empty by default

      queueProcessor.start()

      const callback = mockSessionManager.subscribe.mock.calls[0][0]
      callback({ type: 'queue_added', sessionId: 'sess-1', queueId: 'q-1', mode: 'asap', content: 'hello' })

      expect(mockSessionManager.setRunning).not.toHaveBeenCalled()
    })
  })

  describe('session provider', () => {
    it('should use session provider when session has custom providerId and providerModel', async () => {
      const mockProvider = {
        id: 'provider-2',
        name: 'Provider 2',
        backend: 'openai' as const,
        url: 'https://api.example.com',
        models: [],
      }
      const mockActivateProvider = vi.fn().mockResolvedValue({ success: true })
      mockProviderManager.getProviders = vi.fn(() => [mockProvider])
      mockProviderManager.activateProvider = mockActivateProvider

      sessionState = {
        id: 'sess-1',
        isRunning: false,
        metadata: { title: undefined },
        providerId: 'provider-2',
        providerModel: 'custom-model',
      }
      queueItems = [{ queueId: 'q-1', mode: 'asap', content: 'hello', queuedAt: '2024-01-01' }]

      queueProcessor.start()

      const callback = mockSessionManager.subscribe.mock.calls[0][0]
      callback({ type: 'queue_added', sessionId: 'sess-1', queueId: 'q-1', mode: 'asap', content: 'hello' })

      // Wait for the async runTurn to complete
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Verify activateProvider was called with the session's provider and model
      expect(mockActivateProvider).toHaveBeenCalledWith('provider-2', { model: 'custom-model' })
    })

    it('should use global provider when session has no custom provider', async () => {
      const mockActivateProvider = vi.fn().mockResolvedValue({ success: true })
      mockProviderManager.activateProvider = mockActivateProvider

      sessionState = {
        id: 'sess-1',
        isRunning: false,
        metadata: { title: undefined },
        // No providerId or providerModel - should use global
      }
      queueItems = [{ queueId: 'q-1', mode: 'asap', content: 'hello', queuedAt: '2024-01-01' }]

      queueProcessor.start()

      const callback = mockSessionManager.subscribe.mock.calls[0][0]
      callback({ type: 'queue_added', sessionId: 'sess-1', queueId: 'q-1', mode: 'asap', content: 'hello' })

      // Wait for the async runTurn to complete
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Verify activateProvider was NOT called when session has no custom provider
      expect(mockActivateProvider).not.toHaveBeenCalled()
    })
  })

  describe('queue events trigger turns', () => {
    it('starts turn when queue_added for idle session', () => {
      sessionState = { id: 'sess-1', isRunning: false, metadata: { title: undefined } }
      queueItems = [{ queueId: 'q-1', mode: 'asap', content: 'hello', queuedAt: '2024-01-01' }]

      queueProcessor.start()

      const callback = mockSessionManager.subscribe.mock.calls[0][0]
      callback({ type: 'queue_added', sessionId: 'sess-1', queueId: 'q-1', mode: 'asap', content: 'hello' })

      expect(mockSessionManager.setRunning).toHaveBeenCalledWith('sess-1', true)
      expect(mockSessionManager.addMessage).toHaveBeenCalled()
    })

    it('does NOT start turn when already running', () => {
      sessionState = { id: 'sess-1', isRunning: true, metadata: { title: undefined } }

      queueProcessor.start()

      const callback = mockSessionManager.subscribe.mock.calls[0][0]
      callback({ type: 'queue_added', sessionId: 'sess-1', queueId: 'q-1', mode: 'asap', content: 'hello' })

      expect(mockSessionManager.setRunning).not.toHaveBeenCalled()
    })

    it('does NOT start turn when no queued messages', () => {
      sessionState = { id: 'sess-1', isRunning: false, metadata: { title: undefined } }
      // queueItems is empty by default

      queueProcessor.start()

      const callback = mockSessionManager.subscribe.mock.calls[0][0]
      callback({ type: 'queue_added', sessionId: 'sess-1', queueId: 'q-1', mode: 'asap', content: 'hello' })

      expect(mockSessionManager.setRunning).not.toHaveBeenCalled()
    })

    it('checks for more messages when running becomes false and has queued messages', () => {
      sessionState = { id: 'sess-1', isRunning: false, metadata: { title: undefined } }
      queueItems = [{ queueId: 'q-2', mode: 'asap', content: 'next', queuedAt: '2024-01-01' }]

      queueProcessor.start()

      const callback = mockSessionManager.subscribe.mock.calls[0][0]
      callback({ type: 'running_changed', sessionId: 'sess-1', isRunning: false })

      expect(mockSessionManager.setRunning).toHaveBeenCalledWith('sess-1', true)
    })
  })
})
