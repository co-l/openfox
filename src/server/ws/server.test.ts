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
  getCurrentContextWindowIdMock,
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
  getCurrentContextWindowIdMock: vi.fn(),
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

vi.mock('../tools/index.js', () => ({
  getToolRegistryForMode: getToolRegistryForModeMock,
  providePathConfirmation: providePathConfirmationMock,
  addAllowedPaths: vi.fn(),
}))

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
    getCurrentContextWindowId: getCurrentContextWindowIdMock,
  }
})

import { createWebSocketServer } from './server.js'

type TestMessage = { id?: string; type: string; payload: Record<string, unknown>; seq?: number; sessionId?: string }

function createEventStore() {
  const eventsBySession = new Map<string, Array<{ seq: number; sessionId: string; timestamp: number; type: string; data: unknown }>>()
  const subscribers = new Map<string, { resolve: (event: { seq: number; sessionId: string; timestamp: number; type: string; data: unknown }) => void; event: { seq: number; sessionId: string; timestamp: number; type: string; data: unknown } }>()

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
    { tools: [], definitions: [], execute: vi.fn() } as never,
    sessionManager as never,
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
    getCurrentContextWindowIdMock.mockReset()
    getCurrentContextWindowIdMock.mockReturnValue(undefined)
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
    const project = { id: 'project-1', name: 'OpenFox', workdir: '/tmp/project', createdAt: 'a', updatedAt: 'b' }

    createProjectMock.mockReturnValue(project)
    listProjectsMock.mockReturnValue([project])
    getProjectMock.mockImplementation((id: string) => id === 'project-1' ? project : null)
    updateProjectMock.mockImplementation((id: string) => id === 'project-1' ? { ...project, name: 'Updated' } : null)
    getSettingMock.mockReturnValue('dark')

    harness.send({ id: 'pc-bad', type: 'project.create', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'pc-bad')).toMatchObject({ payload: { code: 'INVALID_PAYLOAD' } })

    harness.send({ id: 'pc-ok', type: 'project.create', payload: { name: 'OpenFox', workdir: '/tmp/project' } })
    expect(await harness.nextMessage((message) => message.id === 'pc-ok')).toMatchObject({ type: 'project.state', payload: { project } })

    harness.send({ id: 'pl', type: 'project.list', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'pl')).toMatchObject({ type: 'project.list', payload: { projects: [project] } })

    harness.send({ id: 'pload-missing', type: 'project.load', payload: { projectId: 'missing' } })
    expect(await harness.nextMessage((message) => message.id === 'pload-missing')).toMatchObject({ payload: { code: 'NOT_FOUND' } })

    harness.send({ id: 'pload-ok', type: 'project.load', payload: { projectId: 'project-1' } })
    expect(await harness.nextMessage((message) => message.id === 'pload-ok')).toMatchObject({ type: 'project.state', payload: { project } })

    harness.send({ id: 'pupdate-ok', type: 'project.update', payload: { projectId: 'project-1', name: 'Updated' } })
    expect(await harness.nextMessage((message) => message.id === 'pupdate-ok')).toMatchObject({ type: 'project.state', payload: { project: { name: 'Updated' } } })

    harness.send({ id: 'pdelete-ok', type: 'project.delete', payload: { projectId: 'project-1' } })
    expect(await harness.nextMessage((message) => message.id === 'pdelete-ok')).toMatchObject({ type: 'project.deleted', payload: { projectId: 'project-1' } })

    harness.send({ id: 'sget-bad', type: 'settings.get', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'sget-bad')).toMatchObject({ payload: { code: 'INVALID_PAYLOAD' } })

    harness.send({ id: 'sget-ok', type: 'settings.get', payload: { key: 'theme' } })
    expect(await harness.nextMessage((message) => message.id === 'sget-ok')).toMatchObject({ type: 'settings.value', payload: { key: 'theme', value: 'dark' } })

    harness.send({ id: 'sset-ok', type: 'settings.set', payload: { key: 'theme', value: 'light' } })
    expect(await harness.nextMessage((message) => message.id === 'sset-ok')).toMatchObject({ type: 'settings.value', payload: { key: 'theme', value: 'light' } })
    expect(setSettingMock).toHaveBeenCalledWith('theme', 'light')

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

    harness.send({ id: 'sc-bad', type: 'session.create', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'sc-bad')).toMatchObject({ payload: { code: 'INVALID_PAYLOAD' } })

    harness.send({ id: 'sc-ok', type: 'session.create', payload: { projectId: 'project-1', title: 'Session A' } })
    expect(await harness.nextMessage((message) => message.id === 'sc-ok')).toMatchObject({ type: 'session.state', payload: { session, messages: [] } })

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

    harness.send({ id: 'slist', type: 'session.list', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'slist')).toMatchObject({ type: 'session.list' })

    harness.send({ id: 'sdel-ok', type: 'session.delete', payload: { sessionId: 'session-1' } })
    expect(await harness.nextMessage((message) => message.id === 'sdel-ok')).toMatchObject({ type: 'session.deleted', payload: { sessionId: 'session-1' } })

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

    harness.send({ id: 'sc-ok', type: 'session.create', payload: { projectId: 'project-1' } })
    await harness.nextMessage((message) => message.id === 'sc-ok')
    await harness.nextMessage((message) => message.type === 'context.state')
    
    // Load the session to set up the event store subscription
    harness.send({ id: 'sl-ok', type: 'session.load', payload: { sessionId: 'session-1' } })
    await harness.nextMessage((message) => message.id === 'sl-ok')
    await harness.nextMessage((message) => message.type === 'context.state')

    harness.send({ id: 'chat-bad', type: 'chat.send', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'chat-bad')).toMatchObject({ payload: { code: 'INVALID_PAYLOAD' } })

    harness.send({ id: 'chat-ok', type: 'chat.send', payload: { content: 'Please continue' } })
    
    // Messages arrive in order: phase.changed, chat.message, session.running, ack
    expect(await harness.nextMessage((message) => message.type === 'phase.changed')).toMatchObject({ payload: { phase: 'build' } })
    expect(await harness.nextMessage((message) => message.type === 'chat.message')).toMatchObject({ type: 'chat.message' })
    expect(await harness.nextMessage((message) => message.type === 'session.running')).toMatchObject({ payload: { isRunning: true } })
    expect(await harness.nextMessage((message) => message.id === 'chat-ok')).toMatchObject({ type: 'ack' })
    expect(sessionManager.resetAllCriteriaAttempts).toHaveBeenCalledWith('session-1')

    harness.send({ id: 'chat-stop', type: 'chat.stop', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'chat-stop')).toMatchObject({ type: 'ack' })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(sessionManager.setRunning).toHaveBeenLastCalledWith('session-1', false)

    const releaseRun = resolveRun as (() => void) | null
    if (releaseRun) {
      releaseRun()
    }

    // Simulate events that would have been stored during the chat run
    // (runChatTurn is mocked so no real events are appended)
    const mockEventStore = getEventStoreMock()
    mockEventStore.getEvents.mockReturnValueOnce([
      { seq: 1, sessionId: 'session-1', timestamp: 123, type: 'message.start', data: { messageId: 'assistant-1', role: 'assistant', contextWindowId: 'w1' } },
      { seq: 2, sessionId: 'session-1', timestamp: 124, type: 'message.delta', data: { messageId: 'assistant-1', content: 'Done' } },
      { seq: 3, sessionId: 'session-1', timestamp: 125, type: 'message.done', data: { messageId: 'assistant-1', stats: { model: 'qwen', mode: 'planner', totalTime: 1, toolTime: 0, prefillTokens: 1, prefillSpeed: 1, generationTokens: 1, generationSpeed: 1 } } },
    ])

    harness.send({ id: 'chat-continue', type: 'chat.continue', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'chat-continue')).toMatchObject({ type: 'ack' })
    expect(await harness.nextMessage((message) => message.type === 'chat.done')).toMatchObject({ payload: { messageId: 'assistant-1', reason: 'complete' } })

    harness.send({ id: 'mode-ok', type: 'mode.switch', payload: { mode: 'builder' } })
    expect(await harness.nextMessage((message) => message.type === 'mode.changed')).toMatchObject({ payload: { mode: 'builder', auto: false } })
    expect(await harness.nextMessage((message) => message.id === 'mode-ok')).toMatchObject({ type: 'session.state' })

    harness.send({ id: 'criteria-ok', type: 'criteria.edit', payload: { criteria: [{ id: 'c1', description: 'd', status: { type: 'pending' }, attempts: [] }] } })
    expect(await harness.nextMessage((message) => message.type === 'criteria.updated')).toMatchObject({ type: 'criteria.updated' })
    expect(await harness.nextMessage((message) => message.id === 'criteria-ok')).toMatchObject({ type: 'ack' })

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
      summary: null,
    }
    const sessionManager = createSessionManager({
      createSession: vi.fn(() => sessionState),
      getSession: vi.fn(() => sessionState),
      requireSession: vi.fn(() => structuredClone(sessionState)),
      setMode: vi.fn((_id, mode) => ({ ...sessionState, mode })),
      setPhase: vi.fn((_id, phase) => ({ ...sessionState, phase })),
    })

    getAllInstructionsMock.mockResolvedValue({ content: 'Follow instructions', files: [] })
    getToolRegistryForModeMock.mockReturnValue({ definitions: [{ type: 'function', function: { name: 'read_file', description: 'Read', parameters: {} } }] })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock
      .mockResolvedValueOnce({
        content: 'Summary content',
        toolCalls: [],
        segments: [],
        usage: { promptTokens: 20, completionTokens: 5 },
        timing: { ttft: 1, completionTime: 1, tps: 5, prefillTps: 20 },
        aborted: false,
        xmlFormatError: false,
      })
      .mockResolvedValueOnce({
        content: 'Compacted summary',
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

    harness.send({ id: 'sc-ok', type: 'session.create', payload: { projectId: 'project-1' } })
    await harness.nextMessage((message) => message.id === 'sc-ok')

    harness.send({ id: 'mode-accept', type: 'mode.accept', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'mode-accept')).toMatchObject({ type: 'ack' })
    expect(await harness.nextMessage((message) => message.type === 'session.running')).toMatchObject({ payload: { isRunning: true } })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(sessionManager.setSummary).toHaveBeenCalledWith('session-1', 'Summary content')
    expect(runOrchestratorMock).toHaveBeenCalled()
    expect(streamLLMPureMock.mock.calls[0]?.[0]?.messages).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ content: expect.stringContaining('Plan mode ACTIVE') }),
      expect.objectContaining({ content: expect.stringContaining('Build mode ACTIVE') }),
    ]))

    harness.send({ id: 'runner-launch', type: 'runner.launch', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'runner-launch')).toMatchObject({ type: 'ack' })

    harness.send({ id: 'compact', type: 'context.compact', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'compact')).toMatchObject({ type: 'ack' })
    expect(await harness.nextMessage((message) => message.type === 'chat.message')).toMatchObject({ type: 'chat.message' })
    expect(await harness.nextMessage((message) => message.type === 'chat.done')).toMatchObject({ payload: { reason: 'complete' } })
    expect(await harness.nextMessage((message) => message.type === 'context.state')).toMatchObject({ type: 'context.state' })
    expect(await harness.nextMessage((message) => message.type === 'session.state')).toMatchObject({ type: 'session.state' })
    expect(sessionManager.compactContext).toHaveBeenCalledWith('session-1', 'Compacted summary', 10)
    expect(streamLLMPureMock.mock.calls[1]?.[0]?.messages).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ content: expect.stringContaining('Plan mode ACTIVE') }),
      expect.objectContaining({ content: expect.stringContaining('Build mode ACTIVE') }),
    ]))

    harness.send({ id: 'path-missing', type: 'path.confirm', payload: { callId: 'call-1', approved: true } })
    expect(await harness.nextMessage((message) => message.id === 'path-missing')).toMatchObject({ payload: { code: 'NOT_FOUND' } })

    harness.send({ id: 'path-ok', type: 'path.confirm', payload: { callId: 'call-2', approved: false } })
    expect(await harness.nextMessage((message) => message.id === 'path-ok')).toMatchObject({ type: 'ack' })

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

    harness.send({ id: 'mode-accept-none', type: 'mode.accept', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'mode-accept-none')).toMatchObject({ payload: { code: 'NO_SESSION' } })

    harness.send({ id: 'compact-none', type: 'context.compact', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'compact-none')).toMatchObject({ payload: { code: 'NO_SESSION' } })

    harness.send({ id: 'runner-none', type: 'runner.launch', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'runner-none')).toMatchObject({ payload: { code: 'NO_SESSION' } })

    harness.send({ id: 'path-none', type: 'path.confirm', payload: { callId: 'x', approved: true } })
    expect(await harness.nextMessage((message) => message.id === 'path-none')).toMatchObject({ payload: { code: 'NO_SESSION' } })

    harness.send({ id: 'sc-ok', type: 'session.create', payload: { projectId: 'project-1' } })
    await harness.nextMessage((message) => message.id === 'sc-ok')

    harness.send({ id: 'mode-accept-empty', type: 'mode.accept', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'mode-accept-empty')).toMatchObject({ payload: { code: 'NO_CRITERIA' } })

    sessionState.isRunning = true
    sessionState.criteria = [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'pending' }, attempts: [] }]
    harness.send({ id: 'mode-accept-running', type: 'mode.accept', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'mode-accept-running')).toMatchObject({ payload: { code: 'ALREADY_RUNNING' } })
    harness.send({ id: 'compact-running', type: 'context.compact', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'compact-running')).toMatchObject({ payload: { code: 'SESSION_RUNNING' } })
    harness.send({ id: 'runner-running', type: 'runner.launch', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'runner-running')).toMatchObject({ payload: { code: 'ALREADY_RUNNING' } })

    sessionState.isRunning = false

    sessionState.mode = 'planner'
    harness.send({ id: 'runner-invalid-mode', type: 'runner.launch', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'runner-invalid-mode')).toMatchObject({ payload: { code: 'INVALID_MODE' } })

    sessionState.mode = 'builder'
    sessionState.criteria = [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'passed', verifiedAt: '2024-01-01T00:00:00.000Z' }, attempts: [] }]
    harness.send({ id: 'runner-no-work', type: 'runner.launch', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'runner-no-work')).toMatchObject({ payload: { code: 'NO_WORK' } })

    harness.send({ id: 'path-invalid', type: 'path.confirm', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'path-invalid')).toMatchObject({ payload: { code: 'INVALID_PAYLOAD' } })

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

    harness.send({ id: 'sc-ok', type: 'session.create', payload: { projectId: 'project-1' } })
    await harness.nextMessage((message) => message.id === 'sc-ok')

    harness.send({ id: 'compact-fail', type: 'context.compact', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'compact-fail')).toMatchObject({ type: 'ack' })
    expect(await harness.nextMessage((message) => message.type === 'chat.error')).toMatchObject({
      payload: { error: 'Compaction failed: compact blew up', recoverable: true },
    })

    await harness.close()
  })

  it('emits error events when mode.accept summary generation fails', async () => {
    const sessionState: any = {
      id: 'session-1',
      projectId: 'project-1',
      workdir: '/tmp/project',
      mode: 'planner',
      phase: 'plan',
      isRunning: false,
      criteria: [{ id: 'tests-pass', description: 'Tests pass', status: { type: 'pending' }, attempts: [] }],
      summary: null,
    }
    const sessionManager = createSessionManager({
      createSession: vi.fn(() => sessionState),
      getSession: vi.fn(() => sessionState),
      requireSession: vi.fn(() => structuredClone(sessionState)),
    })
    getAllInstructionsMock.mockRejectedValueOnce(new Error('summary failed'))

    const harness = await createHarness({ sessionManager })
    harness.send({ id: 'sc-ok', type: 'session.create', payload: { projectId: 'project-1' } })
    await harness.nextMessage((message) => message.id === 'sc-ok')

    harness.send({ id: 'mode-accept-fail', type: 'mode.accept', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'mode-accept-fail')).toMatchObject({ type: 'ack' })
    expect(await harness.nextMessage((message) => message.type === 'session.running')).toMatchObject({ payload: { isRunning: true } })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    const appendedTypes = harness.eventStore.append.mock.calls.map(([, event]) => event.type)
    expect(appendedTypes).toContain('chat.error')
    expect(appendedTypes).toContain('message.start')
    expect(appendedTypes).toContain('message.done')
    expect(appendedTypes).toContain('chat.done')
    expect(appendedTypes).toContain('running.changed')
    expect(harness.eventStore.append.mock.calls.find(([, event]) => event.type === 'chat.error')?.[1]).toMatchObject({
      data: { error: 'summary failed', recoverable: false },
    })

    await harness.close()
  })

  it('uses snapshot-backed planner context when generating the mode.accept summary', async () => {
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
    })

    getAllInstructionsMock.mockResolvedValue({ content: '', files: [] })
    streamLLMPureMock.mockReturnValue({ kind: 'stream' })
    consumeStreamGeneratorMock.mockResolvedValue({
      content: 'Summary content',
      toolCalls: [],
      segments: [],
      usage: { promptTokens: 20, completionTokens: 5 },
      timing: { ttft: 1, completionTime: 1, tps: 5, prefillTps: 20 },
      aborted: false,
      xmlFormatError: false,
    })
    runOrchestratorMock.mockResolvedValue({ success: true })

    const harness = await createHarness({ sessionManager })

    harness.send({ id: 'sc-ok', type: 'session.create', payload: { projectId: 'project-1' } })
    await harness.nextMessage((message) => message.id === 'sc-ok')

    harness.eventStore.append('session-1', {
      type: 'turn.snapshot',
      data: {
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Fix the bug where deleted session URLs hang forever.',
            timestamp: Date.now(),
            contextWindowId: 'window-1',
          },
          {
            id: 'msg-2',
            role: 'assistant',
            content: 'I found the issue and can propose criteria.',
            timestamp: Date.now(),
            contextWindowId: 'window-1',
          },
        ],
        criteria: [],
        contextState: { currentTokens: 50, maxTokens: 200000, compactionCount: 0, dangerZone: false, canCompact: false },
        currentContextWindowId: 'window-1',
        todos: [],
        readFiles: [],
        snapshotSeq: 1,
        snapshotAt: Date.now(),
      },
    })

    harness.send({ id: 'mode-accept-snapshot', type: 'mode.accept', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'mode-accept-snapshot')).toMatchObject({ type: 'ack' })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(streamLLMPureMock).toHaveBeenCalled()
    const summaryCall = streamLLMPureMock.mock.calls.at(-1)?.[0]
    expect(summaryCall.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: 'Fix the bug where deleted session URLs hang forever.' }),
    ]))
    expect(summaryCall.messages).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ content: expect.stringContaining('Plan mode ACTIVE') }),
    ]))

    await harness.close()
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
    harness.send({ id: 'sc-ok', type: 'session.create', payload: { projectId: 'project-1' } })
    await harness.nextMessage((message) => message.id === 'sc-ok')

    harness.send({ id: 'runner-1', type: 'runner.launch', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'runner-1')).toMatchObject({ type: 'ack' })
    expect(await harness.nextMessage((message) => message.type === 'session.running')).toMatchObject({ payload: { isRunning: true } })

    harness.send({ id: 'runner-2', type: 'runner.launch', payload: {} })
    expect(await harness.nextMessage((message) => message.id === 'runner-2')).toMatchObject({ type: 'ack' })
    expect(await harness.nextMessage((message) => message.type === 'session.running')).toMatchObject({ payload: { isRunning: true } })

    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(runOrchestratorMock).toHaveBeenCalledTimes(2)
    expect(eventStore.subscribe).toHaveBeenCalledTimes(1)
    expect(sessionManager.setRunning).toHaveBeenCalledWith('session-1', false)

    await harness.close()
  })

  it('forwards streamed event-store messages and ignores aborted runner errors', async () => {
    const eventStore: any = createEventStore()
    eventStore.subscribe = vi.fn((() => ({
      iterator: (async function* () {
        yield {
          seq: 1,
          sessionId: 'session-1',
          timestamp: Date.now(),
          type: 'chat.done',
          data: { messageId: 'assistant-1', reason: 'complete' },
        }
      })(),
      unsubscribe: vi.fn(),
    })) as any)

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
    runOrchestratorMock.mockRejectedValueOnce(new Error('Aborted'))

    const harness = await createHarness({ sessionManager, eventStore })
    harness.send({ id: 'sc-ok', type: 'session.create', payload: { projectId: 'project-1' } })
    await harness.nextMessage((message) => message.id === 'sc-ok')

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

  it('tags direct session-scoped messages with their originating session after switching sessions', async () => {
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

    let releaseRun: (() => void) | null = null
    let emitFromRun: ((message: TestMessage) => void) | null = null

    runChatTurnMock.mockImplementation(({ onMessage }) => new Promise<void>((resolve) => {
      emitFromRun = onMessage as (message: TestMessage) => void
      releaseRun = resolve
    }))

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

    const harness = await createHarness({ sessionManager })

    harness.send({ id: 'create-session-1', type: 'session.create', payload: { projectId: 'project-1' } })
    await harness.nextMessage((message) => message.id === 'create-session-1')
    await harness.nextMessage((message) => message.type === 'context.state' && message.sessionId === 'session-1')

    harness.send({ id: 'chat-session-1', type: 'chat.send', payload: { content: 'Keep working' } })
    await harness.nextMessage((message) => message.type === 'chat.message')
    await harness.nextMessage((message) => message.type === 'session.running')
    await harness.nextMessage((message) => message.id === 'chat-session-1')

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

    expect(emitFromRun).not.toBeNull()
    emitFromRun!({
      type: 'chat.path_confirmation',
      payload: {
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

    expect(releaseRun).not.toBeNull()
    releaseRun!()
    expect(await harness.nextMessage((message) => message.type === 'context.state' && message.sessionId === 'session-1')).toMatchObject({
      type: 'context.state',
      sessionId: 'session-1',
      payload: { context: { currentTokens: 11 } },
    })

    await harness.close()
  })
})
