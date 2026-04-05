import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { QueueProcessor } from './processor.js'

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

  beforeEach(() => {
    mockSessionManager = {
      subscribe: vi.fn(() => () => {}),
      getSession: vi.fn(),
      hasQueuedMessages: vi.fn(),
      setRunning: vi.fn(),
      addMessage: vi.fn(() => ({ id: 'msg-1' })),
      cancelQueuedMessage: vi.fn(),
      getQueueState: vi.fn(),
      getContextState: vi.fn(() => ({ currentTokens: 100, maxTokens: 1000, compactionCount: 0, dangerZone: false, canCompact: true })),
    }

    mockProviderManager = {}
    mockGetLLMClient = vi.fn(() => ({
      getModel: () => 'test-model',
      getBackend: () => 'test',
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
      mockSessionManager.getSession.mockReturnValue({ id: 'sess-1', isRunning: false, metadata: { title: undefined } })
      mockSessionManager.hasQueuedMessages.mockReturnValue(true)
      mockSessionManager.getQueueState.mockReturnValue([
        { queueId: 'q-1', mode: 'asap', content: 'hello', queuedAt: '2024-01-01' },
      ])

      queueProcessor.start()

      const callback = mockSessionManager.subscribe.mock.calls[0][0]
      callback({ type: 'queue_added', sessionId: 'sess-1', queueId: 'q-1', mode: 'asap', content: 'hello' })

      expect(mockSessionManager.setRunning).toHaveBeenCalledWith('sess-1', true)
      expect(mockSessionManager.addMessage).toHaveBeenCalled()
    })

    it('should NOT start turn when session is already running', () => {
      mockSessionManager.getSession.mockReturnValue({ id: 'sess-1', isRunning: true })

      queueProcessor.start()

      const callback = mockSessionManager.subscribe.mock.calls[0][0]
      callback({ type: 'queue_added', sessionId: 'sess-1', queueId: 'q-1', mode: 'asap', content: 'hello' })

      expect(mockSessionManager.setRunning).not.toHaveBeenCalled()
    })

    it('should NOT start turn when no queued messages', () => {
      mockSessionManager.getSession.mockReturnValue({ id: 'sess-1', isRunning: false })
      mockSessionManager.hasQueuedMessages.mockReturnValue(false)

      queueProcessor.start()

      const callback = mockSessionManager.subscribe.mock.calls[0][0]
      callback({ type: 'queue_added', sessionId: 'sess-1', queueId: 'q-1', mode: 'asap', content: 'hello' })

      expect(mockSessionManager.setRunning).not.toHaveBeenCalled()
    })
  })

  describe('queue events trigger turns', () => {
    it('starts turn when queue_added for idle session', () => {
      mockSessionManager.getSession.mockReturnValue({ id: 'sess-1', isRunning: false, metadata: { title: undefined } })
      mockSessionManager.hasQueuedMessages.mockReturnValue(true)
      mockSessionManager.getQueueState.mockReturnValue([
        { queueId: 'q-1', mode: 'asap', content: 'hello', queuedAt: '2024-01-01' },
      ])

      queueProcessor.start()

      const callback = mockSessionManager.subscribe.mock.calls[0][0]
      callback({ type: 'queue_added', sessionId: 'sess-1', queueId: 'q-1', mode: 'asap', content: 'hello' })

      expect(mockSessionManager.setRunning).toHaveBeenCalledWith('sess-1', true)
      expect(mockSessionManager.addMessage).toHaveBeenCalled()
    })

    it('does NOT start turn when already running', () => {
      mockSessionManager.getSession.mockReturnValue({ id: 'sess-1', isRunning: true, metadata: { title: undefined } })

      queueProcessor.start()

      const callback = mockSessionManager.subscribe.mock.calls[0][0]
      callback({ type: 'queue_added', sessionId: 'sess-1', queueId: 'q-1', mode: 'asap', content: 'hello' })

      expect(mockSessionManager.setRunning).not.toHaveBeenCalled()
    })

    it('does NOT start turn when no queued messages', () => {
      mockSessionManager.getSession.mockReturnValue({ id: 'sess-1', isRunning: false, metadata: { title: undefined } })
      mockSessionManager.hasQueuedMessages.mockReturnValue(false)

      queueProcessor.start()

      const callback = mockSessionManager.subscribe.mock.calls[0][0]
      callback({ type: 'queue_added', sessionId: 'sess-1', queueId: 'q-1', mode: 'asap', content: 'hello' })

      expect(mockSessionManager.setRunning).not.toHaveBeenCalled()
    })

    it('checks for more messages when running becomes false and has queued messages', () => {
      mockSessionManager.getSession.mockReturnValue({ id: 'sess-1', isRunning: false, metadata: { title: undefined } })
      mockSessionManager.hasQueuedMessages.mockReturnValue(true)
      mockSessionManager.getQueueState.mockReturnValue([
        { queueId: 'q-2', mode: 'asap', content: 'next', queuedAt: '2024-01-01' },
      ])

      queueProcessor.start()

      const callback = mockSessionManager.subscribe.mock.calls[0][0]
      callback({ type: 'running_changed', sessionId: 'sess-1', isRunning: false })

      expect(mockSessionManager.setRunning).toHaveBeenCalledWith('sess-1', true)
    })
  })
})