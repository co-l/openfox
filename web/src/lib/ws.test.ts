// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type WsEvents = {
  open: (() => void)[]
  close: ((code: number) => void)[]
  error: ((err: Event) => void)[]
}

let wsEvents: WsEvents
interface MockWsInstance {
  readyState: number
  close: ReturnType<typeof vi.fn>
  dispatchEvent: (evt: Event) => void
  onopen: (() => void) | null
  onclose: ((evt: { code: number }) => void) | null
  onerror: ((err: Event) => void) | null
  onmessage: ((evt: { data: string }) => void) | null
}
let wsInstances: MockWsInstance[]

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState: number = MockWebSocket.CONNECTING
  url: string
  onopen: (() => void) | null = null
  onclose: ((evt: { code: number }) => void) | null = null
  onerror: ((err: Event) => void) | null = null
  onmessage: ((evt: { data: string }) => void) | null = null
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED
  })

  constructor(url: string) {
    this.url = url
    wsInstances.push(this)
    setTimeout(() => {
      if (this.readyState === MockWebSocket.CONNECTING) {
        this.readyState = MockWebSocket.OPEN
        wsEvents.open.forEach((fn) => fn())
        this.onopen?.()
      }
    }, 0)
  }

  send(_data: string) {}
  addEventListener(type: string, handler: (...args: unknown[]) => void) {
    if (type === 'open') wsEvents.open.push(handler as () => void)
    if (type === 'close') wsEvents.close.push(handler as (code: number) => void)
    if (type === 'error') wsEvents.error.push(handler as (err: Event) => void)
  }
  dispatchEvent(_evt: Event) {}
}

function simulateClose(instanceIndex: number, code: number) {
  const inst = wsInstances[instanceIndex]
  if (!inst) return
  inst.readyState = MockWebSocket.CLOSED
  wsEvents.close.forEach((fn) => fn(code))
  inst.onclose?.({ code } as { code: number })
}

async function connectClient(client: import('./ws').WebSocketClient, statusHandler: ReturnType<typeof vi.fn>) {
  const connectPromise = client.connect()
  await vi.waitFor(() => expect(wsInstances.length).toBe(1))
  await vi.waitFor(() => expect(statusHandler).toHaveBeenCalledWith('connected'))
  await connectPromise
  statusHandler.mockClear()
}

describe('WebSocketClient reconnect logic', () => {
  let WebSocketClient: typeof import('./ws').WebSocketClient
  // Every client listens to window/document lifecycle events; disconnect the
  // ones a test created so they cannot react to the next test's events.
  const created: import('./ws').WebSocketClient[] = []

  afterEach(() => {
    for (const client of created.splice(0)) client.disconnect()
  })

  beforeEach(async () => {
    vi.resetModules()
    wsEvents = { open: [], close: [], error: [] }
    wsInstances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
    localStorage.clear()

    const mod = await import('./ws')
    WebSocketClient = class extends mod.WebSocketClient {
      constructor(url: string) {
        super(url)
        created.push(this)
      }
    }
  })

  it('triggers auto-reconnect on close code 1006 when token exists', async () => {
    localStorage.setItem('openfox_token', 'valid-token')

    const client = new WebSocketClient('ws://localhost:9999/ws')
    const statusHandler = vi.fn()
    client.onStatusChange(statusHandler)
    await connectClient(client, statusHandler)

    simulateClose(0, 1006)

    expect(statusHandler).toHaveBeenCalledWith('disconnected')
    expect(statusHandler).toHaveBeenCalledWith('reconnecting')
  })

  it('does NOT auto-reconnect on close code 4000 when token exists (auth failure)', async () => {
    localStorage.setItem('openfox_token', 'valid-token')

    const client = new WebSocketClient('ws://localhost:9999/ws')
    const statusHandler = vi.fn()
    client.onStatusChange(statusHandler)
    await connectClient(client, statusHandler)

    simulateClose(0, 4000)

    expect(statusHandler).toHaveBeenCalledWith('disconnected')
    expect(statusHandler).not.toHaveBeenCalledWith('reconnecting')
  })

  it('auto-reconnects on close code 4000 when no token exists', async () => {
    const client = new WebSocketClient('ws://localhost:9999/ws')
    const statusHandler = vi.fn()
    client.onStatusChange(statusHandler)
    await connectClient(client, statusHandler)

    simulateClose(0, 4000)

    expect(statusHandler).toHaveBeenCalledWith('disconnected')
    expect(statusHandler).toHaveBeenCalledWith('reconnecting')
  })

  it('public reconnect() establishes a new connection', async () => {
    localStorage.setItem('openfox_token', 'valid-token')

    const client = new WebSocketClient('ws://localhost:9999/ws')
    const statusHandler = vi.fn()
    client.onStatusChange(statusHandler)
    await connectClient(client, statusHandler)

    client.disconnect()
    statusHandler.mockClear()

    client.reconnect()

    await vi.waitFor(() => expect(statusHandler).toHaveBeenCalledWith('connected'))
  })

  describe('resume (network back, page shown again)', () => {
    let hidden = false

    beforeEach(() => {
      hidden = false
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    })

    async function droppedClient() {
      const client = new WebSocketClient('ws://localhost:9999/ws')
      const statusHandler = vi.fn()
      client.onStatusChange(statusHandler)
      await connectClient(client, statusHandler)
      simulateClose(0, 1006)
      expect(statusHandler).toHaveBeenCalledWith('reconnecting')
      return { client, statusHandler }
    }

    it('reconnects immediately when the network comes back, instead of waiting for the backoff', async () => {
      const { statusHandler } = await droppedClient()

      window.dispatchEvent(new Event('online'))

      // A new socket right away — the pending backoff attempt (1 s here, up to
      // 30 s after a few failures) is cancelled, not added on top.
      expect(wsInstances.length).toBe(2)
      await vi.waitFor(() => expect(statusHandler).toHaveBeenCalledWith('connected'))
      await new Promise((resolve) => setTimeout(resolve, 1200))
      expect(wsInstances.length).toBe(2)
    })

    it('reconnects immediately when the page is shown again', async () => {
      await droppedClient()
      hidden = true
      document.dispatchEvent(new Event('visibilitychange'))
      expect(wsInstances.length).toBe(1)

      hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
      expect(wsInstances.length).toBe(2)
    })

    it('retries right away when the network comes back during an attempt that then fails', async () => {
      vi.useFakeTimers()
      try {
        const { client } = await droppedClient()
        // Let a few backoff attempts fail (1 s, 2 s, 4 s...): the next delay grows.
        for (const delay of [1000, 2000, 4000]) {
          await vi.advanceTimersByTimeAsync(delay)
          const attempt = wsInstances[wsInstances.length - 1]!
          simulateClose(wsInstances.length - 1, 1006)
          expect(attempt.readyState).toBe(MockWebSocket.CLOSED)
        }
        // A backoff attempt is dialing (CONNECTING) when the network comes back.
        await vi.advanceTimersByTimeAsync(8000)
        const dialing = wsInstances.length
        const pending = wsInstances[dialing - 1]!
        pending.readyState = MockWebSocket.CONNECTING
        window.dispatchEvent(new Event('online'))
        expect(wsInstances.length).toBe(dialing)

        // That attempt fails (it was dialing the dead network): retry at once
        // instead of waiting the next backoff step (16 s here, up to 30 s).
        simulateClose(dialing - 1, 1006)
        await vi.advanceTimersByTimeAsync(50)
        expect(wsInstances.length).toBe(dialing + 1)
        client.disconnect()
      } finally {
        vi.useRealTimers()
      }
    })

    it('replaces a socket still marked open after a long time hidden', async () => {
      // iOS suspends a background page and its socket can die silently: it
      // still reads OPEN when the page comes back, and nothing arrives until
      // the TCP timeout. After a long time hidden, reconnect (cheap: the
      // session resumes from its last event) instead of trusting it.
      const now = vi.spyOn(Date, 'now')
      try {
        now.mockReturnValue(1_000_000)
        const client = new WebSocketClient('ws://localhost:9999/ws')
        const statusHandler = vi.fn()
        client.onStatusChange(statusHandler)
        await connectClient(client, statusHandler)
        const stale = wsInstances[0]!

        hidden = true
        document.dispatchEvent(new Event('visibilitychange'))
        now.mockReturnValue(1_000_000 + 31_000)
        hidden = false
        document.dispatchEvent(new Event('visibilitychange'))

        expect(stale.close).toHaveBeenCalled()
        expect(wsInstances.length).toBe(2)
        await vi.waitFor(() => expect(statusHandler).toHaveBeenCalledWith('connected'))
        expect(statusHandler.mock.calls.map((c) => c[0])).toEqual(['disconnected', 'connected'])
      } finally {
        now.mockRestore()
      }
    })

    it('keeps an open socket after a short time hidden', async () => {
      const now = vi.spyOn(Date, 'now')
      try {
        now.mockReturnValue(1_000_000)
        const client = new WebSocketClient('ws://localhost:9999/ws')
        const statusHandler = vi.fn()
        client.onStatusChange(statusHandler)
        await connectClient(client, statusHandler)

        hidden = true
        document.dispatchEvent(new Event('visibilitychange'))
        now.mockReturnValue(1_000_000 + 5_000)
        hidden = false
        document.dispatchEvent(new Event('visibilitychange'))

        expect(wsInstances.length).toBe(1)
        expect(statusHandler).not.toHaveBeenCalled()
      } finally {
        now.mockRestore()
      }
    })

    it('does nothing when the socket is still open', async () => {
      const client = new WebSocketClient('ws://localhost:9999/ws')
      const statusHandler = vi.fn()
      client.onStatusChange(statusHandler)
      await connectClient(client, statusHandler)

      window.dispatchEvent(new Event('online'))
      document.dispatchEvent(new Event('visibilitychange'))

      expect(wsInstances.length).toBe(1)
    })

    it('does not reconnect after an intentional disconnect', async () => {
      const client = new WebSocketClient('ws://localhost:9999/ws')
      const statusHandler = vi.fn()
      client.onStatusChange(statusHandler)
      await connectClient(client, statusHandler)
      client.disconnect()

      window.dispatchEvent(new Event('online'))

      expect(wsInstances.length).toBe(1)
    })

    it('does not reconnect a client that never connected', () => {
      new WebSocketClient('ws://localhost:9999/ws')
      window.dispatchEvent(new Event('online'))
      expect(wsInstances.length).toBe(0)
    })
  })

  it('does not auto-reconnect after an intentional disconnect', async () => {
    const client = new WebSocketClient('ws://localhost:9999/ws')
    const statusHandler = vi.fn()
    client.onStatusChange(statusHandler)
    await connectClient(client, statusHandler)

    const oldSocket = wsInstances[0]
    if (!oldSocket) throw new Error('expected a connected socket')
    // A real browser fires onclose asynchronously after close(); MockWebSocket.close()
    // does not. Capture the live handler and invoke it after disconnect() so this
    // genuinely simulates the delayed close. disconnect() detaches the socket's own
    // handlers, so the captured reference is what exercises the intentionalClose guard
    // (a partial regression that kept detachment but dropped the flag would fail here).
    const delayedOnClose = oldSocket.onclose
    client.disconnect()
    statusHandler.mockClear()

    delayedOnClose?.({ code: 1005 } as { code: number })

    expect(statusHandler).not.toHaveBeenCalledWith('reconnecting')
    expect(wsInstances.length).toBe(1)
  })
})
