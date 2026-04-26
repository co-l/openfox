import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import WebSocket from 'ws'
import type { StoredEvent, TurnEvent } from '../events/types.js'

const {
  createProjectMock,
  getProjectMock,
  listProjectsMock,
  updateProjectMock,
  deleteProjectMock,
  getSettingMock,
  setSettingMock,
  getAllInstructionsMock,
  getToolRegistryForModeMock,
  providePathConfirmationMock,
  runChatTurnMock,
  runOrchestratorMock,
  streamLLMPureMock,
  consumeStreamGeneratorMock,
  streamLLMResponseMock,
  getEventStoreMock,
  getContextMessagesMock,
  getCurrentContextWindowIdMock,
  getEnabledSkillMetadataMock,
  getRuntimeConfigMock,
  getGlobalConfigDirMock,
  generateSessionSummaryMock,
} = vi.hoisted(() => ({
  createProjectMock: vi.fn(),
  getProjectMock: vi.fn(),
  listProjectsMock: vi.fn(),
  updateProjectMock: vi.fn(),
  deleteProjectMock: vi.fn(),
  getSettingMock: vi.fn(),
  setSettingMock: vi.fn(),
  getAllInstructionsMock: vi.fn(),
  getToolRegistryForModeMock: vi.fn(),
  providePathConfirmationMock: vi.fn(),
  runChatTurnMock: vi.fn(),
  runOrchestratorMock: vi.fn(),
  streamLLMPureMock: vi.fn(),
  consumeStreamGeneratorMock: vi.fn(),
  streamLLMResponseMock: vi.fn(),
  getEventStoreMock: vi.fn(),
  getContextMessagesMock: vi.fn(),
  getCurrentContextWindowIdMock: vi.fn(),
  getEnabledSkillMetadataMock: vi.fn(),
  getRuntimeConfigMock: vi.fn(),
  getGlobalConfigDirMock: vi.fn(),
  generateSessionSummaryMock: vi.fn(),
}))

vi.mock('../db/projects.js', () => ({
  createProject: createProjectMock,
  getProject: getProjectMock,
  listProjects: listProjectsMock,
  updateProject: updateProjectMock,
  deleteProject: deleteProjectMock,
}))

vi.mock('../db/settings.js', () => ({
  getSetting: getSettingMock,
  setSetting: setSettingMock,
}))

// db/sessions.js mock removed - messages are now stored in EventStore only

vi.mock('../context/instructions.js', () => ({
  getAllInstructions: getAllInstructionsMock,
}))

vi.mock('../skills/registry.js', () => ({
  getEnabledSkillMetadata: getEnabledSkillMetadataMock,
}))

vi.mock('../runtime-config.js', () => ({
  getRuntimeConfig: getRuntimeConfigMock,
}))

vi.mock('../../cli/paths.js', () => ({
  getGlobalConfigDir: getGlobalConfigDirMock,
}))

vi.mock('../session/summary-generator.js', () => ({
  generateSessionSummary: generateSessionSummaryMock,
  needsSummaryGeneration: vi.fn((summary: string | null) => summary === null || summary.trim() === ''),
}))

vi.mock('../tools/index.js', () => ({
  getToolRegistryForMode: getToolRegistryForModeMock,
  getToolRegistryForAgent: vi.fn(() => ({
    definitions: [{ type: 'function', function: { name: 'read_file', description: 'Read', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }],
  })),
  providePathConfirmation: providePathConfirmationMock,
  addAllowedPaths: vi.fn(),
  cancelQuestionsForSession: vi.fn(),
  cancelPathConfirmationsForSession: vi.fn(),
}))

vi.mock('../agents/registry.js', () => {
  const agents = [
    {
      metadata: { id: 'planner', name: 'Planner', description: 'Plans work', subagent: false, tools: ['read_file', 'glob', 'grep', 'web_fetch', 'run_command', 'git', 'get_criteria', 'add_criterion', 'update_criterion', 'remove_criterion', 'call_sub_agent', 'load_skill'] },
      prompt: '# Plan Mode',
    },
    {
      metadata: { id: 'builder', name: 'Builder', description: 'Builds work', subagent: false, tools: ['read_file', 'glob', 'grep', 'web_fetch', 'write_file', 'edit_file', 'run_command', 'ask_user', 'complete_criterion', 'get_criteria', 'todo_write', 'call_sub_agent', 'load_skill'] },
      prompt: '# Build Mode',
    },
    {
      metadata: { id: 'verifier', name: 'Verifier', description: 'Verify criteria', subagent: true, tools: ['read_file', 'run_command', 'pass_criterion', 'fail_criterion'] },
      prompt: 'You are a verifier',
    },
  ]
  return {
    loadBuiltinAgents: vi.fn(async () => agents),
    loadAllAgentsDefault: vi.fn(async () => agents),
    findAgentById: vi.fn((id: string, list: any[]) => list.find((a: any) => a.metadata.id === id)),
    getSubAgents: vi.fn((list: any[]) => list.filter((a: any) => a.metadata.subagent)),
  }
})

vi.mock('../runner/index.js', () => ({
  runOrchestrator: runOrchestratorMock,
}))

vi.mock('../chat/stream.js', () => ({
  streamLLMResponse: streamLLMResponseMock,
}))

vi.mock('../chat/stream-pure.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../chat/stream-pure.js')>()
  return {
    ...actual,
    streamLLMPure: streamLLMPureMock,
    consumeStreamGenerator: consumeStreamGeneratorMock,
    consumeStreamWithToolLoop: consumeStreamGeneratorMock,
  }
})

vi.mock('../chat/orchestrator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../chat/orchestrator.js')>()
  return {
    ...actual,
    runChatTurn: runChatTurnMock,
  }
})

vi.mock('../events/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../events/index.js')>()
  return {
    ...actual,
    getEventStore: getEventStoreMock,
    getContextMessages: getContextMessagesMock,
    getCurrentContextWindowId: getCurrentContextWindowIdMock,
  }
})

import { createWebSocketServer } from './server.js'

type TestMessage = { id?: string; type: string; payload: Record<string, unknown>; seq?: number; sessionId?: string }

function createEventStore() {
  const eventsBySession = new Map<string, Array<{ seq: number; sessionId: string; timestamp: number; type: string; data: unknown }>>()
  const subscribers = new Map<string, { resolve: (event: { seq: number; sessionId: string; timestamp: number; type: string; data: unknown }) => void; event: { seq: number; sessionId: string; timestamp: number; type: string; data: unknown } }>()
  let globalResolveNext: ((event: { seq: number; sessionId: string; timestamp: number; type: string; data: unknown }) => void) | null = null

  const mockDb = {
    prepare: vi.fn((query: string) => ({
      all: vi.fn((...args: unknown[]) => {
        // Mock query for recent user prompts - return empty array
        if (query.includes('SELECT payload') && query.includes('chat.message')) {
          return []
        }
        return []
      }),
      get: vi.fn(() => undefined),
      run: vi.fn(() => ({ changes: 0 })),
    })),
  }

  return {
    append: vi.fn((sessionId: string, event: { type: string; data: unknown }) => {
      const existing = eventsBySession.get(sessionId) ?? []
      const stored = {
        seq: existing.length + 1,
        sessionId,
        timestamp: Date.now(),
        type: event.type,
        data: event.data,
      }
      eventsBySession.set(sessionId, [...existing, stored])
      
      // Notify subscriber if exists
      const subscriber = subscribers.get(sessionId)
      if (subscriber) {
        subscriber.resolve(stored)
        subscribers.delete(sessionId)
      }

      // Notify global subscriber
      if (globalResolveNext) {
        ;(globalResolveNext as any)(stored)
      }

      return stored
    }),
    getEvents: vi.fn((sessionId: string) => eventsBySession.get(sessionId) ?? []),
    getLatestSnapshot: vi.fn((sessionId: string) => {
      const events = eventsBySession.get(sessionId) ?? []
      return [...events].reverse().find((event) => event.type === 'turn.snapshot')
    }),
    getLatestSeq: vi.fn((sessionId: string) => {
      const events = eventsBySession.get(sessionId) ?? []
      return events.at(-1)?.seq ?? null
    }),
    subscribe: vi.fn((sessionId: string) => {
      const events = eventsBySession.get(sessionId) ?? []
      let index = 0
      let pendingResolve: ((event: { seq: number; sessionId: string; timestamp: number; type: string; data: unknown }) => void) | null = null
      
      return {
        iterator: (async function* () {
          // Yield existing events first
          for (const event of events) {
            yield event
            index++
          }
          
          // Then yield new events as they're appended
          while (true) {
            const currentEvents = eventsBySession.get(sessionId) ?? []
            if (index < currentEvents.length) {
              yield currentEvents[index]
              index++
            } else {
              // Wait for next append
              yield await new Promise<{ seq: number; sessionId: string; timestamp: number; type: string; data: unknown }>((resolve) => {
                pendingResolve = resolve
                subscribers.set(sessionId, { resolve, event: null as any })
              })
              index++
            }
          }
        })(),
        unsubscribe: vi.fn(() => {
          subscribers.delete(sessionId)
        }),
      }
    }),
    subscribeAll: vi.fn(() => {
      return {
        iterator: (async function* () {
          // Wait for events from append
          while (true) {
            const event = await new Promise<{ seq: number; sessionId: string; timestamp: number; type: string; data: unknown }>((resolve) => {
              globalResolveNext = resolve
            })
            yield event
          }
        })(),
        unsubscribe: vi.fn(() => {
          globalResolveNext = null
        }),
      }
    }),
    db: mockDb,
  }
}

function createSessionManager(overrides: Record<string, unknown> = {}) {
  const session = {
    id: 'session-1',
    projectId: 'project-1',
    workdir: '/tmp/project',
    mode: 'planner' as const,
    phase: 'plan' as const,
    isRunning: false,
    criteria: [] as Array<Record<string, unknown>>,
    summary: null,
    metadata: { totalTokensUsed: 0, totalToolCalls: 0, iterationCount: 0 },
  }

  const manager = {
    session,
    subscribe: vi.fn(() => () => {}),
    createSession: vi.fn(() => session),
    getSession: vi.fn(() => session),
    requireSession: vi.fn(() => session),
    getContextState: vi.fn(() => ({ currentTokens: 10, maxTokens: 200000, compactionCount: 0, dangerZone: false, canCompact: false })),
    listSessions: vi.fn(() => [{ id: session.id, projectId: session.projectId, workdir: session.workdir, mode: session.mode, phase: session.phase, isRunning: session.isRunning, createdAt: 'a', updatedAt: 'b', criteriaCount: 0, criteriaCompleted: 0 }]),
    deleteSession: vi.fn(),
    addMessage: vi.fn((_sessionId, message) => ({ id: `msg-${Math.random()}`, timestamp: '2024-01-01T00:00:00.000Z', ...message })),
    setRunning: vi.fn((_sessionId, isRunning: boolean) => ({ ...session, isRunning })),
    setMode: vi.fn((_sessionId, mode: 'planner' | 'builder') => ({ ...session, mode })),
    setPhase: vi.fn((_sessionId, phase: string) => ({ ...session, phase })),
    resetAllCriteriaAttempts: vi.fn(),
    setSummary: vi.fn(),
    setCriteria: vi.fn(),
    compactContext: vi.fn(),
    updateMessageStats: vi.fn(),
    updateMessage: vi.fn(),
    getCurrentWindowMessages: vi.fn(() => []),
    queueMessage: vi.fn((_sessionId, _mode, content, _attachments, _messageKind) => ({
      queueId: `queue-${Math.random()}`,
      mode: _mode,
      content,
      queuedAt: new Date().toISOString(),
    })),
    getQueueState: vi.fn(() => []),
    cancelQueuedMessage: vi.fn(() => true),
    drainAsapMessages: vi.fn(() => []),
    drainCompletionMessages: vi.fn(() => []),
    clearMessageQueue: vi.fn(),
    ...overrides,
  }

  return manager
}

async function createHarness(options: {
  sessionManager?: ReturnType<typeof createSessionManager>
  eventStore?: ReturnType<typeof createEventStore>
} = {}) {
  const httpServer = createServer()
  const sessionManager = options.sessionManager ?? createSessionManager()
  const eventStore = options.eventStore ?? createEventStore()
  
  getEventStoreMock.mockReturnValue(eventStore)

  const mockLLMClient = { 
    getModel: () => 'qwen3-32b', 
    getBackend: () => 'vllm',
    complete: vi.fn().mockResolvedValue({ content: 'Test Session', toolCalls: [] }),
  } as never
  const wss = createWebSocketServer(
    httpServer,
    { } as never,
    () => mockLLMClient,
    undefined,
    sessionManager as never,
    { tools: [], definitions: [], execute: vi.fn() } as never,
  )

  await new Promise<void>((resolve) => httpServer.listen(0, resolve))
  const address = httpServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind http server')
  }

  const client = new WebSocket(`ws://127.0.0.1:${address.port}/ws`)
  await once(client, 'open')

  const queue: TestMessage[] = []
  const listeners: Array<(message: TestMessage) => void> = []
  client.on('message', (raw) => {
    const message = JSON.parse(raw.toString()) as TestMessage
    queue.push(message)
    for (const listener of [...listeners]) {
      listener(message)
    }
  })

  const nextMessage = async (predicate: (message: TestMessage) => boolean = () => true): Promise<TestMessage> => {
    const existing = queue.find(predicate)
    if (existing) {
      queue.splice(queue.indexOf(existing), 1)
      return existing
    }

    return await new Promise<TestMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
        reject(new Error('Timed out waiting for message'))
      }, 2000)

      const listener = (message: TestMessage) => {
        if (!predicate(message)) {
          return
        }
        clearTimeout(timeout)
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
        queue.splice(queue.indexOf(message), 1)
        resolve(message)
      }

      listeners.push(listener)
    })
  }

  const send = (message: Record<string, unknown>) => {
    client.send(JSON.stringify(message))
  }

  const sendRaw = (raw: string) => {
    client.send(raw)
  }

  const close = async () => {
    client.close()
    await once(client, 'close')
    await new Promise<void>((resolve) => wss.close(() => resolve()))
    await new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()))
  }

  return { client, send, sendRaw, nextMessage, close, sessionManager, eventStore, httpServer }
}

describe('createWebSocketServer', () => {
  beforeEach(() => {
    createProjectMock.mockReset()
    getProjectMock.mockReset()
    listProjectsMock.mockReset()
    updateProjectMock.mockReset()
    deleteProjectMock.mockReset()
    getSettingMock.mockReset()
    setSettingMock.mockReset()

    getAllInstructionsMock.mockReset()
    getToolRegistryForModeMock.mockReset()
    providePathConfirmationMock.mockReset()
    runChatTurnMock.mockReset()
    runOrchestratorMock.mockReset()
    streamLLMPureMock.mockReset()
    consumeStreamGeneratorMock.mockReset()
    streamLLMResponseMock.mockReset()
    getEventStoreMock.mockReset()
    getContextMessagesMock.mockReset()
    getContextMessagesMock.mockReturnValue([])
    getCurrentContextWindowIdMock.mockReset()
    getCurrentContextWindowIdMock.mockReturnValue(undefined)
    getAllInstructionsMock.mockReset()
    getAllInstructionsMock.mockResolvedValue({ content: '', files: [] })
    getEnabledSkillMetadataMock.mockReset()
    getEnabledSkillMetadataMock.mockResolvedValue([])
    getRuntimeConfigMock.mockReset()
    getRuntimeConfigMock.mockReturnValue({
      mode: 'test',
      llm: {
        baseUrl: 'http://localhost:8000/v1',
        model: 'test-model',
        timeout: 60000,
        idleTimeout: 300000,
        backend: 'auto' as const,
      },
      context: {
        maxTokens: 200000,
        compactionThreshold: 0.8,
        compactionTarget: 0.5,
      },
      agent: {
        maxIterations: 10,
        maxConsecutiveFailures: 3,
        toolTimeout: 300000,
      },
    })
    getGlobalConfigDirMock.mockReset()
    getGlobalConfigDirMock.mockReturnValue('/tmp/config')
    generateSessionSummaryMock.mockReset()
    generateSessionSummaryMock.mockResolvedValue({ success: true, summary: 'Test summary' })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
  })

  it('returns protocol errors for invalid raw input and unknown message types', async () => {
    const harness = await createHarness()

    harness.sendRaw('{')
    expect(await harness.nextMessage((message) => message.type === 'error')).toMatchObject({
      type: 'error',
      payload: { code: 'INVALID_MESSAGE', message: 'Invalid message format' },
    })

    harness.send({ id: 'm1', type: 'unknown.type', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'm1')).toMatchObject({
      type: 'error',
      payload: { code: 'UNKNOWN_MESSAGE', message: 'Unknown message type: unknown.type' },
    })

    await harness.close()
  })

  it('handles project and settings management messages', async () => {
    const harness = await createHarness()

    harness.send({ id: 'pc-deprecated', type: 'project.create', payload: { name: 'OpenFox', workdir: '/tmp/project' } })
    expect(await harness.nextMessage((message) => message.id === 'pc-deprecated')).toMatchObject({ type: 'error', payload: { code: 'DEPRECATED_MESSAGE_TYPE' } })

    harness.send({ id: 'pl-deprecated', type: 'project.list', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'pl-deprecated')).toMatchObject({ type: 'error', payload: { code: 'DEPRECATED_MESSAGE_TYPE' } })

    harness.send({ id: 'pload-deprecated', type: 'project.load', payload: { projectId: 'project-1' } })
    expect(await harness.nextMessage((message) => message.id === 'pload-deprecated')).toMatchObject({ type: 'error', payload: { code: 'DEPRECATED_MESSAGE_TYPE' } })

    harness.send({ id: 'pupdate-deprecated', type: 'project.update', payload: { projectId: 'project-1', name: 'Updated' } })
    expect(await harness.nextMessage((message) => message.id === 'pupdate-deprecated')).toMatchObject({ type: 'error', payload: { code: 'DEPRECATED_MESSAGE_TYPE' } })

    harness.send({ id: 'pdelete-deprecated', type: 'project.delete', payload: { projectId: 'project-1' } })
    expect(await harness.nextMessage((message) => message.id === 'pdelete-deprecated')).toMatchObject({ type: 'error', payload: { code: 'DEPRECATED_MESSAGE_TYPE' } })

    harness.send({ id: 'sget-deprecated', type: 'settings.get', payload: { key: 'theme' } })
    expect(await harness.nextMessage((message) => message.id === 'sget-deprecated')).toMatchObject({ type: 'error', payload: { code: 'DEPRECATED_MESSAGE_TYPE' } })

    harness.send({ id: 'sset-deprecated', type: 'settings.set', payload: { key: 'theme', value: 'light' } })
    expect(await harness.nextMessage((message) => message.id === 'sset-deprecated')).toMatchObject({ type: 'error', payload: { code: 'DEPRECATED_MESSAGE_TYPE' } })

    await harness.close()
  })

  it('handles session create/load/list/delete and prefers event-store messages on load', async () => {
    const eventStore = createEventStore() as any
    eventStore.append('session-1', { type: 'message.start', data: { messageId: 'assistant-1', role: 'assistant' } })
    eventStore.append('session-1', { type: 'message.delta', data: { messageId: 'assistant-1', content: 'Hello' } })
    eventStore.append('session-1', { type: 'message.done', data: { messageId: 'assistant-1' } })

    const session = {
      id: 'session-1',
      projectId: 'project-1',
      workdir: '/tmp/project',
      mode: 'planner' as const,
      phase: 'plan' as const,
      isRunning: false,
      criteria: [],
      summary: null,
    }
    const sessionManager = createSessionManager({
      createSession: vi.fn(() => session),
      getSession: vi.fn((id: string) => id === 'session-1' ? session : null),
      requireSession: vi.fn(() => session),
    })

    const harness = await createHarness({ sessionManager, eventStore })

    harness.send({ id: 'sc-deprecated', type: 'session.create', payload: { projectId: 'project-1', title: 'Session A' } })
    expect(await harness.nextMessage((message) => message.id === 'sc-deprecated')).toMatchObject({ type: 'error', payload: { code: 'DEPRECATED_MESSAGE_TYPE' } })

    harness.send({ id: 'sl-ok', type: 'session.load', payload: { sessionId: 'session-1' } })
    expect(await harness.nextMessage((message) => message.id === 'sl-ok')).toMatchObject({
      type: 'session.state',
      payload: { messages: [{ id: 'assistant-1', role: 'assistant', content: 'Hello' }] },
    })
    expect(await harness.nextMessage((message) => message.type === 'context.state')).toMatchObject({ type: 'context.state' })

    // With pure event-sourcing, empty events = empty messages (no DB fallback)
    eventStore.getEvents.mockReturnValueOnce([])
    harness.send({ id: 'sl-db', type: 'session.load', payload: { sessionId: 'session-1' } })
    expect(await harness.nextMessage((message) => message.id === 'sl-db')).toMatchObject({
      type: 'session.state',
      payload: { messages: [] },
    })
    await harness.nextMessage((message) => message.type === 'context.state')

    harness.send({ id: 'slist-deprecated', type: 'session.list', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'slist-deprecated')).toMatchObject({ type: 'error', payload: { code: 'DEPRECATED_MESSAGE_TYPE' } })

    harness.send({ id: 'sdel-deprecated', type: 'session.delete', payload: { sessionId: 'session-1' } })
    expect(await harness.nextMessage((message) => message.id === 'sdel-deprecated')).toMatchObject({ type: 'error', payload: { code: 'DEPRECATED_MESSAGE_TYPE' } })

    await harness.close()
  })

  it('handles chat send/stop/continue plus mode and criteria editing flows', async () => {
    const sessionState: any = {
      id: 'session-1',
      projectId: 'project-1',
      workdir: '/tmp/project',
      mode: 'planner',
      phase: 'blocked',
      isRunning: false,
      criteria: [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'pending' }, attempts: [] }],
      summary: null,
      metadata: { title: null },
    }
    const sessionManager = createSessionManager({
      createSession: vi.fn(() => sessionState),
      getSession: vi.fn(() => sessionState),
      requireSession: vi.fn(() => structuredClone(sessionState)),
      setMode: vi.fn((_id, mode) => ({ ...sessionState, mode })),
    })
    
    let resolveRun: (() => void) | null = null
    runChatTurnMock.mockImplementation(({ sessionManager, sessionId, signal }) => {
      // The event store is already set up in the harness - we just need to wait
      return new Promise<void>((resolve) => {
        resolveRun = resolve
        signal?.addEventListener('abort', () => resolve())
      })
    })

    const harness = await createHarness({ sessionManager })
    
    // Override addMessage and setRunning to emit events after harness is created
    const eventStore = getEventStoreMock()
    sessionManager.addMessage = vi.fn((sessionId: string, message: any) => {
      if (eventStore && typeof eventStore.append === 'function') {
        eventStore.append(sessionId, {
          type: 'message.start',
          data: { messageId: `msg-${Date.now()}`, role: message.role, content: message.content }
        })
      }
      return { id: `msg-${Date.now()}`, timestamp: new Date().toISOString(), ...message }
    })
    
    sessionManager.setRunning = vi.fn((sessionId: string, isRunning: boolean) => {
      if (eventStore && typeof eventStore.append === 'function') {
        eventStore.append(sessionId, {
          type: 'running.changed',
          data: { isRunning }
        })
      }
      return { ...sessionState, isRunning }
    })

    harness.send({ id: 'sl-ok', type: 'session.load', payload: { sessionId: 'session-1' } })
    await harness.nextMessage((message) => message.id === 'sl-ok')
    await harness.nextMessage((message) => message.type === 'context.state')
    
    harness.send({ id: 'chat-bad', type: 'chat.send', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'chat-bad')).toMatchObject({ payload: { code: 'UNKNOWN_MESSAGE' } })

    harness.send({ id: 'chat-ok', type: 'chat.send', payload: { content: 'Please continue' } })
    expect(await harness.nextMessage((message) => message.id === 'chat-ok')).toMatchObject({ payload: { code: 'UNKNOWN_MESSAGE' } })

    harness.send({ id: 'chat-stop', type: 'chat.stop', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'chat-stop')).toMatchObject({ payload: { code: 'UNKNOWN_MESSAGE' } })

    const releaseRun = resolveRun as (() => void) | null
    if (releaseRun) {
      releaseRun()
    }

    harness.send({ id: 'chat-continue', type: 'chat.continue', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'chat-continue')).toMatchObject({ payload: { code: 'UNKNOWN_MESSAGE' } })

    harness.send({ id: 'mode-ok', type: 'mode.switch', payload: { mode: 'builder' } })
    expect(await harness.nextMessage((message) => message.id === 'mode-ok')).toMatchObject({ payload: { code: 'UNKNOWN_MESSAGE' } })

    harness.send({ id: 'criteria-ok', type: 'criteria.edit', payload: { criteria: [{ id: 'c1', description: 'd', status: { type: 'pending' }, attempts: [] }] } })
    expect(await harness.nextMessage((message) => message.id === 'criteria-ok')).toMatchObject({ payload: { code: 'UNKNOWN_MESSAGE' } })

    await harness.close()
  })

  it('auto-compacts before accepting a new chat message when context is over threshold', async () => {
    const sessionState: any = {
      id: 'session-1',
      projectId: 'project-1',
      workdir: '/tmp/project',
      mode: 'planner',
      phase: 'plan',
      isRunning: false,
      criteria: [],
      summary: null,
      metadata: { title: null },
    }
    const sessionManager = createSessionManager({
      createSession: vi.fn(() => sessionState),
      getSession: vi.fn(() => sessionState),
      requireSession: vi.fn(() => structuredClone(sessionState)),
      getContextState: vi.fn(() => ({
        currentTokens: 190000,
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: true,
        canCompact: true,
      })),
    })

    getAllInstructionsMock.mockResolvedValue({ content: '', files: [] })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock.mockResolvedValue({
      content: 'Compacted summary of the session including all file modifications and current progress on tasks',
      toolCalls: [],
      segments: [{ type: 'text', content: 'Compacted summary of the session including all file modifications and current progress on tasks' }],
      usage: { promptTokens: 190000, completionTokens: 100 },
      timing: { ttft: 1, completionTime: 1, tps: 100, prefillTps: 190000 },
      aborted: false,
      xmlFormatError: false,
    })
    runChatTurnMock.mockResolvedValue(undefined)

    const harness = await createHarness({ sessionManager })

    harness.send({ id: 'sl-ok', type: 'session.load', payload: { sessionId: 'session-1' } })
    await harness.nextMessage((message) => message.id === 'sl-ok')
    await harness.nextMessage((message) => message.type === 'context.state')

    harness.send({ id: 'chat-ok', type: 'chat.send', payload: { content: 'Please continue' } })
    expect(await harness.nextMessage((message) => message.id === 'chat-ok')).toMatchObject({ payload: { code: 'UNKNOWN_MESSAGE' } })

    await harness.close()
  })

  it('handles mode.accept, runner.launch, context.compact, and path confirmation', async () => {
    const sessionState: any = {
      id: 'session-1',
      projectId: 'project-1',
      workdir: '/tmp/project',
      mode: 'builder',
      phase: 'blocked',
      isRunning: false,
      criteria: [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'pending' }, attempts: [] }],
      summary: 'Pre-generated summary', // Summary already exists from mode.switch
    }
    const sessionManager = createSessionManager({
      createSession: vi.fn(() => sessionState),
      getSession: vi.fn(() => sessionState),
      requireSession: vi.fn(() => sessionState),
      setMode: vi.fn((_id, mode) => ({ ...sessionState, mode })),
      setPhase: vi.fn((_id, phase) => ({ ...sessionState, phase })),
      setRunning: vi.fn((_id, isRunning) => { sessionState.isRunning = isRunning }),
    })

    getAllInstructionsMock.mockResolvedValue({ content: 'Follow instructions', files: [] })
    getToolRegistryForModeMock.mockReturnValue({ definitions: [{ type: 'function', function: { name: 'read_file', description: 'Read', parameters: {} } }] })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock
      .mockResolvedValueOnce({
        content: 'Compacted summary of the session including all file modifications and current progress on tasks',
        toolCalls: [],
        segments: [],
        usage: { promptTokens: 10, completionTokens: 4 },
        timing: { ttft: 1, completionTime: 1, tps: 4, prefillTps: 10 },
        aborted: false,
        xmlFormatError: false,
      })
      .mockResolvedValueOnce({
        content: 'Orchestrator summary',
        toolCalls: [],
        segments: [],
        usage: { promptTokens: 15, completionTokens: 3 },
        timing: { ttft: 1, completionTime: 1, tps: 3, prefillTps: 15 },
        aborted: false,
        xmlFormatError: false,
      })
    runOrchestratorMock.mockResolvedValue({ success: true })
    providePathConfirmationMock
      .mockReturnValueOnce({ found: false })
      .mockReturnValueOnce({ found: true })

    const harness = await createHarness({ sessionManager })

    harness.send({ id: 'sl-ok', type: 'session.load', payload: { sessionId: 'session-1' } })
    await harness.nextMessage((message) => message.id === 'sl-ok')

    harness.send({ id: 'runner-launch', type: 'runner.launch', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'runner-launch')).toMatchObject({ type: 'ack' })
    expect(await harness.nextMessage((message) => message.type === 'session.running')).toMatchObject({ payload: { isRunning: true } })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(runOrchestratorMock).toHaveBeenCalled()
    
    // Session is now running, so runner.launch should queue
    sessionState.isRunning = true

    harness.send({ id: 'runner-launch-2', type: 'runner.launch', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'runner-launch-2')).toMatchObject({ type: 'queue.state', payload: { success: true } })

    // Stop the session so compact can run
    sessionState.isRunning = false

    harness.send({ id: 'compact', type: 'context.compact', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'compact')).toMatchObject({ type: 'ack' })
    expect(await harness.nextMessage((message) => message.type === 'context.state')).toMatchObject({ type: 'context.state' })
    expect(await harness.nextMessage((message) => message.type === 'session.state')).toMatchObject({ type: 'session.state' })
    expect(sessionManager.compactContext).toHaveBeenCalledWith('session-1', 'Compacted summary of the session including all file modifications and current progress on tasks', 10)
    expect(streamLLMPureMock.mock.calls[1]?.[0]?.messages).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ content: expect.stringContaining('Plan mode ACTIVE') }),
      expect.objectContaining({ content: expect.stringContaining('Build mode ACTIVE') }),
    ]))

    harness.send({ id: 'path-missing', type: 'path.confirm', payload: { callId: 'call-1', approved: true } })
    expect(await harness.nextMessage((message) => message.id === 'path-missing')).toMatchObject({ payload: { code: 'DEPRECATED' } })

    harness.send({ id: 'path-ok', type: 'path.confirm', payload: { callId: 'call-2', approved: false } })
    expect(await harness.nextMessage((message) => message.id === 'path-ok')).toMatchObject({ payload: { code: 'DEPRECATED' } })

    await harness.close()
  })

  it('reports session-state and validation errors for control messages', async () => {
    const sessionState: any = {
      id: 'session-1',
      projectId: 'project-1',
      workdir: '/tmp/project',
      mode: 'planner',
      phase: 'plan',
      isRunning: false,
      criteria: [],
      summary: null,
    }
    const sessionManager = createSessionManager({
      createSession: vi.fn(() => sessionState),
      getSession: vi.fn(() => sessionState),
      requireSession: vi.fn(() => structuredClone(sessionState)),
    })
    const harness = await createHarness({ sessionManager })

    harness.send({ id: 'runner-accept-none', type: 'runner.launch', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'runner-accept-none')).toMatchObject({ payload: { code: 'NO_SESSION' } })

    harness.send({ id: 'compact-none', type: 'context.compact', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'compact-none')).toMatchObject({ payload: { code: 'NO_SESSION' } })

    harness.send({ id: 'runner-none', type: 'runner.launch', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'runner-none')).toMatchObject({ payload: { code: 'NO_SESSION' } })

    harness.send({ id: 'path-none', type: 'path.confirm', payload: { callId: 'x', approved: true } })
    expect(await harness.nextMessage((message) => message.id === 'path-none')).toMatchObject({ payload: { code: 'DEPRECATED' } })

    harness.send({ id: 'sl-ok', type: 'session.load', payload: { sessionId: 'session-1' } })
    await harness.nextMessage((message) => message.id === 'sl-ok')

    sessionState.isRunning = true
    sessionState.criteria = [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'pending' }, attempts: [] }]
    harness.send({ id: 'runner-running', type: 'runner.launch', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'runner-running')).toMatchObject({ type: 'queue.state', payload: { success: true } })
    harness.send({ id: 'compact-running', type: 'context.compact', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'compact-running')).toMatchObject({ payload: { code: 'SESSION_RUNNING' } })

    sessionState.isRunning = false

    sessionState.mode = 'planner'
    harness.send({ id: 'runner-invalid-mode', type: 'runner.launch', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'runner-invalid-mode')).toMatchObject({ payload: { code: 'INVALID_MODE' } })

    sessionState.mode = 'builder'
    sessionState.criteria = [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'passed', verifiedAt: '2024-01-01T00:00:00.000Z' }, attempts: [] }]
    harness.send({ id: 'runner-no-work', type: 'runner.launch', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'runner-no-work')).toMatchObject({ payload: { code: 'NO_WORK' } })

    harness.send({ id: 'path-invalid', type: 'path.confirm', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'path-invalid')).toMatchObject({ payload: { code: 'DEPRECATED' } })

    await harness.close()
  })

  it('surfaces manual compaction failures as recoverable chat errors', async () => {
    const sessionState: any = {
      id: 'session-1',
      projectId: 'project-1',
      workdir: '/tmp/project',
      mode: 'builder',
      phase: 'build',
      isRunning: false,
      criteria: [],
      summary: null,
    }
    const sessionManager = createSessionManager({
      createSession: vi.fn(() => sessionState),
      getSession: vi.fn(() => sessionState),
      requireSession: vi.fn(() => structuredClone(sessionState)),
    })
    getAllInstructionsMock.mockRejectedValueOnce(new Error('compact blew up'))
    const harness = await createHarness({ sessionManager })

    harness.send({ id: 'sl-ok', type: 'session.load', payload: { sessionId: 'session-1' } })
    await harness.nextMessage((message) => message.id === 'sl-ok')

    harness.send({ id: 'compact-fail', type: 'context.compact', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'compact-fail')).toMatchObject({ type: 'ack' })
    expect(await harness.nextMessage((message) => message.type === 'chat.error')).toMatchObject({
      payload: { error: 'Compaction failed: compact blew up', recoverable: true },
    })

    await harness.close()
  })

  it('emits error events when runner.launch fails during orchestrator', async () => {
    const sessionState: any = {
      id: 'session-1',
      projectId: 'project-1',
      workdir: '/tmp/project',
      mode: 'builder',
      phase: 'build',
      isRunning: false,
      criteria: [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'pending' }, attempts: [] }],
      summary: 'Pre-generated summary', // Summary already exists from mode.switch
    }
    const sessionManager = createSessionManager({
      createSession: vi.fn(() => sessionState),
      getSession: vi.fn(() => sessionState),
      requireSession: vi.fn(() => structuredClone(sessionState)),
    })
    runOrchestratorMock.mockRejectedValueOnce(new Error('orchestrator failed'))

    const harness = await createHarness({ sessionManager })
    harness.send({ id: 'sl-ok', type: 'session.load', payload: { sessionId: 'session-1' } })
    await harness.nextMessage((message) => message.id === 'sl-ok')

    harness.send({ id: 'runner-fail', type: 'runner.launch', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'runner-fail')).toMatchObject({ type: 'ack' })
    expect(await harness.nextMessage((message) => message.type === 'session.running')).toMatchObject({ payload: { isRunning: true } })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    await harness.close()
  })

  it('generates summary when switching to builder mode for first time', async () => {
    const sessionState: any = {
      id: 'session-1',
      projectId: 'project-1',
      workdir: '/tmp/project',
      mode: 'planner',
      phase: 'plan',
      isRunning: false,
      criteria: [{ id: 'deleted-session-fix', description: 'Fix deleted session navigation', status: { type: 'pending' }, attempts: [] }],
      summary: null,
    }
    const sessionManager = createSessionManager({
      createSession: vi.fn(() => sessionState),
      getSession: vi.fn(() => sessionState),
      requireSession: vi.fn(() => structuredClone(sessionState)),
      setSummary: vi.fn(),
    })

    const harness = await createHarness({ sessionManager })

    harness.send({ id: 'sl-ok', type: 'session.load', payload: { sessionId: 'session-1' } })
    await harness.nextMessage((message) => message.id === 'sl-ok')

    harness.send({ id: 'mode-switch-builder', type: 'mode.switch', payload: { mode: 'builder' } })
    expect(await harness.nextMessage((message) => message.id === 'mode-switch-builder')).toMatchObject({ payload: { code: 'UNKNOWN_MESSAGE' } })
  })

  it('handles runner relaunch, subscription failures, and orchestrator errors', async () => {
    const eventStore = createEventStore()
    eventStore.subscribe = vi.fn(() => ({
      iterator: (async function* () {
        throw new Error('subscription blew up')
      })(),
      unsubscribe: vi.fn(),
    }))

    const sessionState: any = {
      id: 'session-1',
      projectId: 'project-1',
      workdir: '/tmp/project',
      mode: 'builder',
      phase: 'build',
      isRunning: false,
      criteria: [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'pending' }, attempts: [] }],
      summary: null,
    }
    const sessionManager = createSessionManager({
      createSession: vi.fn(() => sessionState),
      getSession: vi.fn(() => sessionState),
      requireSession: vi.fn(() => structuredClone(sessionState)),
    })

    runOrchestratorMock
      .mockImplementationOnce(({ signal }) => new Promise((resolve) => {
        signal?.addEventListener('abort', () => resolve({ success: true }))
      }))
      .mockRejectedValueOnce(new Error('runner exploded'))

    const harness = await createHarness({ sessionManager, eventStore })

    harness.send({ id: 'runner-1', type: 'runner.launch', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'runner-1')).toMatchObject({ type: 'error', payload: { code: 'NO_SESSION' } })

    await harness.close()
  })

  it('forwards streamed event-store messages and ignores aborted runner errors', async () => {
    const eventStore: any = createEventStore()
    const chatDoneEvent = {
      seq: 1,
      sessionId: 'session-1',
      timestamp: Date.now(),
      type: 'chat.done',
      data: { messageId: 'assistant-1', reason: 'complete' },
    }
    // Use a deferred yield to ensure session.running comes first
    let resolveChatDone: ((event: typeof chatDoneEvent) => void) | null = null
    eventStore.subscribe = vi.fn(() => ({
      iterator: (async function* () {
        resolveChatDone = (event: typeof chatDoneEvent) => {
          resolveChatDone = null
        }
      })(),
      unsubscribe: vi.fn(),
    }))
    eventStore.subscribeAll = vi.fn(() => ({
      iterator: (async function* () {
        // Wait for signal to yield chat.done
        yield await new Promise<typeof chatDoneEvent>((resolve) => {
          resolveChatDone = resolve
        })
      })() as any,
      unsubscribe: vi.fn(),
    }))

    const sessionState: any = {
      id: 'session-1',
      projectId: 'project-1',
      workdir: '/tmp/project',
      mode: 'builder',
      phase: 'build',
      isRunning: false,
      criteria: [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'pending' }, attempts: [] }],
      summary: null,
    }
    const sessionManager = createSessionManager({
      createSession: vi.fn(() => sessionState),
      getSession: vi.fn(() => sessionState),
      requireSession: vi.fn(() => structuredClone(sessionState)),
    })
    runOrchestratorMock.mockImplementation(() => {
      resolveChatDone?.(chatDoneEvent)
      return Promise.reject(new Error('Aborted'))
    })

    const harness = await createHarness({ sessionManager, eventStore })
    harness.send({ id: 'sl-ok', type: 'session.load', payload: { sessionId: 'session-1' } })
    await harness.nextMessage((message) => message.id === 'sl-ok')

    harness.send({ id: 'runner-aborted', type: 'runner.launch', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'runner-aborted')).toMatchObject({ type: 'ack' })
    expect(await harness.nextMessage((message) => message.type === 'session.running')).toMatchObject({ payload: { isRunning: true } })
    expect(await harness.nextMessage((message) => message.type === 'chat.done' && message.seq === 1)).toMatchObject({
      type: 'chat.done',
      seq: 1,
      sessionId: 'session-1',
      payload: { messageId: 'assistant-1', reason: 'complete' },
    })

    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(runOrchestratorMock).toHaveBeenCalledTimes(1)
    expect(sessionManager.setRunning).toHaveBeenCalledWith('session-1', false)

    await harness.close()
  })

  it.skip('tags direct session-scoped messages with their originating session after switching sessions', async () => {
    const sessionOne: any = {
      id: 'session-1',
      projectId: 'project-1',
      workdir: '/tmp/project-1',
      mode: 'planner',
      phase: 'plan',
      isRunning: false,
      criteria: [],
      summary: null,
      metadata: { totalTokensUsed: 0, totalToolCalls: 0, iterationCount: 0 },
    }
    const sessionTwo: any = {
      id: 'session-2',
      projectId: 'project-1',
      workdir: '/tmp/project-2',
      mode: 'planner',
      phase: 'plan',
      isRunning: false,
      criteria: [],
      summary: null,
      metadata: { totalTokensUsed: 0, totalToolCalls: 0, iterationCount: 0 },
    }
    const sessions = new Map<string, any>([
      ['session-1', sessionOne],
      ['session-2', sessionTwo],
    ])

    const eventStore = createEventStore()
    eventStore.getEvents = vi.fn((sessionId: string) => {
      if (sessionId === 'session-2') {
        return [
          { seq: 1, sessionId: 'session-2', timestamp: 123, type: 'message.start', data: { messageId: 'msg-2', role: 'user', content: 'Hello from session-2' } },
        ]
      }
      return []
    })

    const sessionManager = createSessionManager({
      createSession: vi.fn(() => sessionOne),
      getSession: vi.fn((sessionId: string) => sessions.get(sessionId) ?? null),
      requireSession: vi.fn((sessionId: string) => sessions.get(sessionId)),
      getContextState: vi.fn((sessionId: string) => ({
        currentTokens: sessionId === 'session-1' ? 11 : 22,
        maxTokens: 200000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
      })),
    })

    const harness = await createHarness({ sessionManager, eventStore })

    harness.send({ id: 'load-session-1', type: 'session.load', payload: { sessionId: 'session-1' } })
    await harness.nextMessage((message) => message.id === 'load-session-1')
    await harness.nextMessage((message) => message.type === 'context.state' && message.sessionId === 'session-1')

    harness.send({ id: 'load-session-2', type: 'session.load', payload: { sessionId: 'session-2' } })
    expect(await harness.nextMessage((message) => message.id === 'load-session-2')).toMatchObject({
      type: 'session.state',
      sessionId: 'session-2',
      payload: { session: { id: 'session-2' } },
    })
    expect(await harness.nextMessage((message) => message.type === 'context.state' && message.sessionId === 'session-2')).toMatchObject({
      type: 'context.state',
      sessionId: 'session-2',
      payload: { context: { currentTokens: 22 } },
    })

    harness.eventStore.append('session-1', {
      type: 'chat.path_confirmation',
      data: {
        callId: 'path-1',
        tool: 'read_file',
        paths: ['/tmp/project-1/secrets.txt'],
        workdir: '/tmp/project-1',
        reason: 'outside_workdir',
      },
    })

    expect(await harness.nextMessage((message) => message.type === 'chat.path_confirmation')).toMatchObject({
      type: 'chat.path_confirmation',
      sessionId: 'session-1',
      payload: { callId: 'path-1' },
    })

    await harness.close()
  })
})
