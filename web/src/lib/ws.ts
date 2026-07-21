import type { ClientMessage, ServerMessage, ClientMessageType } from '@shared/protocol.js'
import { isServerMessage } from '@shared/protocol.js'
import { generateUUID } from './uuid.js'
import { appUrl } from './basePath.js'

export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting'
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

  constructor(url: string) {
    this.baseUrl = url
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
    const isAuthFailure = this.lastCloseCode === 4000

    // Only auto-reconnect if NO token - with token, expect user to manually reconnect
    if (isAuthFailure && this.hasToken()) {
      console.warn('[WS] Auth failure or initial failure with token - not auto-reconnecting, awaiting user action')
      return
    }

    if (this.isReconnecting || this.manualReconnectScheduled) return
    this.isReconnecting = true
    this.statusHandler?.('reconnecting')

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts || 0), 30000)
    this.reconnectAttempts = (this.reconnectAttempts || 0) + 1

    setTimeout(() => {
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
    this.isReconnecting = false
    this.reconnectAttempts = 0
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
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
