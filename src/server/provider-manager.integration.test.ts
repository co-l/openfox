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
          model: 'model-a',
          backend: 'vllm',
          apiKey: undefined,
          maxContext: 200000,
          isActive: true,
          createdAt: new Date().toISOString(),
        },
      ],
      activeProviderId: 'provider-1',
      server: { port: 10369, host: '127.0.0.1', openBrowser: true },
      logging: { level: 'info' as const },
      database: { path: '' },
      llm: { baseUrl: 'http://localhost:8000/v1', model: 'model-a', timeout: 120000, backend: 'vllm' },
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
    it('completes the full model selection flow: fetch models, then activate with selected model', async () => {
      // Step 1: Fetch available models
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'model-alpha' },
            { id: 'model-beta' },
            { id: 'model-gamma' },
          ],
        }),
      })

      const availableModels = await providerManager.getProviderModels('provider-1')
      expect(availableModels).toEqual(['model-alpha', 'model-beta', 'model-gamma'])

      // Step 2: Activate provider with selected model
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'model-beta' }] }),
      })

      const result = await providerManager.activateProvider('provider-1', { 
        model: 'model-beta' 
      })

      expect(result).toEqual({ success: true })
      
      const activeProvider = providerManager.getActiveProvider()
      expect(activeProvider?.model).toBe('model-beta')
    })

    it('handles model switch for active provider correctly', async () => {
      // Initial state
      expect(providerManager.getActiveProvider()?.model).toBe('model-a')

      // Fetch models
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'model-new' }] }),
      })

      const models = await providerManager.getProviderModels('provider-1')
      expect(models).toContain('model-new')

      // Switch to new model
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'model-new' }] }),
      })

      await providerManager.activateProvider('provider-1', { model: 'model-new' })
      
      expect(providerManager.getActiveProvider()?.model).toBe('model-new')
    })

    it('preserves other providers when switching model for active provider', async () => {
      // Add another provider
      providerManager.addProvider({
        name: 'Provider 2',
        url: 'http://localhost:9000',
        model: 'model-2',
        backend: 'ollama',
        isActive: false,
        maxContext: 200000,
      })

      // Fetch models for provider 1
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'model-switch' }] }),
      })

      await providerManager.getProviderModels('provider-1')

      // Switch model for provider 1
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'model-switch' }] }),
      })

      await providerManager.activateProvider('provider-1', { model: 'model-switch' })

      const providers = providerManager.getProviders()
      expect(providers.find(p => p.id === 'provider-1')?.model).toBe('model-switch')
      expect(providers.find(p => p.name === 'Provider 2')?.model).toBe('model-2')
    })
  })

  describe('Error handling', () => {
    it('handles fetch failure gracefully when getting models', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'))

      const models = await providerManager.getProviderModels('provider-1')
      
      expect(models).toEqual([])
    })

    it('handles non-ok response when getting models', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      })

      const models = await providerManager.getProviderModels('provider-1')
      
      expect(models).toEqual([])
    })

    it('handles malformed response when getting models', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ invalid: 'format' }),
      })

      const models = await providerManager.getProviderModels('provider-1')
      
      expect(models).toEqual([])
    })
  })

  describe('Edge cases', () => {
    it('handles provider with API key when fetching models', async () => {
      const provider = config.providers![0]!
      const configWithKey: Config = {
        ...config,
        providers: [
          {
            ...provider,
            apiKey: 'test-api-key',
          },
        ],
      }
      const pm = createProviderManager(configWithKey)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'model-with-key' }] }),
      })

      await pm.getProviderModels('provider-1')

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key',
          }),
        })
      )
    })

    it('handles provider without /v1 in URL', async () => {
      const provider = config.providers![0]!
      const configNoV1: Config = {
        ...config,
        providers: [
          {
            ...provider,
            url: 'http://localhost:8000', // No /v1
          },
        ],
      }
      const pm = createProviderManager(configNoV1)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'model' }] }),
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
            url: 'http://localhost:8000/v1', // Already has /v1
          },
        ],
      }
      const pm = createProviderManager(configWithV1)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'model' }] }),
      })

      await pm.getProviderModels('provider-1')

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/v1/models',
        expect.any(Object)
      )
    })
  })
})
