import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createProviderManager } from './provider-manager.js'
import type { Config, Provider } from '../shared/types.js'

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

describe('ProviderManager - Model Selection', () => {
  let config: Config
  let providerManager: ReturnType<typeof createProviderManager>

  beforeEach(() => {
    vi.resetAllMocks()
    
    const provider1: Provider = {
      id: 'provider-1',
      name: 'Test Provider',
      url: 'http://localhost:8000',
      model: 'model-a',
      backend: 'vllm',
      apiKey: undefined,
      maxContext: 200000,
      isActive: true,
      createdAt: new Date().toISOString(),
    }
    
    const provider2: Provider = {
      id: 'provider-2',
      name: 'Another Provider',
      url: 'http://localhost:9000',
      model: 'model-b',
      backend: 'ollama',
      apiKey: undefined,
      maxContext: 200000,
      isActive: false,
      createdAt: new Date().toISOString(),
    }

    config = {
      providers: [provider1, provider2],
      activeProviderId: 'provider-1',
      server: { port: 10369, host: '127.0.0.1', openBrowser: true },
      logging: { level: 'info' as const },
      database: { path: '' },
      llm: { baseUrl: 'http://localhost:8000/v1', model: 'model-a', timeout: 120000, backend: 'vllm' },
      context: { maxTokens: 4096, compactionThreshold: 10000, compactionTarget: 8000 },
      agent: { maxIterations: 100, maxConsecutiveFailures: 5, toolTimeout: 30000 },
    }

    providerManager = createProviderManager(config)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getProviderModels', () => {
    it('returns empty array for non-existent provider', async () => {
      const models = await providerManager.getProviderModels('non-existent')
      expect(models).toEqual([])
    })

    it('fetches models from provider backend', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'model-x' },
            { id: 'model-y' },
            { id: 'model-z' },
          ],
        }),
      })

      const models = await providerManager.getProviderModels('provider-1')
      
      expect(models).toEqual(['model-x', 'model-y', 'model-z'])
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/v1/models',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        })
      )
    })

    it('handles missing apiKey when fetching models', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'model-1' }] }),
      })

      const models = await providerManager.getProviderModels('provider-1')
      
      expect(models).toEqual(['model-1'])
    })

    it('returns empty array on fetch failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const models = await providerManager.getProviderModels('provider-1')
      
      expect(models).toEqual([])
    })

    it('returns empty array when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      })

      const models = await providerManager.getProviderModels('provider-1')
      
      expect(models).toEqual([])
    })

    it('handles backend without /v1 in URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'model-a' }] }),
      })

      // Provider with URL that already has /v1
      const provider: Provider = {
        id: 'provider-1',
        name: 'Test Provider',
        url: 'http://localhost:8000/v1',
        model: 'model-a',
        backend: 'vllm',
        apiKey: undefined,
        maxContext: 200000,
        isActive: true,
        createdAt: new Date().toISOString(),
      }
      const configWithV1: Config = {
        ...config,
        providers: [provider],
      }
      const pm = createProviderManager(configWithV1)
      
      await pm.getProviderModels('provider-1')
      
      // Should fetch from http://localhost:8000/v1/models (not double /v1)
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/v1/models',
        expect.any(Object)
      )
    })
  })

  describe('setProviderModel', () => {
    it('returns error for non-existent provider', async () => {
      const result = await providerManager.setProviderModel('non-existent', 'new-model')
      
      expect(result).toEqual({ success: false, error: 'Provider not found' })
    })

    it('updates model for existing provider', async () => {
      const result = await providerManager.setProviderModel('provider-1', 'new-model')
      
      expect(result).toEqual({ success: true })
      
      const providers = providerManager.getProviders()
      const updatedProvider = providers.find(p => p.id === 'provider-1')
      
      expect(updatedProvider?.model).toBe('new-model')
    })

    it('updates LLM client when setting model for active provider', async () => {
      const mockClient = providerManager.getLLMClient()
      
      await providerManager.setProviderModel('provider-1', 'new-model')
      
      expect(mockClient.setModel).toHaveBeenCalledWith('new-model')
    })

    it('does not update LLM client for inactive provider', async () => {
      const mockClient = providerManager.getLLMClient()
      
      await providerManager.setProviderModel('provider-2', 'new-model')
      
      expect(mockClient.setModel).not.toHaveBeenCalled()
      
      const providers = providerManager.getProviders()
      expect(providers.find(p => p.id === 'provider-2')?.model).toBe('new-model')
    })
  })

  describe('activateProvider with model option', () => {
    it('activates provider with specified model', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'model-x' }] }),
      })

      const result = await providerManager.activateProvider('provider-2', { model: 'model-x' })
      
      expect(result).toEqual({ success: true })
      
      const activeProvider = providerManager.getActiveProvider()
      expect(activeProvider?.id).toBe('provider-2')
      expect(activeProvider?.model).toBe('model-x')
    })

    it('switches model for currently active provider', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'model-y' }] }),
      })

      const result = await providerManager.activateProvider('provider-1', { model: 'model-y' })
      
      expect(result).toEqual({ success: true })
      
      const activeProvider = providerManager.getActiveProvider()
      expect(activeProvider?.model).toBe('model-y')
    })

    it('returns error for non-existent provider', async () => {
      const result = await providerManager.activateProvider('non-existent', { model: 'test' })
      
      expect(result).toEqual({ success: false, error: 'Provider not found' })
    })
  })
})
