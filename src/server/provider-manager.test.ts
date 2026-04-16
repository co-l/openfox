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
  setLlmStatus: vi.fn(),
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
      backend: 'vllm',
      apiKey: undefined,
      models: [{ id: 'model-a', contextWindow: 200000, source: 'default' as const }],
      isActive: true,
      createdAt: new Date().toISOString(),
    }
    
    const provider2: Provider = {
      id: 'provider-2',
      name: 'Another Provider',
      url: 'http://localhost:9000',
      backend: 'ollama',
      apiKey: undefined,
      models: [],
      isActive: false,
      createdAt: new Date().toISOString(),
    }

    config = {
      providers: [provider1, provider2],
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

  describe('getProviderModels', () => {
    it('returns empty array for non-existent provider', async () => {
      const models = await providerManager.getProviderModels('non-existent')
      expect(models).toEqual([])
    })

    it('returns stored models from provider', async () => {
      const models = await providerManager.getProviderModels('provider-1')
      
      expect(models).toEqual([
        { id: 'model-a', contextWindow: 200000, source: 'default' },
      ])
    })

    it('fetches from backend when no stored models', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'model-x', max_model_len: 128000 },
            { id: 'model-y', max_model_len: 256000 },
          ],
        }),
      })

      const provider: Provider = {
        id: 'provider-no-models',
        name: 'Test Provider No Models',
        url: 'http://localhost:8000',
        backend: 'vllm',
        apiKey: undefined,
        models: [],
        isActive: false,
        createdAt: new Date().toISOString(),
      }
      const configWithNoModels: Config = {
        ...config,
        providers: [...(config.providers ?? []), provider],
      }
      const pm = createProviderManager(configWithNoModels)
      
      const models = await pm.getProviderModels('provider-no-models')
      
      expect(models).toEqual([
        { id: 'model-x', contextWindow: 128000, source: 'backend' },
        { id: 'model-y', contextWindow: 256000, source: 'backend' },
      ])
    })

    it('returns empty array for provider with no models and fetch failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const provider: Provider = {
        id: 'provider-no-models',
        name: 'Test Provider No Models',
        url: 'http://localhost:8000',
        backend: 'vllm',
        apiKey: undefined,
        models: [],
        isActive: false,
        createdAt: new Date().toISOString(),
      }
      const configWithNoModels: Config = {
        ...config,
        providers: [...(config.providers ?? []), provider],
      }
      const pm = createProviderManager(configWithNoModels)
      
      const models = await pm.getProviderModels('provider-no-models')
      
      expect(models).toEqual([])
    })
  })

  describe('setDefaultModelSelection', () => {
    it('returns error for non-existent provider', async () => {
      const result = await providerManager.setDefaultModelSelection('non-existent', 'new-model')
      
      expect(result).toEqual({ success: false, error: 'Provider not found' })
    })

    it('updates default model selection for existing provider', async () => {
      const result = await providerManager.setDefaultModelSelection('provider-1', 'new-model')
      
      expect(result).toEqual({ success: true })
      expect(providerManager.getCurrentModel()).toBe('new-model')
    })

    it('updates LLM client when setting model for active provider', async () => {
      const mockClient = providerManager.getLLMClient()
      
      await providerManager.setDefaultModelSelection('provider-1', 'new-model')
      
      expect(mockClient.setModel).toHaveBeenCalledWith('new-model')
    })

    it('updates active provider when changing to different provider', async () => {
      await providerManager.setDefaultModelSelection('provider-2', 'new-model')
      
      expect(providerManager.getActiveProviderId()).toBe('provider-2')
      expect(providerManager.getCurrentModel()).toBe('new-model')
      
      const providers = providerManager.getProviders()
      expect(providers.find(p => p.id === 'provider-2')?.isActive).toBe(true)
      expect(providers.find(p => p.id === 'provider-1')?.isActive).toBe(false)
    })

    it('handles model names with slashes correctly', async () => {
      const result = await providerManager.setDefaultModelSelection('provider-1', 'Intel/Qwen3.5-397B')
      
      expect(result).toEqual({ success: true })
      expect(providerManager.getCurrentModel()).toBe('Intel/Qwen3.5-397B')
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
      
      expect(providerManager.getActiveProviderId()).toBe('provider-2')
      expect(providerManager.getCurrentModel()).toBe('model-x')
    })

    it('switches model for currently active provider', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'model-y' }] }),
      })

      const result = await providerManager.activateProvider('provider-1', { model: 'model-y' })
      
      expect(result).toEqual({ success: true })
      expect(providerManager.getCurrentModel()).toBe('model-y')
    })

    it('returns error for non-existent provider', async () => {
      const result = await providerManager.activateProvider('non-existent', { model: 'test' })
      
      expect(result).toEqual({ success: false, error: 'Provider not found' })
    })
  })

  describe('updateModelContext', () => {
    it('returns error for non-existent provider', async () => {
      const result = await providerManager.updateModelContext('non-existent', 'model-1', 100000)
      
      expect(result).toEqual({ success: false, error: 'Provider not found' })
    })

    it('updates context for existing model', async () => {
      const result = await providerManager.updateModelContext('provider-1', 'model-a', 100000)
      
      expect(result).toEqual({ success: true })
      
      const providers = providerManager.getProviders()
      const model = providers.find(p => p.id === 'provider-1')?.models.find(m => m.id === 'model-a')
      expect(model?.contextWindow).toBe(100000)
      expect(model?.source).toBe('user')
    })

    it('adds new model if not found', async () => {
      const result = await providerManager.updateModelContext('provider-1', 'new-model', 150000)
      
      expect(result).toEqual({ success: true })
      
      const providers = providerManager.getProviders()
      const model = providers.find(p => p.id === 'provider-1')?.models.find(m => m.id === 'new-model')
      expect(model).toEqual({ id: 'new-model', contextWindow: 150000, source: 'user' })
    })
  })

  describe('refreshProviderModels', () => {
    it('returns error for non-existent provider', async () => {
      const result = await providerManager.refreshProviderModels('non-existent')
      
      expect(result).toEqual({ success: false, error: 'Provider not found' })
    })

    it('refreshes models from backend', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'model-x', max_model_len: 128000 },
            { id: 'model-y', max_model_len: 256000 },
          ],
        }),
      })

      const result = await providerManager.refreshProviderModels('provider-1')
      
      expect(result).toEqual({ success: true })
      
      const providers = providerManager.getProviders()
      const models = providers.find(p => p.id === 'provider-1')?.models
      expect(models).toEqual([
        { id: 'model-x', contextWindow: 128000, source: 'backend' },
        { id: 'model-y', contextWindow: 256000, source: 'backend' },
      ])
    })

    it('preserves user overrides during refresh', async () => {
      await providerManager.updateModelContext('provider-1', 'model-a', 150000)
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'model-a', max_model_len: 200000 },
            { id: 'model-b', max_model_len: 100000 },
          ],
        }),
      })

      await providerManager.refreshProviderModels('provider-1')
      
      const providers = providerManager.getProviders()
      const models = providers.find(p => p.id === 'provider-1')?.models
      const modelA = models?.find(m => m.id === 'model-a')
      expect(modelA?.contextWindow).toBe(150000)
      expect(modelA?.source).toBe('user')
    })

    it('returns error when backend returns no models', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      })

      const result = await providerManager.refreshProviderModels('provider-1')
      
      expect(result).toEqual({ success: false, error: 'No models returned from backend' })
    })

    it('uses alternate endpoint for OpenCode Go', async () => {
      const opencodeProvider: Provider = {
        id: 'provider-opencode',
        name: 'OpenCode Go',
        url: 'https://opencode.ai/zen/go/v1',
        backend: 'opencode-go',
        apiKey: 'test-key',
        models: [],
        isActive: true,
        createdAt: new Date().toISOString(),
      }
      const addedProvider = providerManager.addProvider(opencodeProvider)

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'glm-5', max_model_len: 32000 },
            { id: 'kimi-k2.5', max_model_len: 64000 },
          ],
        }),
      })

      const result = await providerManager.refreshProviderModels(addedProvider.id)
      
      expect(result.success).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://opencode.ai/zen/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
        })
      )
    })
  })

  describe('getCurrentModelContext', () => {
    it('returns default when no provider is active', async () => {
      await providerManager.setDefaultModelSelection('provider-2', 'model-x')
      const context = providerManager.getCurrentModelContext()
      expect(context).toBe(config.context.maxTokens)
    })

    it('returns model context from provider', async () => {
      await providerManager.updateModelContext('provider-1', 'model-a', 128000)
      const context = providerManager.getCurrentModelContext()
      expect(context).toBe(128000)
    })

    it('returns default when model not found', async () => {
      await providerManager.setDefaultModelSelection('provider-1', 'non-existent-model')
      const context = providerManager.getCurrentModelContext()
      expect(context).toBe(config.context.maxTokens)
    })
  })
})
