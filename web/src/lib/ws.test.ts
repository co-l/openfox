// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

  beforeEach(async () => {
    vi.resetModules()
    wsEvents = { open: [], close: [], error: [] }
    wsInstances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
    localStorage.clear()

    const mod = await import('./ws')
    WebSocketClient = mod.WebSocketClient
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
