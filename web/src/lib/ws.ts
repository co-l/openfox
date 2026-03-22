import type { ClientMessage, ServerMessage, ClientMessageType } from '../../../src/shared/protocol.js'
import { isServerMessage } from '../../../src/shared/protocol.js'
import { generateUUID } from './uuid.js'

export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting'
type MessageHandler = (message: ServerMessage) => void
type StatusHandler = (status: ConnectionStatus) => void

class WebSocketClient {
  private ws: WebSocket | null = null
  private handlers = new Set<MessageHandler>()
  private statusHandler: StatusHandler | null = null
  private url: string
  private isReconnecting = false
  private connectingPromise: Promise<void> | null = null
  
  constructor(url: string) {
    this.url = url
  }
  
  onStatusChange(handler: StatusHandler): void {
    this.statusHandler = handler
  }
  
  connect(): Promise<void> {
    // Already connected
    if (this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve()
    }
    
    // Connection in progress - return existing promise
    if (this.connectingPromise) {
      return this.connectingPromise
    }
    
    this.connectingPromise = new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url)
        
        this.ws.onopen = () => {
          this.isReconnecting = false
          this.connectingPromise = null
          this.statusHandler?.('connected')
          resolve()
        }
        
        this.ws.onclose = () => {
          this.connectingPromise = null
          this.statusHandler?.('disconnected')
          this.attemptReconnect()
        }
        
        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error)
          this.connectingPromise = null
          reject(error)
        }
        
        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            if (isServerMessage(data)) {
              this.handlers.forEach(handler => handler(data))
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
  
  private attemptReconnect(): void {
    if (this.isReconnecting) return
    this.isReconnecting = true
    this.statusHandler?.('reconnecting')
    
    setTimeout(() => {
      this.isReconnecting = false
      this.connect().catch(() => {
        // Will trigger onclose -> attemptReconnect again
      })
    }, 5000)
  }
  
  disconnect(): void {
    this.isReconnecting = false
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
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
const wsUrl = `ws://${window.location.hostname}:${window.location.port || '10369'}/ws`
export const wsClient = new WebSocketClient(wsUrl)
