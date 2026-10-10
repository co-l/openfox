import type { ClientMessage, ServerMessage, ClientMessageType } from '@shared/protocol.js'
import { isServerMessage } from '@shared/protocol.js'
import { generateUUID } from './uuid.js'
import { appUrl } from './basePath.js'

export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting'

// A phone suspends a background page and its socket can die without a close
// event: after being hidden this long, a socket that still reads OPEN is
// replaced rather than trusted (a resume only replays the missed events).
const STALE_AFTER_HIDDEN_MS = 30_000
type MessageHandler = (message: ServerMessage) => void
type StatusHandler = (status: ConnectionStatus) => void

export class WebSocketClient {
  private ws: WebSocket | null = null
  private handlers = new Set<MessageHandler>()
  private statusHandler: StatusHandler | null = null
  private baseUrl: string
  private isReconnecting = false
  private connectingPromise: Promise<void> | null = null
  private lastCloseCode: number = 0
  private reconnectAttempts: number = 0
  private manualReconnectScheduled = false // User triggered reconnect pending
  private pwaRecoveryAttempted = false
  private intentionalClose = false
  private hasConnected = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  // Set when a resume happens while an attempt is still dialing: that attempt
  // may be going to the network that just dropped, so if it fails, retry at
  // once instead of waiting the next (up to 30 s) backoff step.
  private resumeRequested = false
  // When the page was last hidden (null while visible).
  private hiddenSince: number | null = null

  constructor(url: string) {
    this.baseUrl = url
    // Mobile browsers drop the socket while the page is in the background, and
    // the backoff timer is frozen with it: without these, coming back could
    // wait up to 30 s for the next attempt.
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.resume)
      window.addEventListener('pageshow', this.resume)
      document.addEventListener('visibilitychange', this.resume)
    }
  }

  /**
   * Reconnect right away when the network comes back or the page is shown
   * again, dropping any pending backoff attempt. While an attempt is still
   * connecting, only make its failure retry at once. A socket still open is
   * kept, unless the page was hidden long enough for it to have died silently.
   * No-op after an intentional disconnect, before the first connect, or after
   * an auth failure waiting for the user.
   */
  private resume = (): void => {
    if (typeof document !== 'undefined' && document.hidden) {
      this.hiddenSince ??= Date.now()
      return
    }
    const hiddenFor = this.hiddenSince === null ? 0 : Date.now() - this.hiddenSince
    this.hiddenSince = null
    if (!this.hasConnected || this.intentionalClose) return
    const state = this.ws?.readyState
    if (state === WebSocket.OPEN) {
      if (hiddenFor >= STALE_AFTER_HIDDEN_MS) this.replaceSocket()
      return
    }
    if (state === WebSocket.CONNECTING) {
      this.resumeRequested = true
      return
    }
    if (this.lastCloseCode === 4000 && this.hasToken()) return
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.isReconnecting = false
    this.manualReconnectScheduled = false
    this.reconnectAttempts = 0
    this.connect().catch(() => {
      // a failed attempt closes the socket, which resumes the normal backoff
    })
  }

  /**
   * Drop a socket that may be dead without knowing it and connect again. The
   * status goes through 'disconnected' then 'connected', like a real drop, so
   * the session resumes from its last applied event.
   */
  private replaceSocket(): void {
    const socket = this.ws
    if (socket) {
      this.ws = null
      socket.onopen = null
      socket.onclose = null
      socket.onerror = null
      socket.onmessage = null
      socket.close()
    }
    this.connectingPromise = null
    this.reconnectAttempts = 0
    this.statusHandler?.('disconnected')
    this.connect().catch(() => {
      // a failed attempt closes the socket, which resumes the normal backoff
    })
  }

  private getUrl(): string {
    const token = localStorage.getItem('openfox_token')
    if (token) {
      const separator = this.baseUrl.includes('?') ? '&' : '?'
      return `${this.baseUrl}${separator}token=${encodeURIComponent(token)}`
    }
    return this.baseUrl
  }

  setToken(token: string): void {
    localStorage.setItem('openfox_token', token)
  }

  clearToken(): void {
    localStorage.removeItem('openfox_token')
  }

  hasToken(): boolean {
    return !!localStorage.getItem('openfox_token')
  }

  getLastCloseCode(): number {
    return this.lastCloseCode
  }

  onStatusChange(handler: StatusHandler): void {
    this.statusHandler = handler
  }

  connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve()
    }

    this.lastCloseCode = 0
    this.isReconnecting = false

    if (this.connectingPromise && this.ws?.readyState === WebSocket.CONNECTING) {
      return this.connectingPromise
    }

    this.lastCloseCode = 0
    this.isReconnecting = false

    if (this.connectingPromise && this.ws?.readyState === WebSocket.CONNECTING) {
      console.warn('[WS CLIENT] Connection already in progress, returning existing promise')
      return this.connectingPromise
    }

    this.intentionalClose = false
    this.hasConnected = true
    this.connectingPromise = new Promise((resolve, reject) => {
      try {
        const url = this.getUrl()
        this.ws = new WebSocket(url)

        const timeout = setTimeout(() => {
          if (this.ws?.readyState === WebSocket.CONNECTING) {
            this.ws.close()
            reject(new Error('Connection timeout'))
          }
        }, 5000)

        this.ws.onopen = () => {
          clearTimeout(timeout)
          this.isReconnecting = false
          this.reconnectAttempts = 0
          this.resumeRequested = false
          this.connectingPromise = null
          this.statusHandler?.('connected')
          resolve()
        }

        this.ws.onclose = (event) => {
          clearTimeout(timeout)
          this.lastCloseCode = event.code
          if (this.ws?.readyState === WebSocket.CONNECTING) {
            this.connectingPromise = null
            this.statusHandler?.('disconnected')
            reject(new Error(`Connection closed: ${event.code}`))
          } else {
            this.connectingPromise = null
            this.statusHandler?.('disconnected')
            this.attemptReconnect()
          }
        }

        this.ws.onerror = (error) => {
          clearTimeout(timeout)
          console.error('WebSocket error:', error)
          this.connectingPromise = null
          reject(error)
        }

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            if (isServerMessage(data)) {
              this.handlers.forEach((handler) => handler(data))
            }
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error)
          }
        }
      } catch (error) {
        this.connectingPromise = null
        reject(error)
      }
    })

    return this.connectingPromise
  }

  private async recoverPwaStuckConnection(): Promise<void> {
    if (this.pwaRecoveryAttempted) return
    const isPwa = window.matchMedia('(display-mode: standalone)').matches
    if (!isPwa || !('serviceWorker' in navigator)) return

    this.pwaRecoveryAttempted = true
    const registrations = await navigator.serviceWorker.getRegistrations()
    if (registrations.length === 0) return

    console.warn('[WS] PWA mode detected with stale service worker — unregistering and reloading')
    await Promise.all(registrations.map((r) => r.unregister()))
    window.location.reload()
  }

  private attemptReconnect(): void {
    // A user-initiated disconnect must never be overridden by auto-reconnect.
    if (this.intentionalClose) return

    const isAuthFailure = this.lastCloseCode === 4000

    // Only auto-reconnect if NO token - with token, expect user to manually reconnect
    if (isAuthFailure && this.hasToken()) {
      console.warn('[WS] Auth failure or initial failure with token - not auto-reconnecting, awaiting user action')
      return
    }

    if (this.isReconnecting || this.manualReconnectScheduled) return
    this.isReconnecting = true
    this.statusHandler?.('reconnecting')

    let delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts || 0), 30000)
    if (this.resumeRequested) {
      this.resumeRequested = false
      this.reconnectAttempts = 0
      delay = 0
    }
    this.reconnectAttempts = (this.reconnectAttempts || 0) + 1

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.isReconnecting = false
      this.manualReconnectScheduled = false
      this.connect().catch(() => {
        // After several failed attempts, try PWA recovery
        if (this.reconnectAttempts >= 3) {
          this.recoverPwaStuckConnection()
        }
      })
    }, delay)
  }

  reconnect(): void {
    this.manualReconnectScheduled = true
    this.isReconnecting = false
    this.lastCloseCode = 0
    this.connectingPromise = null
    this.connect().catch(() => {
      this.recoverPwaStuckConnection()
    })
  }

  disconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.isReconnecting = false
    this.reconnectAttempts = 0
    this.intentionalClose = true
    if (this.ws) {
      const socket = this.ws
      this.ws = null
      // Detach handlers so a delayed close() completion (real browsers fire
      // onclose asynchronously) cannot schedule an auto-reconnect or race a
      // freshly-created socket from a subsequent connect().
      socket.onopen = null
      socket.onclose = null
      socket.onerror = null
      socket.onmessage = null
      socket.close()
    }
    this.connectingPromise = null
  }

  resetReconnectAttempts(): void {
    this.reconnectAttempts = 0
  }

  send<T>(type: ClientMessageType, payload: T): string {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected')
    }

    const id = generateUUID()
    const message: ClientMessage<T> = { id, type, payload }
    this.ws.send(JSON.stringify(message))
    return id
  }

  subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}

// Singleton instance
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
let port = window.location.port
if (!port) {
  port =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? '10469'
      : window.location.protocol === 'https:'
        ? '443'
        : '80'
}
const wsUrl = `${protocol}//${window.location.hostname}:${port}${appUrl('/ws')}`
export const wsClient = new WebSocketClient(wsUrl)
