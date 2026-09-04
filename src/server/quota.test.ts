import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ServerHandle } from './context.js'
import type { QuotaReport } from '../shared/types.js'
import type { QuotaProvider } from '../provider/index.js'
import { createServerHandle } from './index.js'

function testConfig() {
  return {
    llm: {
      baseUrl: 'http://localhost:8000',
      model: 'test-model',
      timeout: 300000,
      idleTimeout: 300000,
      backend: 'vllm' as const,
    },
    context: { maxTokens: 200000, compactionThreshold: 0.85, compactionTarget: 0.6 },
    agent: { maxIterations: 10, maxConsecutiveFailures: 3, toolTimeout: 300000 },
    server: { port: 0, host: '127.0.0.1' },
    database: { path: ':memory:' },
    mode: 'test' as const,
    workdir: '/tmp',
  }
}

describe('GET /api/quota endpoint', () => {
  let handle: ServerHandle
  let port: number

  beforeAll(async () => {
    handle = await createServerHandle(testConfig())
    ;({ port } = await handle.start(0))
  }, 30_000)

  afterAll(async () => {
    await handle?.close()
  })

  it('aggregates registered quota providers and handles provider failures gracefully', async () => {
    const workingProvider: QuotaProvider = {
      id: 'provider-1',
      name: 'Provider 1',
      getQuota: async () => ({
        id: 'provider-1',
        name: 'Provider 1',
        metrics: [
          {
            kind: 'windowed',
            label: 'Requests',
            used: 10,
            limit: 100,
            window: 'hour',
          },
        ],
      }),
    }

    const failingProvider: QuotaProvider = {
      id: 'provider-2',
      name: 'Provider 2',
      getQuota: async () => {
        throw new Error('Network error')
      },
    }

    handle.ctx.providerAdapters?.registerQuotaProvider(workingProvider)
    handle.ctx.providerAdapters?.registerQuotaProvider(failingProvider)

    const res = await fetch(`http://127.0.0.1:${port}/api/quota`)
    expect(res.status).toBe(200)
    const data = (await res.json()) as QuotaReport
    expect(data.sources.some((s) => s.id === 'provider-1')).toBe(true)
    const provider1 = data.sources.find((s) => s.id === 'provider-1')
    expect(provider1).toBeDefined()
    const metric = provider1?.metrics[0]
    expect(metric?.kind).toBe('windowed')
    if (metric?.kind === 'windowed') {
      expect(metric.used).toBe(10)
    }
  })
})
