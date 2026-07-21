import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LlmBackend, Provider } from '../shared/types.js'

const mockDetectModel = vi.fn()

vi.mock('./llm/models.js', () => ({
  detectModel: mockDetectModel,
  getLlmStatus: vi.fn(() => 'unknown'),
  setLlmStatus: vi.fn(),
  clearModelCache: vi.fn(),
  getCachedModel: vi.fn(() => null),
}))

function makeProvider(id: string, modelId: string): Provider {
  return {
    id,
    name: 'Test Provider',
    url: 'http://localhost:8000/v1',
    backend: 'vllm',
    models: [{ id: modelId, contextWindow: 200000, source: 'backend' as const }],
    isActive: true,
    createdAt: new Date().toISOString(),
  }
}

function testConfig(overrides?: { defaultModelSelection?: string; providers?: Provider[] }) {
  return {
    llm: {
      baseUrl: 'http://localhost:8000',
      model: '',
      timeout: 300000,
      idleTimeout: 300000,
      backend: 'vllm' as LlmBackend,
    },
    context: { maxTokens: 200000, compactionThreshold: 0.85, },
    agent: { maxIterations: 10, maxConsecutiveFailures: 3, toolTimeout: 300000 },
    server: { port: 0, host: '127.0.0.1' },
    database: { path: ':memory:' },
    mode: 'test' as const,
    workdir: '/tmp',
    ...overrides,
  }
}

describe('initLLM - model auto-detect respects defaultModelSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDetectModel.mockResolvedValue('auto-detected-minimax-m3')
  })

  async function createServer(config: ReturnType<typeof testConfig>) {
    const { createServerHandle } = await import('./index.js')
    return createServerHandle(config)
  }

  it('overrides model with auto-detected when no defaultModelSelection is set', async () => {
    const handle = await createServer(testConfig())
    expect(handle.ctx.llmClient.getModel()).toBe('auto-detected-minimax-m3')
  })

  it('preserves configured model when defaultModelSelection is set', async () => {
    const provider = makeProvider('test-provider', 'deepseek-v4-flash')
    const handle = await createServer(
      testConfig({
        defaultModelSelection: 'test-provider/deepseek-v4-flash',
        providers: [provider],
      }),
    )
    expect(handle.ctx.llmClient.getModel()).toBe('deepseek-v4-flash')
  })
})
