import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import type { Express } from 'express'
import type { StatsSource } from '../../shared/types.js'
import type { SessionManager } from '../session/index.js'

const mockSession = {
  id: 'session-1',
  projectId: 'project-1',
  workdir: '/tmp/project',
  workspace: '/tmp/project',
  mode: 'builder',
  phase: 'build',
  isRunning: false,
}

const statSource: StatsSource[] = [
  {
    id: 'msg-1',
    timestamp: '2024-01-01T10:00:00.000Z',
    stats: {
      providerId: 'provider-1',
      providerName: 'Local vLLM',
      backend: 'vllm',
      model: 'qwen-1',
      mode: 'builder',
      totalTime: 10,
      toolTime: 2,
      prefillTokens: 50000,
      prefillSpeed: 10000,
      generationTokens: 500,
      generationSpeed: 150,
      llmCalls: [
        {
          providerId: 'provider-1',
          providerName: 'Local vLLM',
          backend: 'vllm',
          model: 'qwen-1',
          callIndex: 1,
          promptTokens: 50000,
          completionTokens: 500,
          ttft: 4.8,
          completionTime: 3.3,
          prefillSpeed: 10000,
          generationSpeed: 150,
          totalTime: 8.1,
        },
      ],
    },
  },
]

describe('GET /api/sessions/:id/stats — real handler', () => {
  let app: Express
  let server: ReturnType<Express['listen']>
  let baseUrl: string
  let sessionManagerMock: { getSession: ReturnType<typeof vi.fn> }
  let buildStatsMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    sessionManagerMock = { getSession: vi.fn(() => mockSession) }
    buildStatsMock = vi.fn(() => statSource)

    vi.doMock('../events/index.js', () => ({
      getEventStore: () => ({
        getEventsSinceSnapshot: vi.fn(() => ({ snapshot: undefined, events: [] })),
      }),
      combineEventsWithSnapshot: vi.fn((_id: string, _snapshot: unknown, events: unknown[]) => [
        ...(events as unknown[]),
        {
          seq: 1,
          timestamp: 1,
          sessionId: 'session-1',
          type: 'pattern.retry',
          data: { messageId: 'msg-1', pattern: '<tool_call', field: 'content', attempt: 1, maxAttempts: 10 },
        },
      ]),
      getLegacyCompactionBaseline: vi.fn(() => null),
    }))

    vi.doMock('../events/folding.js', () => ({
      buildSessionStatsMessages: buildStatsMock,
    }))

    const { handleGetSessionStats } = await import('./session-stats.js')

    app = express()
    app.use(express.json())
    app.get('/api/sessions/:id/stats', (req, res) => {
      void handleGetSessionStats(sessionManagerMock as unknown as SessionManager, req, res)
    })

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${(server.address() as { port: number }).port}`
        resolve()
      })
    })
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    vi.resetModules()
  })

  it('returns the full session stats with per-response and per-call progression data', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/session-1/stats`)
    expect(res.status).toBe(200)
    const data = (await res.json()) as {
      stats: {
        responseCount: number
        llmCallCount: number
        events: { retries: Array<{ responseIndex: number }> }
      }
    }

    expect(buildStatsMock).toHaveBeenCalled()
    expect(data.stats).not.toBeNull()
    expect(data.stats.responseCount).toBe(1)
    expect(data.stats.llmCallCount).toBe(1)
    expect(data.stats).toHaveProperty('dataPoints')
    expect(data.stats).toHaveProperty('callDataPoints')
    expect(data.stats).toHaveProperty('events')
    expect(data.stats.events.retries).toHaveLength(1)
    expect(data.stats.events.retries[0]!.responseIndex).toBe(1)
  })

  it('returns 404 for an unknown session', async () => {
    sessionManagerMock.getSession.mockReturnValue(undefined)
    const res = await fetch(`${baseUrl}/api/sessions/unknown/stats`)
    expect(res.status).toBe(404)
  })

  it('returns { stats: null } when no response has stats', async () => {
    buildStatsMock.mockReturnValue([])
    const res = await fetch(`${baseUrl}/api/sessions/session-1/stats`)
    const data = (await res.json()) as { stats: unknown }
    expect(data.stats).toBeNull()
  })
})
