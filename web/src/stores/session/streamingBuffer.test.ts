// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0))
vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))

const fetchMock = vi.fn(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }), status: 200 }),
)
vi.stubGlobal('fetch', fetchMock)
vi.stubGlobal('localStorage', {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
})

const { wsSendMock, wsSubscribeMock, wsConnectMock, wsDisconnectMock, wsStatusMock } = vi.hoisted(() => ({
  wsSendMock: vi.fn(() => 'message-id'),
  wsSubscribeMock: vi.fn(() => () => undefined),
  wsConnectMock: vi.fn(async () => undefined),
  wsDisconnectMock: vi.fn(() => undefined),
  wsStatusMock: vi.fn(() => undefined),
}))

vi.mock('../../lib/ws', () => ({
  wsClient: {
    send: wsSendMock,
    subscribe: wsSubscribeMock,
    connect: wsConnectMock,
    disconnect: wsDisconnectMock,
    onStatusChange: wsStatusMock,
  },
}))

vi.mock('../../lib/sound', () => ({
  playNotification: vi.fn(),
  playAchievement: vi.fn(),
  playIntervention: vi.fn(),
  playWaitingForUser: vi.fn(),
  playNewMessage: vi.fn(),
}))

type SessionStoreModule = typeof import('../session')

async function loadSessionStore(): Promise<SessionStoreModule['useSessionStore']> {
  vi.resetModules()
  const module = await import('../session')
  return module.useSessionStore
}

describe('chat.tool_output streaming after message_updated', () => {
  beforeEach(() => {
    wsSendMock.mockClear()
    wsSubscribeMock.mockClear()
    wsConnectMock.mockClear()
    wsDisconnectMock.mockClear()
    wsStatusMock.mockClear()
    fetchMock.mockClear()
  })

  it('accumulates all tool_output chunks even after message_updated folds streamingMessage into messages', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const useSessionStore = await loadSessionStore()

    useSessionStore.setState({
      currentSession: {
        id: 'session-1',
        projectId: 'project-1',
        workdir: '/tmp/project-1',
        mode: 'builder',
        phase: 'build',
        isRunning: true,
        criteria: [],
        summary: null,
      } as any,
    })

    useSessionStore.getState().handleServerMessage({
      type: 'chat.message',
      sessionId: 'session-1',
      payload: {
        message: {
          id: 'msg-1',
          role: 'assistant',
          content: '',
          timestamp: '2024-01-01T00:00:00.000Z',
          tokenCount: 0,
          isStreaming: true,
        },
      },
    })

    useSessionStore.getState().handleServerMessage({
      type: 'chat.tool_call',
      sessionId: 'session-1',
      payload: {
        messageId: 'msg-1',
        callId: 'call-1',
        tool: 'run_command',
        args: { command: 'echo hello' },
      },
    })

    useSessionStore.getState().handleServerMessage({
      type: 'chat.message_updated',
      sessionId: 'session-1',
      payload: {
        messageId: 'msg-1',
        updates: { isStreaming: false },
      },
    })

    const msg = useSessionStore.getState().messages.find((m) => m.id === 'msg-1')
    expect(msg?.toolCalls).toHaveLength(1)
    expect(msg?.toolCalls?.[0]?.streamingOutput).toBeUndefined()
    expect(useSessionStore.getState().messages.find((m) => m.isStreaming)).toBeUndefined()

    useSessionStore.getState().handleServerMessage({
      type: 'chat.tool_output',
      sessionId: 'session-1',
      payload: { messageId: 'msg-1', callId: 'call-1', stream: 'stdout', output: 'first\n' },
    })
    vi.runAllTimers()

    const afterFirst = useSessionStore.getState().messages.find((m) => m.id === 'msg-1')
    expect(afterFirst?.toolCalls?.[0]?.streamingOutput?.map((c) => c.content).join('')).toBe('first\n')

    useSessionStore.getState().handleServerMessage({
      type: 'chat.tool_output',
      sessionId: 'session-1',
      payload: { messageId: 'msg-1', callId: 'call-1', stream: 'stdout', output: 'second\n' },
    })
    useSessionStore.getState().handleServerMessage({
      type: 'chat.tool_output',
      sessionId: 'session-1',
      payload: { messageId: 'msg-1', callId: 'call-1', stream: 'stdout', output: 'third\n' },
    })
    vi.runAllTimers()

    const updatedMsg = useSessionStore.getState().messages.find((m) => m.id === 'msg-1')
    const output = updatedMsg?.toolCalls?.[0]?.streamingOutput?.map((c) => c.content).join('') ?? ''
    expect(output).toBe('first\nsecond\nthird\n')
  })
})

describe('streaming flush throttling', () => {
  async function loadStreamingBuffer() {
    vi.resetModules()
    return import('./streamingBuffer')
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces multiple schedule calls within the throttle window into a single flush', async () => {
    const { scheduleStreamingFlush, setFlushFn, getBuffer } = await loadStreamingBuffer()
    const received: string[] = []
    setFlushFn(() => {
      received.push(getBuffer().deltaContent)
    })

    const buf = getBuffer()
    buf.messageId = 'm1'
    buf.deltaContent = ''
    scheduleStreamingFlush()
    buf.deltaContent += 'a'
    scheduleStreamingFlush()
    buf.deltaContent += 'b'
    scheduleStreamingFlush()

    expect(received).toEqual([])
    await vi.runAllTimersAsync()
    expect(received).toEqual(['ab'])
  })

  it('enforces a minimum 16ms interval between flushes', async () => {
    const { scheduleStreamingFlush, setFlushFn, getBuffer } = await loadStreamingBuffer()
    const flushFn = vi.fn()
    setFlushFn(flushFn)

    const buf = getBuffer()
    buf.messageId = 'm1'
    buf.deltaContent = 'first'
    scheduleStreamingFlush()
    await vi.runAllTimersAsync()
    expect(flushFn).toHaveBeenCalledTimes(1)

    buf.deltaContent = 'second'
    scheduleStreamingFlush()
    expect(flushFn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(8)
    expect(flushFn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10)
    expect(flushFn).toHaveBeenCalledTimes(2)
  })

  it('flushes pending content and clears the buffer only when the flush consumed it', async () => {
    const { scheduleStreamingFlush, cancelStreamingFlush, setFlushFn, getBuffer } = await loadStreamingBuffer()

    // When the flush does not consume the content (the target message has not
    // landed in the store yet), cancelling must keep the buffer so the stream
    // is not silently dropped.
    const idleFlush = vi.fn()
    setFlushFn(idleFlush)
    const buf = getBuffer()
    buf.messageId = 'm1'
    buf.deltaContent = 'partial'
    scheduleStreamingFlush()
    cancelStreamingFlush()

    expect(idleFlush).toHaveBeenCalledTimes(1)
    expect(buf.messageId).toBe('m1')
    expect(buf.deltaContent).toBe('partial')

    // When the flush consumes the pending content, cancelling resets the buffer.
    const consumingFlush = vi.fn(() => {
      buf.deltaContent = ''
      buf.thinkingContent = ''
      buf.toolOutput = []
    })
    setFlushFn(consumingFlush)
    buf.messageId = 'm1'
    buf.deltaContent = 'partial'
    scheduleStreamingFlush()
    cancelStreamingFlush()

    expect(consumingFlush).toHaveBeenCalledTimes(1)
    expect(buf.messageId).toBeNull()
    expect(buf.deltaContent).toBe('')
    expect(buf.thinkingContent).toBe('')
    expect(buf.toolOutput).toEqual([])

    await vi.runAllTimersAsync()
    expect(idleFlush).toHaveBeenCalledTimes(1)
  })

  it('uses the rAF fast path when enough time elapsed since the last flush', async () => {
    const { scheduleStreamingFlush, setFlushFn, getBuffer } = await loadStreamingBuffer()
    const flushFn = vi.fn()
    setFlushFn(flushFn)

    const buf = getBuffer()
    buf.messageId = 'm1'
    buf.deltaContent = 'first'
    scheduleStreamingFlush()
    await vi.runAllTimersAsync()
    expect(flushFn).toHaveBeenCalledTimes(1)

    // More than the throttle window elapses before the next schedule
    await vi.advanceTimersByTimeAsync(150)

    buf.deltaContent = 'second'
    scheduleStreamingFlush()
    // The rAF stub fires on a 0ms timer — no 100ms throttle delay
    await vi.runAllTimersAsync()
    expect(flushFn).toHaveBeenCalledTimes(2)
  })

  it('renders the first delta of the next message immediately after cancel', async () => {
    const { scheduleStreamingFlush, cancelStreamingFlush, setFlushFn, getBuffer } = await loadStreamingBuffer()
    const flushFn = vi.fn()
    setFlushFn(flushFn)

    const buf = getBuffer()
    buf.messageId = 'm1'
    buf.deltaContent = 'first'
    scheduleStreamingFlush()
    await vi.runAllTimersAsync()
    expect(flushFn).toHaveBeenCalledTimes(1)

    // Terminal event: commit remaining content
    cancelStreamingFlush()
    expect(flushFn).toHaveBeenCalledTimes(2)

    // Next message starts right away — its first delta must not be throttled
    buf.messageId = 'm2'
    buf.deltaContent = 'next message'
    scheduleStreamingFlush()
    await vi.runAllTimersAsync()
    expect(flushFn).toHaveBeenCalledTimes(3)
  })

  it('cancels a pending rAF flush on cancel', async () => {
    const cancelRafSpy = vi.spyOn(globalThis, 'cancelAnimationFrame')
    const { scheduleStreamingFlush, cancelStreamingFlush, setFlushFn, getBuffer } = await loadStreamingBuffer()
    const flushFn = vi.fn()
    setFlushFn(flushFn)

    const buf = getBuffer()
    buf.messageId = 'm1'
    buf.deltaContent = 'first'
    scheduleStreamingFlush()
    await vi.runAllTimersAsync()
    expect(flushFn).toHaveBeenCalledTimes(1)

    // More than the throttle window elapses so the next schedule takes the rAF path
    await vi.advanceTimersByTimeAsync(150)
    cancelRafSpy.mockClear()

    buf.deltaContent = 'second'
    scheduleStreamingFlush()
    cancelStreamingFlush()

    expect(cancelRafSpy).toHaveBeenCalledTimes(1)
    expect(flushFn).toHaveBeenCalledTimes(2)

    await vi.runAllTimersAsync()
    expect(flushFn).toHaveBeenCalledTimes(2)
  })
})
