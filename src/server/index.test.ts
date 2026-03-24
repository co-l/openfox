import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Config, Session, SessionSummary } from '../shared/types.js'

const TEST_CONFIG: Config = {
  llm: {
    baseUrl: 'http://localhost:8000/v1',
    model: 'test-model',
    timeout: 1_000,
    backend: 'auto',
  },
  context: {
    maxTokens: 200_000,
    compactionThreshold: 0.85,
    compactionTarget: 0.6,
  },
  agent: {
    maxIterations: 10,
    maxConsecutiveFailures: 3,
    toolTimeout: 1_000,
  },
  server: {
    port: 0,
    host: '127.0.0.1',
  },
  database: {
    path: ':memory:',
  },
  mode: 'production',
  workdir: process.cwd(),
}

describe('server history watcher isolation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('starts history watching only for the current workdir on boot', async () => {
    const harness = await createHarness({
      existingSessions: [
        makeSessionSummary('session-1', '/tmp/legacy-project-a'),
        makeSessionSummary('session-2', '/tmp/legacy-project-b'),
      ],
    })

    expect(harness.spawnedWorkdirs).toEqual([process.cwd()])

    await harness.handle.close()
  })

  it('starts and stops an isolated history process with the last session', async () => {
    const harness = await createHarness()

    const session = harness.sessionManager.createSession('/tmp/project-a')

    await vi.waitFor(() => {
      expect(harness.spawnedWorkdirs).toEqual([process.cwd(), '/tmp/project-a'])
    })

    harness.sessionManager.deleteSession(session.id)

    await vi.waitFor(() => {
      const proc = harness.childrenByWorkdir.get('/tmp/project-a')
      expect(proc).toBeDefined()
      expect(harness.terminateProcessTreeMock).toHaveBeenCalledWith(proc, expect.any(Object))
    })

    await harness.handle.close()
  })

  it('keeps a shared workdir process alive until all sessions are removed', async () => {
    const harness = await createHarness()

    const first = harness.sessionManager.createSession('/tmp/project-b')
    const second = harness.sessionManager.createSession('/tmp/project-b')

    await vi.waitFor(() => {
      expect(harness.spawnedWorkdirs.filter(workdir => workdir === '/tmp/project-b')).toHaveLength(1)
    })

    harness.sessionManager.deleteSession(first.id)

    expect(harness.terminateProcessTreeMock).not.toHaveBeenCalledWith(
      harness.childrenByWorkdir.get('/tmp/project-b'),
      expect.any(Object)
    )

    harness.sessionManager.deleteSession(second.id)

    await vi.waitFor(() => {
      const proc = harness.childrenByWorkdir.get('/tmp/project-b')
      expect(proc).toBeDefined()
      expect(harness.terminateProcessTreeMock).toHaveBeenCalledWith(proc, expect.any(Object))
    })

    await harness.handle.close()
  })

  it('survives child process errors and can restart history for later sessions', async () => {
    const harness = await createHarness()

    harness.sessionManager.createSession('/tmp/project-c')

    await vi.waitFor(() => {
      expect(harness.spawnedWorkdirs.filter(workdir => workdir === '/tmp/project-c')).toHaveLength(1)
    })

    const proc = harness.childrenByWorkdir.get('/tmp/project-c')
    expect(proc).toBeDefined()

    expect(() => {
      proc?.emit('error', new Error('child watcher failed'))
    }).not.toThrow()

    harness.sessionManager.createSession('/tmp/project-c')

    await vi.waitFor(() => {
      expect(harness.spawnedWorkdirs.filter(workdir => workdir === '/tmp/project-c')).toHaveLength(2)
    })

    await harness.handle.close()
  })
})

async function createHarness(options: {
  existingSessions?: SessionSummary[]
} = {}) {
  const spawnedWorkdirs: string[] = []
  const childrenByWorkdir = new Map<string, FakeChildProcess>()
  const terminateProcessTreeMock = vi.fn(async () => {})
  let nextPid = 1000

  vi.doMock('node:child_process', () => ({
    spawn: vi.fn((_command: string, args: readonly string[]) => {
      const workdir = args[args.length - 1]
      if (!workdir) {
        throw new Error('Missing workdir arg')
      }

      spawnedWorkdirs.push(workdir)

      const child = new FakeChildProcess(nextPid++)
      childrenByWorkdir.set(workdir, child)
      return child
    }),
  }))

  vi.doMock('./utils/process-tree.js', () => ({
    terminateProcessTree: terminateProcessTreeMock,
  }))

  vi.doMock('./db/index.js', () => ({
    initDatabase: vi.fn(() => ({})),
    closeDatabase: vi.fn(),
    getDatabase: vi.fn(() => ({})),
  }))

  vi.doMock('./events/index.js', () => ({
    initEventStore: vi.fn(),
  }))

  vi.doMock('./llm/index.js', () => ({
    createLLMClient: vi.fn(),
    detectModel: vi.fn(async () => 'test-model'),
    getLlmStatus: vi.fn(),
    detectBackend: vi.fn(async () => 'vllm'),
    getBackendDisplayName: vi.fn(() => 'vLLM'),
  }))

  vi.doMock('./llm/mock.js', () => ({
    createMockLLMClient: vi.fn(),
  }))

  vi.doMock('./provider-manager.js', () => {
    const llmClient = {
      setBackend: vi.fn(),
      setModel: vi.fn(),
      getBackend: vi.fn(() => 'vllm'),
      getModel: vi.fn(() => 'test-model'),
    }

    return {
      createProviderManager: vi.fn(() => ({
        getLLMClient: vi.fn(() => llmClient),
        getActiveProvider: vi.fn(() => undefined),
      })),
    }
  })

  vi.doMock('./tools/index.js', () => ({
    createToolRegistry: vi.fn(() => ({ tools: [], definitions: [], execute: vi.fn() })),
  }))

  vi.doMock('./ws/index.js', () => ({
    createWebSocketServer: vi.fn(() => ({
      clients: new Set(),
      close: vi.fn(),
    })),
  }))

  vi.doMock('./runtime-config.js', () => ({
    setRuntimeConfig: vi.fn(),
  }))

  vi.doMock('./utils/logger.js', () => ({
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    setLogLevel: vi.fn(),
  }))

  vi.doMock('./session/manager.js', () => {
    type SessionEvent =
      | { type: 'session_created'; session: Session }
      | { type: 'session_deleted'; sessionId: string }

    const initialSessions = options.existingSessions ?? []

    return {
      SessionManager: class {
        private sessions = new Map(initialSessions.map(session => [session.id, session]))
        private listeners: Array<(event: SessionEvent) => void> = []

        listSessions() {
          return [...this.sessions.values()]
        }

        subscribe(callback: (event: SessionEvent) => void) {
          this.listeners.push(callback)
          return () => {
            this.listeners = this.listeners.filter(listener => listener !== callback)
          }
        }

        createSession(workdir: string) {
          const session = makeSession(`session-${this.sessions.size + 1}`, workdir)
          this.sessions.set(session.id, makeSessionSummary(session.id, workdir))
          this.emit({ type: 'session_created', session })
          return session
        }

        getSession(sessionId: string) {
          const session = this.sessions.get(sessionId)
          return session ? makeSession(session.id, session.workdir) : null
        }

        deleteSession(sessionId: string) {
          this.sessions.delete(sessionId)
          this.emit({ type: 'session_deleted', sessionId })
        }

        getProject() {
          return null
        }

        deleteAllSessions() {}

        private emit(event: SessionEvent) {
          for (const listener of this.listeners) {
            listener(event)
          }
        }
      },
    }
  })

  const { createServerHandle } = await import('./index.js')
  const handle = await createServerHandle(TEST_CONFIG)

  return {
    handle,
    spawnedWorkdirs,
    childrenByWorkdir,
    terminateProcessTreeMock,
    sessionManager: handle.ctx.sessionManager as {
      createSession: (workdir: string) => Session
      deleteSession: (sessionId: string) => void
    },
  }
}

function makeSessionSummary(id: string, workdir: string): SessionSummary {
  return {
    id,
    projectId: workdir,
    workdir,
    mode: 'planner',
    phase: 'plan',
    isRunning: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    criteriaCount: 0,
    criteriaCompleted: 0,
  }
}

function makeSession(id: string, workdir: string): Session {
  return {
    id,
    projectId: workdir,
    workdir,
    mode: 'planner',
    phase: 'plan',
    isRunning: false,
    summary: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: [],
    criteria: [],
    contextWindows: [],
    executionState: null,
    metadata: {
      totalTokensUsed: 0,
      totalToolCalls: 0,
      iterationCount: 0,
    },
  }
}

class FakeChildProcess extends EventEmitter {
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null

  constructor(public pid: number) {
    super()
  }

  kill(): boolean {
    return true
  }
}
