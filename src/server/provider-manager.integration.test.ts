import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createProviderManager } from './provider-manager.js'
import type { Config } from '../shared/types.js'

// Mock the LLM client
vi.mock('./llm/index.js', () => ({
  createLLMClient: vi.fn(() => ({
    setBackend: vi.fn(),
    setModel: vi.fn(),
    getModel: vi.fn(() => 'test-model'),
    getBackend: vi.fn(() => 'vllm'),
  })),
  detectBackend: vi.fn(() => Promise.resolve('vllm')),
  detectModel: vi.fn(() => Promise.resolve('test-model')),
  clearModelCache: vi.fn(),
  setLlmStatus: vi.fn(),
  getModelProfile: vi.fn(() => ({ reasoning: false })),
}))

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('ProviderManager - Integration', () => {
  let config: Config
  let providerManager: ReturnType<typeof createProviderManager>

  beforeEach(() => {
    vi.resetAllMocks()
    
    config = {
      providers: [
        {
          id: 'provider-1',
          name: 'Test Provider',
          url: 'http://localhost:8000',
          backend: 'vllm',
          apiKey: undefined,
          models: [{ id: 'model-a', contextWindow: 200000, source: 'default' }],
          isActive: true,
          createdAt: new Date().toISOString(),
        },
      ],
      defaultModelSelection: 'provider-1/model-a',
      server: { port: 10369, host: '127.0.0.1', openBrowser: true },
      logging: { level: 'info' as const },
      database: { path: '' },
      llm: { baseUrl: 'http://localhost:8000/v1', model: 'model-a', timeout: 120000, idleTimeout: 30000, backend: 'vllm' },
      context: { maxTokens: 4096, compactionThreshold: 10000, compactionTarget: 8000 },
      agent: { maxIterations: 100, maxConsecutiveFailures: 5, toolTimeout: 30000 },
      workdir: process.cwd(),
    }

    providerManager = createProviderManager(config)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Full model selection flow', () => {
    it('returns stored models', async () => {
      const availableModels = await providerManager.getProviderModels('provider-1')
      expect(availableModels).toEqual([
        { id: 'model-a', contextWindow: 200000, source: 'default' },
      ])
    })

    it('handles model switch for active provider correctly', async () => {
      expect(providerManager.getCurrentModel()).toBe('model-a')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'model-new', max_model_len: 128000 }] }),
      })

      const models = await providerManager.refreshProviderModels('provider-1')
      expect(models.success).toBe(true)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'model-new' }] }),
      })

      await providerManager.activateProvider('provider-1', { model: 'model-new' })
      
      expect(providerManager.getCurrentModel()).toBe('model-new')
    })

    it('preserves other providers when switching model for active provider', async () => {
      providerManager.addProvider({
        name: 'Provider 2',
        url: 'http://localhost:9000',
        backend: 'ollama',
        isActive: false,
        models: [],
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'model-switch', max_model_len: 100000 }] }),
      })

      await providerManager.refreshProviderModels('provider-1')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'model-switch' }] }),
      })

      await providerManager.activateProvider('provider-1', { model: 'model-switch' })

      expect(providerManager.getCurrentModel()).toBe('model-switch')
    })
  })

  describe('Error handling', () => {
    it('fetches from backend and handles fetch failure gracefully', async () => {
      const provider = config.providers![0]!
      const configNoModels: Config = {
        ...config,
        providers: [
          {
            ...provider,
            models: [],
          },
        ],
      }
      const pm = createProviderManager(configNoModels)
      
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'))

      const models = await pm.getProviderModels('provider-1')
      
      expect(models).toEqual([])
    })

    it('fetches from backend and handles non-ok response', async () => {
      const provider = config.providers![0]!
      const configNoModels: Config = {
        ...config,
        providers: [
          {
            ...provider,
            models: [],
          },
        ],
      }
      const pm = createProviderManager(configNoModels)
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      })

      const models = await pm.getProviderModels('provider-1')
      
      expect(models).toEqual([])
    })

  })

  describe('Edge cases', () => {
    it('fetches from backend when no stored models', async () => {
      const provider = config.providers![0]!
      const configNoModels: Config = {
        ...config,
        providers: [
          {
            ...provider,
            models: [],
          },
        ],
      }
      const pm = createProviderManager(configNoModels)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ 
          data: [{ id: 'model-fetched', max_model_len: 150000 }],
        }),
      })

      const models = await pm.getProviderModels('provider-1')
      
      expect(models).toEqual([
        { id: 'model-fetched', contextWindow: 150000, source: 'backend' },
      ])
    })

    it('handles provider without /v1 in URL', async () => {
      const provider = config.providers![0]!
      const configNoV1: Config = {
        ...config,
        providers: [
          {
            ...provider,
            url: 'http://localhost:8000',
            models: [],
          },
        ],
      }
      const pm = createProviderManager(configNoV1)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'model', max_model_len: 100000 }] }),
      })

      await pm.getProviderModels('provider-1')

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/v1/models',
        expect.any(Object)
      )
    })

    it('handles provider with /v1 in URL (no double /v1)', async () => {
      const provider = config.providers![0]!
      const configWithV1: Config = {
        ...config,
        providers: [
          {
            ...provider,
            url: 'http://localhost:8000/v1',
            models: [],
          },
        ],
      }
      const pm = createProviderManager(configWithV1)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'model', max_model_len: 100000 }] }),
      })

      await pm.getProviderModels('provider-1')

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/v1/models',
        expect.any(Object)
      )
    })
  })
})
