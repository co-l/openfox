import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import WebSocket from 'ws'
import { createWebSocketServer } from './server.js'
import type { SessionManager } from '../session/index.js'
import { getEventStore, initEventStore } from '../events/index.js'
import type Database from 'better-sqlite3'

vi.mock('better-sqlite3', () => ({
  default: class MockDatabase {
    exec = vi.fn()
    prepare = vi.fn(() => ({
      run: vi.fn(() => ({ changes: 0 })),
      get: vi.fn(() => ({ max_seq: 0 })),
      all: vi.fn(() => []),
    }))
    transaction = vi.fn((fn) => fn)
  },
}))

vi.mock('../config.js', () => ({
  loadConfig: vi.fn(() => ({
    llm: {
      baseUrl: 'http://localhost:1234',
      model: 'test-model',
      timeout: 60000,
      idleTimeout: 60000,
      backend: 'auto' as const,
    },
    workdir: '/tmp/test',
    maxContextTokens: 8192,
    llmClientTimeout: 60000,
  })),
}))

vi.mock('../llm/index.js', () => ({
  createLLMClient: vi.fn(() => ({
    getModel: vi.fn(() => 'test-model'),
    getBackend: vi.fn(() => 'unknown' as const),
    setBackend: vi.fn(),
    setModel: vi.fn(),
    stream: vi.fn(),
    getProfile: vi.fn(() => ({ name: 'test' })),
    complete: vi.fn(),
  })),
}))

vi.mock('../session/index.js', () => ({
  createSessionManager: vi.fn(() => ({
    getSession: vi.fn(),
    requireSession: vi.fn(),
    getQueueState: vi.fn(() => ({ messages: [] })),
    drainAsapMessages: vi.fn(() => []),
    drainCompletionMessages: vi.fn(() => []),
    clearMessageQueue: vi.fn(),
    getContextState: vi.fn(() => ({ currentTokens: 0, maxTokens: 1000 })),
    setCurrentContextSize: vi.fn(),
    setRunning: vi.fn(),
    setPhase: vi.fn(),
    subscribe: vi.fn(),
    getLspManager: vi.fn(),
  })),
}))

vi.mock('../provider-manager.js', () => ({
  createProviderManager: vi.fn(),
}))

vi.mock('../dev-server/manager.js', () => ({
  devServerManager: {
    onOutput: vi.fn(),
    onStateChange: vi.fn(),
  },
}))

vi.mock('../tools/background-process/manager.js', () => ({
  onProcessEvent: vi.fn(),
}))

vi.mock('../auth.js', () => ({
  getAuthConfig: vi.fn(() => null),
  isValidToken: vi.fn(() => true),
}))

describe('WebSocket Message Ordering Integration', () => {
  let httpServer: ReturnType<typeof createServer>
  let port: number
  let wsUrl: string

  beforeEach(async () => {
    httpServer = createServer()
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => resolve())
    })
    const address = httpServer.address()
    if (typeof address === 'string') {
      port = parseInt(address.split(':').pop() || '0')
    } else if (address) {
      port = address.port
    } else {
      throw new Error('Could not get server port')
    }
    wsUrl = `ws://localhost:${port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve())
    })
  })

  it('delivers events in strict FIFO order via real WebSocket connection', async () => {
    const config = {
      llm: {
        baseUrl: 'http://localhost:1234',
        model: 'test-model',
        timeout: 60000,
        idleTimeout: 60000,
        backend: 'auto' as const,
      },
      workdir: '/tmp/test',
      maxContextTokens: 8192,
      llmClientTimeout: 60000,
    }

    let seqCounter = 0
    const mockDb = {
      exec: vi.fn(),
      prepare: vi.fn(() => ({
        run: vi.fn(() => ({ changes: 0 })),
        get: vi.fn(() => ({ max_seq: seqCounter++ })),
        all: vi.fn(() => []),
      })),
      transaction: vi.fn((fn) => fn),
    } as unknown as Database.Database

    initEventStore(mockDb)
    const eventStoreInternal = getEventStore()

    const sessionManager = {
      getSession: vi.fn(() => ({
        id: 'test-session',
        projectId: 'test-project',
        workdir: '/tmp/test',
        mode: 'builder',
        phase: 'build',
        isRunning: false,
        criteria: [],
        summary: 'test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
        contextWindows: [],
        executionState: null,
        metadata: {
          totalTokensUsed: 0,
          totalToolCalls: 0,
          iterationCount: 0,
        },
      })),
      requireSession: vi.fn(() => ({
        id: 'test-session',
        projectId: 'test-project',
        workdir: '/tmp/test',
        mode: 'builder',
        phase: 'build',
        isRunning: false,
        criteria: [],
        summary: 'test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
        contextWindows: [],
        executionState: null,
        metadata: {
          totalTokensUsed: 0,
          totalToolCalls: 0,
          iterationCount: 0,
        },
      })),
      getQueueState: vi.fn(() => ({ messages: [] })),
      drainAsapMessages: vi.fn(() => []),
      drainCompletionMessages: vi.fn(() => []),
      clearMessageQueue: vi.fn(),
      getContextState: vi.fn(() => ({ currentTokens: 0, maxTokens: 1000 })),
      setCurrentContextSize: vi.fn(),
      setRunning: vi.fn(),
      setPhase: vi.fn(),
      subscribe: vi.fn(),
      getLspManager: vi.fn(),
    } as unknown as SessionManager

    const wss = createWebSocketServer(
      httpServer,
      config as any,
      () =>
        ({
          getModel: vi.fn(() => 'test-model'),
          getBackend: vi.fn(() => 'unknown' as const),
          setBackend: vi.fn(),
          setModel: vi.fn(),
          stream: vi.fn(),
          getProfile: vi.fn(() => ({ name: 'test' })),
          complete: vi.fn(),
        }) as any,
      undefined,
      sessionManager,
    )

    // Connect WebSocket client
    const client = new WebSocket(wsUrl)
    await new Promise<void>((resolve) => client.once('open', resolve))

    const receivedMessages: Array<{ type: string; content?: string }> = []

    client.on('message', (data) => {
      const message = JSON.parse(data.toString())
      receivedMessages.push({ type: message.type, content: message.payload?.content })
    })

    // Wait for connection to be established
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Emit multiple events rapidly through EventStore
    const eventTypes = [
      'message.start',
      'message.delta',
      'message.delta',
      'message.thinking',
      'message.done',
      'chat.done',
    ]

    eventTypes.forEach((type, index) => {
      eventStoreInternal.append('test-session', {
        type: type as any,
        data: { messageId: `msg-${index}`, content: `content-${index}` },
      })
    })

    // Wait for all events to be processed and sent
    await new Promise((resolve) => setTimeout(resolve, 300))

    // Verify events were received in strict FIFO order. Live streaming
    // events are ephemeral (seq 0) and only tree-persisted nodes carry
    // tree seqs, so ordering is asserted on the wire types — the WebSocket
    // transport itself is ordered.
    expect(receivedMessages.length).toBe(eventTypes.length)
    expect(receivedMessages.map((m) => m.type)).toEqual([
      'chat.message',
      'chat.delta',
      'chat.delta',
      'chat.thinking',
      'chat.message_updated',
      'chat.done',
    ])
    expect(receivedMessages[1]!.content).toBe('content-1')
    expect(receivedMessages[2]!.content).toBe('content-2')

    client.close()
    wss.close()
  })

  it('maintains order across 50 rapid emissions', async () => {
    const config = {
      llm: {
        baseUrl: 'http://localhost:1234',
        model: 'test-model',
        timeout: 60000,
        idleTimeout: 60000,
        backend: 'auto' as const,
      },
      workdir: '/tmp/test',
      maxContextTokens: 8192,
      llmClientTimeout: 60000,
    }

    let seqCounter = 0
    const mockDb = {
      exec: vi.fn(),
      prepare: vi.fn(() => ({
        run: vi.fn(() => ({ changes: 0 })),
        get: vi.fn(() => ({ max_seq: seqCounter++ })),
        all: vi.fn(() => []),
      })),
      transaction: vi.fn((fn) => fn),
    } as unknown as Database.Database

    initEventStore(mockDb)
    const eventStoreInternal = getEventStore()

    const sessionManager = {
      getSession: vi.fn(() => ({
        id: 'test-session-2',
        projectId: 'test-project',
        workdir: '/tmp/test',
        mode: 'builder',
        phase: 'build',
        isRunning: false,
        criteria: [],
        summary: 'test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
        contextWindows: [],
        executionState: null,
        metadata: {
          totalTokensUsed: 0,
          totalToolCalls: 0,
          iterationCount: 0,
        },
      })),
      requireSession: vi.fn(() => ({
        id: 'test-session-2',
        projectId: 'test-project',
        workdir: '/tmp/test',
        mode: 'builder',
        phase: 'build',
        isRunning: false,
        criteria: [],
        summary: 'test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
        contextWindows: [],
        executionState: null,
        metadata: {
          totalTokensUsed: 0,
          totalToolCalls: 0,
          iterationCount: 0,
        },
      })),
      getQueueState: vi.fn(() => ({ messages: [] })),
      drainAsapMessages: vi.fn(() => []),
      drainCompletionMessages: vi.fn(() => []),
      clearMessageQueue: vi.fn(),
      getContextState: vi.fn(() => ({ currentTokens: 0, maxTokens: 1000 })),
      setCurrentContextSize: vi.fn(),
      setRunning: vi.fn(),
      setPhase: vi.fn(),
      subscribe: vi.fn(),
      getLspManager: vi.fn(),
    } as unknown as SessionManager

    const wss = createWebSocketServer(
      httpServer,
      config as any,
      () =>
        ({
          getModel: vi.fn(() => 'test-model'),
          getBackend: vi.fn(() => 'unknown' as const),
          setBackend: vi.fn(),
          setModel: vi.fn(),
          stream: vi.fn(),
          getProfile: vi.fn(() => ({ name: 'test' })),
          complete: vi.fn(),
        }) as any,
      undefined,
      sessionManager,
    )

    const client = new WebSocket(wsUrl)
    await new Promise<void>((resolve) => client.once('open', resolve))

    const receivedMessages: Array<{ type: string; content?: string }> = []

    client.on('message', (data) => {
      const message = JSON.parse(data.toString())
      receivedMessages.push({ type: message.type, content: message.payload?.content })
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    // Emit 50 events rapidly
    for (let i = 0; i < 50; i++) {
      eventStoreInternal.append('test-session-2', {
        type: 'message.delta' as any,
        data: { messageId: `msg-${i}`, content: `content-${i}` },
      })
    }

    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(receivedMessages.length).toBe(50)
    // Check delivery order: every delta arrives in emission order
    expect(receivedMessages.map((m) => m.type)).toEqual(Array(50).fill('chat.delta'))
    expect(receivedMessages.map((m) => m.content)).toEqual(Array.from({ length: 50 }, (_, i) => `content-${i}`))

    client.close()
    wss.close()
  })
})
