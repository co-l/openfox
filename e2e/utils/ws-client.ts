/**
 * Typed WebSocket client for E2E tests.
 * 
 * Provides a high-level API for sending messages and waiting for responses.
 */

import { WebSocket } from 'ws'
import type {
  ClientMessage,
  ClientMessageType,
  ServerMessage,
  ServerMessageType,
  ChatDonePayload,
  SessionStatePayload,
  ProjectStatePayload,
} from '@openfox/shared/protocol'
import type { Session, Project, Message, ToolCall, ToolResult, MessageStats } from '@openfox/shared'

// ============================================================================
// Types
// ============================================================================

export interface TestClientOptions {
  url?: string
  timeout?: number
}

export interface ChatResponse {
  messageId: string
  content: string
  thinkingContent: string
  toolCalls: Array<{
    callId: string
    tool: string
    args: Record<string, unknown>
    result?: ToolResult | undefined
  }>
  stats: MessageStats | undefined
  reason: 'complete' | 'stopped' | 'error' | 'waiting_for_user'
}

export interface TestClient {
  /** Send a message and wait for acknowledgment or response */
  send<T>(type: ClientMessageType, payload: T): Promise<ServerMessage>
  
  /** Wait for a specific message type */
  waitFor<T = unknown>(
    type: ServerMessageType,
    predicate?: (payload: T) => boolean,
    timeout?: number
  ): Promise<ServerMessage<T>>
  
  /** Wait for chat to complete, collecting all events */
  waitForChatDone(timeout?: number): Promise<ChatResponse>
  
  /** Get all events received since connection/last clear */
  allEvents(): ServerMessage[]
  
  /** Clear collected events */
  clearEvents(): void
  
  /** Get the current session (after session.load/create) */
  getSession(): Session | null
  
  /** Get the current project (after project.load/create) */
  getProject(): Project | null
  
  /** Close the connection */
  close(): Promise<void>
  
  /** Check if connected */
  isConnected(): boolean
}

// ============================================================================
// Implementation
// ============================================================================

export async function createTestClient(options: TestClientOptions = {}): Promise<TestClient> {
  const url = options.url ?? process.env['OPENFOX_TEST_WS_URL'] ?? 'ws://localhost:3999/ws'
  const defaultTimeout = options.timeout ?? 30_000
  
  const ws = new WebSocket(url)
  const events: ServerMessage[] = []
  const pendingRequests = new Map<string, {
    resolve: (msg: ServerMessage) => void
    reject: (err: Error) => void
  }>()
  const eventWaiters: Array<{
    type: ServerMessageType
    predicate: ((payload: unknown) => boolean) | undefined
    resolve: (msg: ServerMessage) => void
    reject: (err: Error) => void
  }> = []
  
  let currentSession: Session | null = null
  let currentProject: Project | null = null
  let connected = false
  
  // Wait for connection
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`WebSocket connection timeout to ${url}`))
    }, 10_000)
    
    ws.on('open', () => {
      clearTimeout(timeout)
      connected = true
      resolve()
    })
    
    ws.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
  
  // Handle incoming messages
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString()) as ServerMessage
      events.push(msg)
      
      // Update session/project state from state messages
      if (msg.type === 'session.state') {
        const payload = msg.payload as SessionStatePayload
        currentSession = payload.session
      }
      if (msg.type === 'project.state') {
        const payload = msg.payload as ProjectStatePayload
        currentProject = payload.project
      }
      // Update criteria from criteria.updated events
      if (msg.type === 'criteria.updated' && currentSession) {
        const payload = msg.payload as { criteria: Session['criteria'] }
        currentSession = { ...currentSession, criteria: payload.criteria }
      }
      // Update mode from mode.changed events
      if (msg.type === 'mode.changed' && currentSession) {
        const payload = msg.payload as { mode: Session['mode'] }
        currentSession = { ...currentSession, mode: payload.mode }
      }
      // Update phase from phase.changed events
      if (msg.type === 'phase.changed' && currentSession) {
        const payload = msg.payload as { phase: Session['phase'] }
        currentSession = { ...currentSession, phase: payload.phase }
      }
      
      // Resolve pending requests by correlation ID
      if (msg.id) {
        const pending = pendingRequests.get(msg.id)
        if (pending) {
          pendingRequests.delete(msg.id)
          pending.resolve(msg)
        }
      }
      
      // Resolve event waiters
      for (let i = eventWaiters.length - 1; i >= 0; i--) {
        const waiter = eventWaiters[i]!
        if (waiter.type === msg.type) {
          if (!waiter.predicate || waiter.predicate(msg.payload)) {
            eventWaiters.splice(i, 1)
            waiter.resolve(msg)
          }
        }
      }
    } catch (err) {
      console.error('Failed to parse WebSocket message:', err)
    }
  })
  
  ws.on('close', () => {
    connected = false
    // Reject all pending requests
    for (const [, pending] of pendingRequests) {
      pending.reject(new Error('WebSocket connection closed'))
    }
    pendingRequests.clear()
    
    for (const waiter of eventWaiters) {
      waiter.reject(new Error('WebSocket connection closed'))
    }
    eventWaiters.length = 0
  })
  
  ws.on('error', (err) => {
    console.error('WebSocket error:', err)
  })
  
  // Helper function for waiting for events
  function waitForImpl<T = unknown>(
    type: ServerMessageType,
    predicate?: (payload: T) => boolean,
    timeout = defaultTimeout
  ): Promise<ServerMessage<T>> {
    return new Promise((resolve, reject) => {
      // Check if we already have a matching event
      for (const event of events) {
        if (event.type === type) {
          if (!predicate || predicate(event.payload as T)) {
            resolve(event as ServerMessage<T>)
            return
          }
        }
      }
      
      // Wait for future event
      const timer = setTimeout(() => {
        const idx = eventWaiters.findIndex(w => w.resolve === resolve as unknown)
        if (idx >= 0) eventWaiters.splice(idx, 1)
        reject(new Error(`Timeout waiting for ${type}`))
      }, timeout)
      
      eventWaiters.push({
        type,
        predicate: predicate as ((p: unknown) => boolean) | undefined,
        resolve: (msg) => {
          clearTimeout(timer)
          resolve(msg as ServerMessage<T>)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        },
      })
    })
  }
  
  return {
    send<T>(type: ClientMessageType, payload: T): Promise<ServerMessage> {
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID()
        const message: ClientMessage<T> = { id, type, payload }
        
        const timeout = setTimeout(() => {
          pendingRequests.delete(id)
          reject(new Error(`Timeout waiting for response to ${type}`))
        }, defaultTimeout)
        
        pendingRequests.set(id, {
          resolve: (msg) => {
            clearTimeout(timeout)
            resolve(msg)
          },
          reject: (err) => {
            clearTimeout(timeout)
            reject(err)
          },
        })
        
        ws.send(JSON.stringify(message))
      })
    },
    
    waitFor: waitForImpl,
    
    async waitForChatDone(timeout = 90_000): Promise<ChatResponse> {
      const startIdx = events.length
      
      // Wait for chat.done event
      const doneEvent = await waitForImpl<ChatDonePayload>('chat.done', undefined, timeout)
      const payload = doneEvent.payload
      
      // Collect all chat events since we started waiting
      const chatEvents = events.slice(startIdx)
      
      // Build response from events
      let content = ''
      let thinkingContent = ''
      const toolCalls: ChatResponse['toolCalls'] = []
      const toolResults = new Map<string, ToolResult>()
      
      for (const event of chatEvents) {
        switch (event.type) {
          case 'chat.delta':
            content += (event.payload as { content: string }).content
            break
          case 'chat.thinking':
            thinkingContent += (event.payload as { content: string }).content
            break
          case 'chat.tool_call': {
            const tc = event.payload as { callId: string; tool: string; args: Record<string, unknown> }
            toolCalls.push({
              callId: tc.callId,
              tool: tc.tool,
              args: tc.args,
            })
            break
          }
          case 'chat.tool_result': {
            const tr = event.payload as { callId: string; result: ToolResult }
            toolResults.set(tr.callId, tr.result)
            break
          }
        }
      }
      
      // Attach results to tool calls
      for (const tc of toolCalls) {
        const result = toolResults.get(tc.callId)
        if (result) {
          tc.result = result
        }
      }
      
      return {
        messageId: payload.messageId,
        content,
        thinkingContent,
        toolCalls,
        stats: payload.stats,
        reason: payload.reason,
      }
    },
    
    allEvents(): ServerMessage[] {
      return [...events]
    },
    
    clearEvents(): void {
      events.length = 0
    },
    
    getSession(): Session | null {
      return currentSession
    },
    
    getProject(): Project | null {
      return currentProject
    },
    
    async close(): Promise<void> {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close()
        await new Promise<void>((resolve) => {
          ws.on('close', resolve)
          setTimeout(resolve, 1000) // Timeout if close event doesn't fire
        })
      }
    },
    
    isConnected(): boolean {
      return connected && ws.readyState === WebSocket.OPEN
    },
  }
}
