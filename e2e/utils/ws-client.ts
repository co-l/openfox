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
  /** Log all WebSocket messages to console */
  verbose?: boolean
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

  /** Consume the next event slice through a matching stop event */
  consumeEventsUntil(
    stopCondition: (event: ServerMessage) => boolean,
    timeout?: number
  ): Promise<ServerMessage[]>
  
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
  
  /** Answer a pending path confirmation (for e2e tests) */
  answerPathConfirmation(callId: string, approved: boolean): Promise<void>
}

export const DEFAULT_WAIT_TIMEOUT_MS = 1_500
export const DEFAULT_CHAT_TIMEOUT_MS = 1_500
export const DEFAULT_CONSUME_TIMEOUT_MS = 1_500

// ============================================================================
// Verbose Logging
// ============================================================================

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
}

// Accumulate streaming content
let streamingContent = ''
let streamingThinking = ''

function logMessage(msg: ServerMessage): void {
  const type = msg.type
  
  switch (type) {
    case 'chat.delta': {
      const p = msg.payload as { content?: string; thinkingContent?: string }
      if (p.content) streamingContent += p.content
      if (p.thinkingContent) streamingThinking += p.thinkingContent
      // Don't log individual deltas - too noisy
      break
    }
    
    case 'chat.thinking': {
      const p = msg.payload as { content?: string }
      if (p.content) streamingThinking += p.content
      // Don't log individual thinking events - will be flushed with tool calls or chat.done
      break
    }
    
    case 'chat.tool_call': {
      // Flush any accumulated content first
      if (streamingContent) {
        console.log(`\n${COLORS.bold}${COLORS.blue}── Agent Message ──${COLORS.reset}`)
        console.log(streamingContent.trim())
        streamingContent = ''
      }
      if (streamingThinking) {
        console.log(`\n${COLORS.dim}── Thinking ──${COLORS.reset}`)
        console.log(`${COLORS.dim}${streamingThinking.trim()}${COLORS.reset}`)
        streamingThinking = ''
      }
      
      const p = msg.payload as { tool: string; args: Record<string, unknown> }
      console.log(`\n${COLORS.yellow}▶ ${p.tool}${COLORS.reset}`)
      console.log(`${COLORS.dim}${JSON.stringify(p.args, null, 2)}${COLORS.reset}`)
      break
    }
    
    case 'chat.tool_result': {
      const p = msg.payload as { tool: string; result: { success: boolean; output?: string; error?: string } }
      const status = p.result.success 
        ? `${COLORS.green}✓ success${COLORS.reset}` 
        : `${COLORS.red}✗ failed${COLORS.reset}`
      console.log(`${COLORS.yellow}◀ ${p.tool}${COLORS.reset} ${status}`)
      const output = p.result.output ?? p.result.error ?? ''
      if (output) {
        // Show first 500 chars of output
        const preview = output.length > 500 ? output.slice(0, 500) + '\n... (truncated)' : output
        console.log(`${COLORS.dim}${preview}${COLORS.reset}`)
      }
      break
    }
    
    case 'chat.done': {
      // Flush any remaining content
      if (streamingContent) {
        console.log(`\n${COLORS.bold}${COLORS.blue}── Agent Message ──${COLORS.reset}`)
        console.log(streamingContent.trim())
        streamingContent = ''
      }
      if (streamingThinking) {
        console.log(`\n${COLORS.dim}── Thinking ──${COLORS.reset}`)
        console.log(`${COLORS.dim}${streamingThinking.trim()}${COLORS.reset}`)
        streamingThinking = ''
      }
      
      const p = msg.payload as { reason: string; stats?: { totalTokens?: number; durationMs?: number } }
      const tokens = p.stats?.totalTokens ? ` | ${p.stats.totalTokens} tokens` : ''
      const duration = p.stats?.durationMs ? ` | ${(p.stats.durationMs / 1000).toFixed(1)}s` : ''
      console.log(`\n${COLORS.green}── Done (${p.reason}${tokens}${duration}) ──${COLORS.reset}\n`)
      break
    }
    
    case 'criteria.updated': {
      const p = msg.payload as { criteria: Array<{ id: string; status: { type: string } }> }
      const summary = p.criteria.map(c => {
        const icon = c.status.type === 'passed' ? '✓' : c.status.type === 'failed' ? '✗' : '○'
        return `${icon} ${c.id}`
      }).join('  ')
      console.log(`${COLORS.magenta}[criteria] ${summary}${COLORS.reset}`)
      break
    }
    
    case 'phase.changed': {
      const p = msg.payload as { phase: string }
      console.log(`${COLORS.bold}${COLORS.magenta}══ Phase: ${p.phase.toUpperCase()} ══${COLORS.reset}`)
      break
    }
    
    case 'mode.changed': {
      const p = msg.payload as { mode: string }
      console.log(`${COLORS.cyan}[mode] ${p.mode}${COLORS.reset}`)
      break
    }
    
    case 'error': {
      const p = msg.payload as { code: string; message: string }
      console.log(`${COLORS.red}[ERROR] ${p.code}: ${p.message}${COLORS.reset}`)
      break
    }
    
    case 'session.state':
    case 'project.state':
    case 'context.state':
      // Skip noisy state messages
      break
    
    default: {
      console.log(`${COLORS.dim}[${type}]${COLORS.reset}`)
    }
  }
}

// ============================================================================
// Implementation
// ============================================================================

export async function createTestClient(options: TestClientOptions = {}): Promise<TestClient> {
  const url = options.url ?? process.env['OPENFOX_TEST_WS_URL'] ?? 'ws://localhost:3999/ws'
  const defaultTimeout = options.timeout ?? DEFAULT_WAIT_TIMEOUT_MS
  const verbose = options.verbose ?? process.env['OPENFOX_TEST_VERBOSE'] === 'true'
  
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
  let chatCursor = 0
  let collectionCursor = 0
  
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
      
      // Verbose logging
      if (verbose) {
        logMessage(msg)
      }
      
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

    consumeEventsUntil(
      stopCondition: (event: ServerMessage) => boolean,
      timeout = DEFAULT_CONSUME_TIMEOUT_MS
    ): Promise<ServerMessage[]> {
      return new Promise((resolve, reject) => {
        const findStopIndex = (): number => {
          for (let i = collectionCursor; i < events.length; i++) {
            if (stopCondition(events[i]!)) {
              return i
            }
          }
          return -1
        }

        const existingStopIndex = findStopIndex()
        if (existingStopIndex >= 0) {
          const collected = events.slice(collectionCursor, existingStopIndex + 1)
          collectionCursor = existingStopIndex + 1
          chatCursor = Math.max(chatCursor, collectionCursor)
          resolve(collected)
          return
        }

        const timer = setTimeout(() => {
          reject(new Error('Timeout collecting events'))
        }, timeout)

        const check = (): void => {
          const stopIndex = findStopIndex()
          if (stopIndex >= 0) {
            clearTimeout(timer)
            const collected = events.slice(collectionCursor, stopIndex + 1)
            collectionCursor = stopIndex + 1
            chatCursor = Math.max(chatCursor, collectionCursor)
            resolve(collected)
            return
          }

          if (!connected) {
            clearTimeout(timer)
            reject(new Error('WebSocket connection closed'))
            return
          }

          setTimeout(check, 10)
        }

        check()
      })
    },
    
    async waitForChatDone(timeout = DEFAULT_CHAT_TIMEOUT_MS): Promise<ChatResponse> {
      const findDoneIndex = (): number => {
        for (let i = chatCursor; i < events.length; i++) {
          if (events[i]!.type === 'chat.done') {
            return i
          }
        }
        return -1
      }

      let doneIndex = findDoneIndex()
      if (doneIndex < 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error('Timeout waiting for chat.done'))
          }, timeout)

          const check = (): void => {
            const nextDoneIndex = findDoneIndex()
            if (nextDoneIndex >= 0) {
              clearTimeout(timer)
              resolve()
              return
            }

            if (!connected) {
              clearTimeout(timer)
              reject(new Error('WebSocket connection closed'))
              return
            }

            setTimeout(check, 10)
          }

          check()
        })

        doneIndex = findDoneIndex()
      }

      if (doneIndex < 0) {
        throw new Error('chat.done received but not found in local event log')
      }

      const doneEvent = events[doneIndex] as ServerMessage<ChatDonePayload>
      const payload = doneEvent.payload
      const chatEvents = events.slice(chatCursor, doneIndex + 1)
      chatCursor = doneIndex + 1
      collectionCursor = Math.max(collectionCursor, chatCursor)
      
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
      chatCursor = 0
      collectionCursor = 0
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
    
    async answerPathConfirmation(callId: string, approved: boolean): Promise<void> {
      const id = crypto.randomUUID()
      const message: ClientMessage = {
        id,
        type: 'path.confirm',
        payload: { callId, approved },
      }
      ws.send(JSON.stringify(message))
      // No artificial delay - server processes synchronously
    },
  }
}
