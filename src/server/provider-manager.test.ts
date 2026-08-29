import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createProviderManager, fetchModelsWithContext } from './provider-manager.js'
import { createLLMClient } from './llm/index.js'
import type { Config, Provider } from '../shared/types.js'

// Mock the LLM client
vi.mock('./llm/index.js', () => ({
  createLLMClient: vi.fn(() => ({
    setBackend: vi.fn(),
    setModel: vi.fn(),
    getModel: vi.fn(() => 'test-model'),
    getBackend: vi.fn(() => 'vllm'),
  })),
  detectModel: vi.fn(() => Promise.resolve('test-model')),
  clearModelCache: vi.fn(),
  setLlmStatus: vi.fn(),
  getModelProfile: vi.fn(() => ({ reasoning: false })),
}))

const createLLMClientMock = vi.mocked(createLLMClient)

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
      llm: {
        baseUrl: 'http://localhost:8000/v1',
        model: 'model-a',
        timeout: 120000,
        idleTimeout: 30000,
        backend: 'vllm',
      },
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

      expect(models).toEqual([{ id: 'model-a', contextWindow: 200000, source: 'default' }])
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

  describe('initialization with apiKey', () => {
    it('includes active provider apiKey when creating initial LLM client', async () => {
      const providerWithKey: Provider = {
        id: 'provider-key',
        name: 'Key Provider',
        url: 'https://api.deepseek.com',
        backend: 'openai',
        apiKey: 'sk-my-secret-key',
        models: [{ id: 'deepseek-chat', contextWindow: 64000, source: 'default' }],
        isActive: true,
        createdAt: new Date().toISOString(),
      }

      const configWithKey: Config = {
        ...config,
        providers: [providerWithKey],
        defaultModelSelection: 'provider-key/deepseek-chat',
        llm: {
          ...config.llm,
          baseUrl: 'https://api.deepseek.com/v1',
        },
      }

      createProviderManager(configWithKey)

      const { createLLMClient } = await import('./llm/index.js')
      const calls = (createLLMClient as ReturnType<typeof vi.fn>).mock.calls
      expect(calls.length).toBeGreaterThanOrEqual(2)
      const lastCallConfig = calls[calls.length - 1]![0] as { llm: { apiKey?: string } }
      expect(lastCallConfig.llm.apiKey).toBe('sk-my-secret-key')
    })

    it('still works when active provider has no apiKey', async () => {
      const providerNoKey: Provider = {
        id: 'provider-nokey',
        name: 'No Key Provider',
        url: 'http://localhost:8000',
        backend: 'vllm',
        apiKey: undefined,
        models: [{ id: 'model-a', contextWindow: 200000, source: 'default' }],
        isActive: true,
        createdAt: new Date().toISOString(),
      }

      const configNoKey: Config = {
        ...config,
        providers: [providerNoKey],
        defaultModelSelection: 'provider-nokey/model-a',
      }

      expect(() => createProviderManager(configNoKey)).not.toThrow()
    })
  })

  describe('thinkingField resolution', () => {
    it('derives thinkingField from the provider URL when config lacks it (DeepSeek rescue)', async () => {
      const deepseekProvider: Provider = {
        id: 'provider-deepseek',
        name: 'DeepSeek API',
        url: 'https://api.deepseek.com',
        backend: 'unknown',
        apiKey: 'sk-x',
        models: [{ id: 'deepseek-v4-flash', contextWindow: 1000000, source: 'default' }],
        isActive: true,
        createdAt: new Date().toISOString(),
      }

      const dsConfig: Config = {
        ...config,
        providers: [deepseekProvider],
        defaultModelSelection: 'provider-deepseek/deepseek-v4-flash',
      }

      const manager = createProviderManager(dsConfig)
      manager.createClient('provider-deepseek', 'deepseek-v4-flash')

      const calls = (createLLMClient as ReturnType<typeof vi.fn>).mock.calls
      const lastCallConfig = calls[calls.length - 1]![0] as { llm: { thinkingField?: string } }
      expect(lastCallConfig.llm.thinkingField).toBe('reasoning_content')
    })

    it('lets an explicit provider thinkingField override the URL default', async () => {
      const deepseekProvider: Provider = {
        id: 'provider-deepseek',
        name: 'DeepSeek API',
        url: 'https://api.deepseek.com',
        backend: 'unknown',
        apiKey: 'sk-x',
        thinkingField: 'custom_field',
        models: [{ id: 'deepseek-v4-flash', contextWindow: 1000000, source: 'default' }],
        isActive: true,
        createdAt: new Date().toISOString(),
      }

      const dsConfig: Config = {
        ...config,
        providers: [deepseekProvider],
        defaultModelSelection: 'provider-deepseek/deepseek-v4-flash',
      }

      const manager = createProviderManager(dsConfig)
      manager.createClient('provider-deepseek', 'deepseek-v4-flash')

      const calls = (createLLMClient as ReturnType<typeof vi.fn>).mock.calls
      const lastCallConfig = calls[calls.length - 1]![0] as { llm: { thinkingField?: string } }
      expect(lastCallConfig.llm.thinkingField).toBe('custom_field')
    })

    it('leaves thinkingField undefined for providers without a URL default', async () => {
      const localProvider: Provider = {
        id: 'provider-local',
        name: 'Local',
        url: 'http://192.168.1.223:8000',
        backend: 'vllm',
        models: [{ id: 'deepseek-v4-flash', contextWindow: 1000000, source: 'default' }],
        isActive: true,
        createdAt: new Date().toISOString(),
      }

      const localConfig: Config = {
        ...config,
        providers: [localProvider],
        defaultModelSelection: 'provider-local/deepseek-v4-flash',
      }

      const manager = createProviderManager(localConfig)
      manager.createClient('provider-local', 'deepseek-v4-flash')

      const calls = (createLLMClient as ReturnType<typeof vi.fn>).mock.calls
      const lastCallConfig = calls[calls.length - 1]![0] as { llm: { thinkingField?: string } }
      expect(lastCallConfig.llm.thinkingField).toBeUndefined()
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

    it('rebinds the LLM client when updating the model for the active provider', async () => {
      const createCallsBefore = createLLMClientMock.mock.calls.length

      await providerManager.setDefaultModelSelection('provider-1', 'new-model')

      const createCallsAfter = createLLMClientMock.mock.calls.slice(createCallsBefore)
      expect(createCallsAfter.length).toBeGreaterThan(0)
      const lastCallConfig = createCallsAfter[createCallsAfter.length - 1]![0] as {
        llm: { baseUrl?: string; model?: string }
      }
      expect(lastCallConfig.llm.baseUrl).toBe('http://localhost:8000/v1')
      expect(lastCallConfig.llm.model).toBe('new-model')
    })

    it('updates active provider when changing to different provider', async () => {
      await providerManager.setDefaultModelSelection('provider-2', 'new-model')

      expect(providerManager.getActiveProviderId()).toBe('provider-2')
      expect(providerManager.getCurrentModel()).toBe('new-model')

      const providers = providerManager.getProviders()
      expect(providers.find((p) => p.id === 'provider-2')?.isActive).toBe(true)
      expect(providers.find((p) => p.id === 'provider-1')?.isActive).toBe(false)
    })

    it('rebinds the live LLM client when switching to a different provider', async () => {
      const createCallsBefore = createLLMClientMock.mock.calls.length

      await providerManager.setDefaultModelSelection('provider-2', 'new-model')

      // Switching the default to another provider must recreate the live client bound to
      // that provider's endpoint — otherwise bookkeeping claims the new provider while
      // traffic still hits the previously activated one.
      const createCallsAfter = createLLMClientMock.mock.calls.slice(createCallsBefore)
      expect(createCallsAfter.length).toBeGreaterThan(0)
      const lastCallConfig = createCallsAfter[createCallsAfter.length - 1]![0] as {
        llm: { baseUrl?: string; model?: string }
      }
      expect(lastCallConfig.llm.baseUrl).toBe('http://localhost:9000/v1')
      expect(lastCallConfig.llm.model).toBe('new-model')
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

    it('getDefaultModelSelection stays the config default after runtime activation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'model-x' }] }),
      })

      // Config default is provider-1/model-a
      expect(providerManager.getDefaultModelSelection()).toBe('provider-1/model-a')

      // Runtime activation switches the ACTIVE selection...
      await providerManager.activateProvider('provider-2', { model: 'model-x' })
      expect(providerManager.getActiveProviderId()).toBe('provider-2')

      // ...but the config-derived default must not change — the default tier of
      // the effective-model resolution comes from config, never active state.
      expect(providerManager.getDefaultModelSelection()).toBe('provider-1/model-a')
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
      const model = providers.find((p) => p.id === 'provider-1')?.models.find((m) => m.id === 'model-a')
      expect(model?.contextWindow).toBe(100000)
      expect(model?.source).toBe('user')
    })

    it('adds new model if not found', async () => {
      const result = await providerManager.updateModelContext('provider-1', 'new-model', 150000)

      expect(result).toEqual({ success: true })

      const providers = providerManager.getProviders()
      const model = providers.find((p) => p.id === 'provider-1')?.models.find((m) => m.id === 'new-model')
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
      const models = providers.find((p) => p.id === 'provider-1')?.models
      expect(models).toEqual([
        { id: 'model-x', contextWindow: 128000, source: 'backend' },
        { id: 'model-y', contextWindow: 256000, source: 'backend' },
      ])
    })

    it('drops stale user models for an authoritative transport catalog', async () => {
      const transport = {
        id: 'example-transport',
        listModels: vi.fn(async () => [
          { id: 'catalog-a', contextWindow: 1050000, source: 'backend' as const },
          { id: 'catalog-b', contextWindow: 1050000, source: 'backend' as const },
        ]),
        complete: vi.fn(),
        stream: vi.fn(),
      }
      const adapters = { getTransport: vi.fn((id?: string) => (id === 'example-transport' ? transport : undefined)) }
      const chatConfig: Config = {
        ...config,
        providers: [
          {
            id: 'external',
            name: 'External Provider',
            url: 'https://provider.example/v1',
            backend: 'openai',
            transportAdapter: 'example-transport',
            models: [
              { id: 'model-large', contextWindow: 1050000, source: 'user' },
              { id: 'catalog-a', contextWindow: 900000, source: 'user' },
            ],
            isActive: true,
            createdAt: new Date().toISOString(),
          },
        ],
        defaultModelSelection: 'external/catalog-a',
      }
      const manager = createProviderManager(chatConfig, { adapters: adapters as never })

      const result = await manager.refreshProviderModels('external')

      expect(result).toEqual({ success: true })
      const models = manager.getProviders()[0]!.models
      expect(models.map((model) => model.id)).toEqual(['catalog-a', 'catalog-b'])
      expect(models[0]!.contextWindow).toBe(900000)
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
      const models = providers.find((p) => p.id === 'provider-1')?.models
      const modelA = models?.find((m) => m.id === 'model-a')
      expect(modelA?.contextWindow).toBe(150000)
      expect(modelA?.source).toBe('user')
    })

    it('hides catalog variants claimed by a merged mode-chip user model', async () => {
      // Simulate a user who merged three suffixed catalog variants into a
      // single mode-chip model. On refresh, the raw catalog (still exposing the
      // suffixed variants) must not reintroduce them alongside the merged one.
      const mergedConfig: Config = {
        ...config,
        providers: [
          {
            id: 'omni',
            name: 'OmniRoute',
            url: 'http://localhost:9100',
            backend: 'openai',
            models: [
              {
                id: 'antigravity/gemini-3.6-flash',
                contextWindow: 1048576,
                source: 'user',
                modes: [
                  { level: 'low', apiModelId: 'antigravity/gemini-3.6-flash-low' },
                  { level: 'medium', apiModelId: 'antigravity/gemini-3.6-flash-medium' },
                  { level: 'high', apiModelId: 'antigravity/gemini-3.6-flash-high' },
                ],
              },
            ],
            isActive: true,
            createdAt: new Date().toISOString(),
          },
        ],
      }
      const manager = createProviderManager(mergedConfig)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'antigravity/gemini-3.6-flash-low', max_model_len: 1048576 },
            { id: 'antigravity/gemini-3.6-flash-medium', max_model_len: 1048576 },
            { id: 'antigravity/gemini-3.6-flash-high', max_model_len: 1048576 },
            { id: 'antigravity/other-model', max_model_len: 200000 },
          ],
        }),
      })

      const result = await manager.refreshProviderModels('omni')

      expect(result).toEqual({ success: true })
      const models = manager.getProviders().find((p) => p.id === 'omni')?.models ?? []
      const ids = models.map((m) => m.id).sort()
      expect(ids).toEqual(['antigravity/gemini-3.6-flash', 'antigravity/other-model'])
      const merged = models.find((m) => m.id === 'antigravity/gemini-3.6-flash')
      expect(merged?.modes?.length).toBe(3)
    })

    it('returns error when backend returns no models', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      })

      const result = await providerManager.refreshProviderModels('provider-1')

      expect(result).toEqual({ success: false, error: 'No models returned from backend' })
    })

    it('preserves user models and stays unknown when backend returns empty', async () => {
      // model-a becomes a user model after updateModelSettings
      await providerManager.updateModelSettings('provider-1', 'model-a', { temperature: 0.5 })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      })

      const result = await providerManager.refreshProviderModels('provider-1')
      expect(result).toEqual({ success: true })

      const provider = providerManager.getProviders().find((p) => p.id === 'provider-1')
      expect(provider?.status).toBe('unknown')
      expect(provider?.models.map((m) => m.id)).toContain('model-a')
    })

    it('fetches OpenCode Go models from /zen/go/v1/models', async () => {
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
        'https://opencode.ai/zen/go/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
        }),
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

  describe('getModelSettings', () => {
    it('returns undefined for non-existent provider', () => {
      const settings = providerManager.getModelSettings('non-existent', 'model-a')
      expect(settings).toBeUndefined()
    })

    it('returns undefined for non-existent model on existing provider', () => {
      const settings = providerManager.getModelSettings('provider-1', 'non-existent')
      expect(settings).toBeUndefined()
    })

    it('returns model settings with default thinking mode', async () => {
      await providerManager.updateModelSettings('provider-1', 'model-a', {
        temperature: 0.5,
        topP: 0.9,
        maxTokens: 4096,
        thinkingEnabled: true,
        thinkingLevel: 'high',
        thinkingExtraKwargs: '{"enable_thinking": true}',
      })

      const settings = providerManager.getModelSettings('provider-1', 'model-a')
      expect(settings).toBeDefined()
      expect(settings?.temperature).toBe(0.5)
      expect(settings?.topP).toBe(0.9)
      expect(settings?.maxTokens).toBe(4096)
      expect(settings?.chatTemplateKwargs).toEqual({ enable_thinking: true })
    })

    it('uses thinking kwargs in thinking mode when thinkingEnabled', async () => {
      await providerManager.updateModelSettings('provider-1', 'model-a', {
        thinkingEnabled: true,
        thinkingExtraKwargs: '{"enable_thinking": true}',
        nonThinkingEnabled: true,
        nonThinkingExtraKwargs: '{"enable_thinking": false}',
      })

      const settings = providerManager.getModelSettings('provider-1', 'model-a', 'thinking')
      expect(settings?.chatTemplateKwargs).toEqual({ enable_thinking: true })
    })

    it('does not inject chat_template_kwargs for an openai backend provider', async () => {
      const openaiManager = createProviderManager({
        providers: [
          {
            id: 'openai-p',
            name: 'OpenAI',
            url: 'https://api.openai.com/v1',
            backend: 'openai',
            apiKey: undefined,
            models: [
              {
                id: 'gpt-4.1-mini',
                contextWindow: 200000,
                source: 'user' as const,
                thinkingEnabled: true,
                thinkingLevel: 'high',
              },
            ],
            isActive: true,
            createdAt: new Date().toISOString(),
          },
        ],
        defaultModelSelection: 'openai-p/gpt-4.1-mini',
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        llm: {
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4.1-mini',
          timeout: 120000,
          idleTimeout: 30000,
          backend: 'openai',
        },
        context: { maxTokens: 4096, compactionThreshold: 10000, compactionTarget: 8000 },
        agent: { maxIterations: 100, maxConsecutiveFailures: 5, toolTimeout: 30000 },
        workdir: process.cwd(),
      })

      const settings = openaiManager.getModelSettings('openai-p', 'gpt-4.1-mini', 'thinking')
      expect(settings?.chatTemplateKwargs).toBeUndefined()
    })

    it('uses non-thinking kwargs in non-thinking mode when nonThinkingEnabled', async () => {
      await providerManager.updateModelSettings('provider-1', 'model-a', {
        thinkingEnabled: true,
        thinkingExtraKwargs: '{"enable_thinking": true}',
        nonThinkingEnabled: true,
        nonThinkingExtraKwargs: '{"enable_thinking": false}',
      })

      const settings = providerManager.getModelSettings('provider-1', 'model-a', 'non-thinking')
      expect(settings?.chatTemplateKwargs).toEqual({ enable_thinking: false })
    })

    it('falls back to thinking queryParams in non-thinking mode when nonThinkingEnabled is false', async () => {
      await providerManager.updateModelSettings('provider-1', 'model-a', {
        thinkingEnabled: true,
        thinkingQueryParams: '{"reasoning_effort":"high"}',
        nonThinkingEnabled: false,
      })

      const settings = providerManager.getModelSettings('provider-1', 'model-a', 'non-thinking')
      expect(settings?.queryParams).toEqual({ reasoning_effort: 'high' })
    })

    it('falls back to non-thinking queryParams in thinking mode when thinkingEnabled is false', async () => {
      await providerManager.updateModelSettings('provider-1', 'model-a', {
        thinkingEnabled: false,
        nonThinkingEnabled: true,
        nonThinkingQueryParams: '{"reasoning_effort":"none"}',
      })

      const settings = providerManager.getModelSettings('provider-1', 'model-a', 'thinking')
      expect(settings?.queryParams).toEqual({ reasoning_effort: 'none' })
    })

    it('returns undefined when model exists on different provider', async () => {
      await providerManager.updateModelSettings('provider-2', 'model-b', {
        temperature: 0.3,
      })

      const settings = providerManager.getModelSettings('provider-1', 'model-b')
      expect(settings).toBeUndefined()
    })

    it('surfaces omitParams in modelSettings even without thinking config', async () => {
      await providerManager.updateModelSettings('provider-1', 'model-a', {
        omitParams: ['temperature'],
      })

      const settings = providerManager.getModelSettings('provider-1', 'model-a')
      expect(settings).toBeDefined()
      expect(settings?.omitParams).toEqual(['temperature'])
    })

    it('surfaces omitParams alongside queryParams', async () => {
      await providerManager.updateModelSettings('provider-1', 'model-a', {
        thinkingEnabled: true,
        thinkingQueryParams: '{"reasoning_effort":"high"}',
        omitParams: ['top_p'],
      })

      const settings = providerManager.getModelSettings('provider-1', 'model-a', 'thinking')
      expect(settings?.queryParams).toEqual({ reasoning_effort: 'high' })
      expect(settings?.omitParams).toEqual(['top_p'])
    })

    it('includes numCtx from the model context window', async () => {
      await providerManager.updateModelSettings('provider-1', 'model-a', {
        contextWindow: 32768,
      })

      const settings = providerManager.getModelSettings('provider-1', 'model-a')
      expect(settings?.numCtx).toBe(32768)
    })

    it('passes the full context window through for large auto-detected windows', async () => {
      await providerManager.updateModelSettings('provider-1', 'model-a', {
        contextWindow: 262144,
      })

      const settings = providerManager.getModelSettings('provider-1', 'model-a')
      expect(settings?.numCtx).toBe(262144)
    })

    it('omits numCtx when the context window is not a positive number', async () => {
      await providerManager.updateModelSettings('provider-1', 'model-a', {
        contextWindow: 0,
      })

      const settings = providerManager.getModelSettings('provider-1', 'model-a')
      expect(settings?.numCtx).toBeUndefined()
    })
  })

  describe('resolveModelEffort', () => {
    it('returns the model default effort from thinkingLevel when no explicit effort', async () => {
      await providerManager.updateModelSettings('provider-1', 'model-a', {
        thinkingEnabled: true,
        thinkingLevel: 'none',
        reasoningEfforts: ['none', 'high'],
      })

      expect(providerManager.resolveModelEffort('provider-1', 'model-a')).toBe('none')
    })

    it('an explicit none always wins, even against a high default', async () => {
      await providerManager.updateModelSettings('provider-1', 'model-a', {
        thinkingEnabled: true,
        thinkingLevel: 'high',
        reasoningEfforts: ['none', 'high'],
      })

      expect(providerManager.resolveModelEffort('provider-1', 'model-a', 'none')).toBe('none')
    })

    it('preserves selected status, requestBody, and modes when updating model settings', async () => {
      const pm = createProviderManager({
        ...config,
        providers: [
          {
            id: 'p-custom',
            name: 'Custom Provider',
            url: 'https://example.com/v1',
            backend: 'openai',
            models: [
              {
                id: 'custom-model',
                contextWindow: 128000,
                source: 'user',
                selected: true,
                requestBody: { custom_param: 123 },
                modes: [
                  { level: 'low', apiModelId: 'custom-model-low' },
                  { level: 'high', apiModelId: 'custom-model-high' },
                ],
              },
            ],
            isActive: true,
            createdAt: new Date().toISOString(),
          },
        ],
      })

      const res = await pm.updateModelSettings('p-custom', 'custom-model', {
        thinkingEnabled: true,
        thinkingLevel: 'low',
      })

      expect(res.success).toBe(true)
      expect(res.model?.selected).toBe(true)
      expect(res.model?.requestBody).toEqual({ custom_param: 123 })
      expect(res.model?.modes?.length).toBe(2)

      const provider = pm.getProviders().find((p) => p.id === 'p-custom')
      const updated = provider?.models.find((m) => m.id === 'custom-model')
      expect(updated?.selected).toBe(true)
      expect(updated?.requestBody).toEqual({ custom_param: 123 })
      expect(updated?.modes?.length).toBe(2)
      expect(updated?.thinkingLevel).toBe('low')
    })

    it('an explicit in-list effort wins over the model default', async () => {
      await providerManager.updateModelSettings('provider-1', 'model-a', {
        thinkingEnabled: true,
        thinkingLevel: 'none',
        reasoningEfforts: ['none', 'high'],
      })

      expect(providerManager.resolveModelEffort('provider-1', 'model-a', 'high')).toBe('high')
    })

    it('clamps an out-of-list explicit effort to the model default', async () => {
      await providerManager.updateModelSettings('provider-1', 'model-a', {
        thinkingEnabled: true,
        thinkingLevel: 'high',
        reasoningEfforts: ['none', 'high'],
      })

      expect(providerManager.resolveModelEffort('provider-1', 'model-a', 'xhigh')).toBe('high')
    })

    it('returns undefined for models without thinking config', () => {
      expect(providerManager.resolveModelEffort('provider-1', 'model-a')).toBeUndefined()
    })

    it('returns undefined for unknown provider or model', () => {
      expect(providerManager.resolveModelEffort('non-existent', 'model-a')).toBeUndefined()
      expect(providerManager.resolveModelEffort('provider-1', 'non-existent')).toBeUndefined()
    })
  })

  describe('automatic model resolution', () => {
    it('exposes the same concrete resolution for all callers', () => {
      const chatConfig: Config = {
        ...config,
        providers: [
          {
            id: 'external',
            name: 'External Provider',
            url: 'https://provider.example/v1',
            backend: 'openai',
            models: [{ id: 'model-large', contextWindow: 1050000, source: 'backend', selected: true }],
            isActive: true,
            createdAt: new Date().toISOString(),
          },
        ],
        defaultModelSelection: 'external/auto',
      }
      const manager = createProviderManager(chatConfig)

      expect(manager.resolveModel('external', 'auto')).toBe('model-large')
    })

    it('resolves auto to the active concrete model for session clients', async () => {
      const chatConfig: Config = {
        ...config,
        providers: [
          {
            id: 'external',
            name: 'External Provider',
            url: 'https://provider.example/v1',
            backend: 'openai',
            models: [{ id: 'model-large', contextWindow: 1050000, source: 'backend' }],
            isActive: true,
            createdAt: new Date().toISOString(),
          },
        ],
        defaultModelSelection: 'external/model-large',
      }
      const manager = createProviderManager(chatConfig)

      manager.createClient('external', 'auto')

      expect(createLLMClientMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ llm: expect.objectContaining({ model: 'model-large' }) }),
        'openai',
      )
    })

    it('resolves auto to the selected model before falling back to the first model', () => {
      const chatConfig: Config = {
        ...config,
        providers: [
          {
            id: 'external',
            name: 'External Provider',
            url: 'https://provider.example/v1',
            backend: 'openai',
            models: [{ id: 'model-large', contextWindow: 1050000, source: 'backend', selected: true }],
            isActive: false,
            createdAt: new Date().toISOString(),
          },
        ],
        defaultModelSelection: undefined,
      }
      const manager = createProviderManager(chatConfig)

      manager.createClient('external', 'auto')

      expect(createLLMClientMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ llm: expect.objectContaining({ model: 'model-large' }) }),
        'openai',
      )
    })

    it('resolves an active auto selection to the provider first model instead of sending auto', () => {
      const chatConfig: Config = {
        ...config,
        providers: [
          {
            id: 'external',
            name: 'External Provider',
            url: 'https://provider.example/v1',
            backend: 'openai',
            models: [
              { id: 'model-large', contextWindow: 1050000, source: 'backend' },
              { id: 'catalog-a', contextWindow: 1050000, source: 'backend' },
            ],
            isActive: true,
            createdAt: new Date().toISOString(),
          },
        ],
        defaultModelSelection: 'external/auto',
      }
      const manager = createProviderManager(chatConfig)

      manager.createClient('external', 'auto')

      expect(createLLMClientMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ llm: expect.objectContaining({ model: 'model-large' }) }),
        'openai',
      )
    })
  })

  describe('setProviders', () => {
    it('recreates the active transport client when credentialRef is added', () => {
      const transport = {
        id: 'example-transport',
        listModels: vi.fn(),
        complete: vi.fn(),
        stream: vi.fn(),
      }
      const adapters = { getTransport: vi.fn((id?: string) => (id === 'example-transport' ? transport : undefined)) }
      const chatConfig: Config = {
        ...config,
        providers: [
          {
            id: 'external',
            name: 'External Provider',
            url: 'https://provider.example/v1',
            backend: 'openai',
            authAdapter: 'example-auth',
            transportAdapter: 'example-transport',
            models: [{ id: 'model-large', contextWindow: 1050000, source: 'backend' }],
            isActive: true,
            createdAt: new Date().toISOString(),
          },
        ],
        defaultModelSelection: 'external/model-large',
      }
      const manager = createProviderManager(chatConfig, { adapters: adapters as never })
      const before = manager.getLLMClient()

      manager.setProviders(
        [{ ...chatConfig.providers![0]!, credentialRef: 'credential-1' }],
        chatConfig.defaultModelSelection,
      )

      expect(manager.getLLMClient()).not.toBe(before)
    })
  })

  describe('catalog enrichment in getProviders', () => {
    function buildManager(providers: Provider[]) {
      return createProviderManager({
        providers,
        defaultModelSelection: 'p/deepseek-v4-flash',
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        llm: {
          baseUrl: 'http://localhost:8000/v1',
          model: 'deepseek-v4-flash',
          timeout: 120000,
          idleTimeout: 30000,
          backend: 'vllm',
        },
        context: { maxTokens: 4096, compactionThreshold: 10000, compactionTarget: 8000 },
        agent: { maxIterations: 100, maxConsecutiveFailures: 5, toolTimeout: 30000 },
        workdir: process.cwd(),
      })
    }

    it('fills reasoningEfforts from the catalog for known models that lack them', () => {
      const manager = buildManager([
        {
          id: 'p',
          name: 'Local',
          url: 'http://localhost:8000/v1',
          backend: 'vllm',
          models: [{ id: 'deepseek-v4-flash', contextWindow: 1_000_000, source: 'default' as const }],
          isActive: true,
          createdAt: new Date().toISOString(),
        },
      ])

      const model = manager.getProviders()[0]!.models[0]!
      expect(model.reasoningEfforts).toEqual(['none', 'low', 'high', 'max'])
    })

    it('never overrides an existing reasoningEfforts list', () => {
      const manager = buildManager([
        {
          id: 'p',
          name: 'Local',
          url: 'http://localhost:8000/v1',
          backend: 'vllm',
          models: [
            {
              id: 'deepseek-v4-flash',
              contextWindow: 1_000_000,
              source: 'default' as const,
              reasoningEfforts: ['low', 'high'],
            },
          ],
          isActive: true,
          createdAt: new Date().toISOString(),
        },
      ])

      expect(manager.getProviders()[0]!.models[0]!.reasoningEfforts).toEqual(['low', 'high'])
    })

    it('preserves an explicitly-empty reasoningEfforts list (user cleared all presets)', () => {
      const manager = buildManager([
        {
          id: 'p',
          name: 'Local',
          url: 'http://localhost:8000/v1',
          backend: 'vllm',
          models: [
            {
              id: 'deepseek-v4-flash',
              contextWindow: 1_000_000,
              source: 'default' as const,
              reasoningEfforts: [],
            },
          ],
          isActive: true,
          createdAt: new Date().toISOString(),
        },
      ])

      // An explicit empty list means "no chips" — the catalog must not refill it.
      expect(manager.getProviders()[0]!.models[0]!.reasoningEfforts).toEqual([])
    })

    it('leaves unknown models untouched', () => {
      const manager = buildManager([
        {
          id: 'p',
          name: 'Local',
          url: 'http://localhost:8000/v1',
          backend: 'vllm',
          models: [{ id: 'some-unknown-model', contextWindow: 1000, source: 'default' as const }],
          isActive: true,
          createdAt: new Date().toISOString(),
        },
      ])

      expect(manager.getProviders()[0]!.models[0]!.reasoningEfforts).toBeUndefined()
    })
  })

  describe('reasoning effort resolution (model presets + override)', () => {
    function buildManager(providers: Provider[]) {
      return createProviderManager({
        providers,
        defaultModelSelection: 'p/model-a',
        server: { port: 10369, host: '127.0.0.1', openBrowser: true },
        logging: { level: 'info' as const },
        database: { path: '' },
        llm: {
          baseUrl: 'http://localhost:8000/v1',
          model: 'model-a',
          timeout: 120000,
          idleTimeout: 30000,
          backend: 'vllm',
        },
        context: { maxTokens: 4096, compactionThreshold: 10000, compactionTarget: 8000 },
        agent: { maxIterations: 100, maxConsecutiveFailures: 5, toolTimeout: 30000 },
        workdir: process.cwd(),
      })
    }

    function providerWith(models: Provider['models']): Provider {
      return {
        id: 'p',
        name: 'Local',
        url: 'http://localhost:8000/v1',
        backend: 'vllm',
        models,
        isActive: true,
        createdAt: new Date().toISOString(),
      }
    }

    it('passes an in-list session effort through', () => {
      const manager = buildManager([
        providerWith([
          { id: 'model-a', contextWindow: 100000, source: 'default' as const, reasoningEfforts: ['low', 'high'] },
        ]),
      ])
      manager.createClient('p', 'model-a', 'low')
      const config = createLLMClientMock.mock.calls.at(-1)![0]!
      expect(config.llm.reasoningEffort).toBe('low')
    })

    it('clamps an out-of-list session effort to the model default', () => {
      const manager = buildManager([
        providerWith([
          {
            id: 'model-a',
            contextWindow: 100000,
            source: 'default' as const,
            reasoningEfforts: ['low', 'high'],
            thinkingEnabled: true,
            thinkingLevel: 'high',
          },
        ]),
      ])
      manager.createClient('p', 'model-a', 'medium')
      const config = createLLMClientMock.mock.calls.at(-1)![0]!
      expect(config.llm.reasoningEffort).toBe('high')
    })

    it('uses the reasoningEffortOverride as the default and never clamps it', () => {
      const manager = buildManager([
        providerWith([
          {
            id: 'model-a',
            contextWindow: 100000,
            source: 'default' as const,
            reasoningEfforts: ['low', 'high'],
            reasoningEffortOverride: 'deep',
          },
        ]),
      ])
      manager.createClient('p', 'model-a')
      const config = createLLMClientMock.mock.calls.at(-1)![0]!
      expect(config.llm.reasoningEffort).toBe('deep')
    })

    it('sends no effort for a preset list with no default and no explicit effort', () => {
      const manager = buildManager([
        providerWith([
          { id: 'model-a', contextWindow: 100000, source: 'default' as const, reasoningEfforts: ['low', 'high'] },
        ]),
      ])
      manager.createClient('p', 'model-a')
      const config = createLLMClientMock.mock.calls.at(-1)![0]!
      expect(config.llm.reasoningEffort).toBeUndefined()
    })

    it('keeps the model default when no preset list is advertised', () => {
      const manager = buildManager([
        providerWith([
          {
            id: 'model-a',
            contextWindow: 100000,
            source: 'default' as const,
            thinkingEnabled: true,
            thinkingLevel: 'medium',
          },
        ]),
      ])
      manager.createClient('p', 'model-a')
      const config = createLLMClientMock.mock.calls.at(-1)![0]!
      expect(config.llm.reasoningEffort).toBe('medium')
    })

    it('passes the provider backend to createLLMClient (session clients must not default to unknown)', () => {
      const manager = buildManager([
        providerWith([{ id: 'model-a', contextWindow: 100000, source: 'default' as const }]),
        {
          id: 'llama',
          name: 'Llama',
          url: 'http://localhost:8000/v1',
          backend: 'llamacpp',
          models: [{ id: 'model-b', contextWindow: 100000, source: 'default' as const }],
          isActive: false,
          createdAt: new Date().toISOString(),
        },
      ])
      manager.createClient('p', 'model-a')
      expect(createLLMClientMock.mock.calls.at(-1)).toEqual([
        expect.objectContaining({ llm: expect.objectContaining({ model: 'model-a' }) }),
        'vllm',
      ])
      manager.createClient('llama', 'model-b')
      expect(createLLMClientMock.mock.calls.at(-1)).toEqual([
        expect.objectContaining({ llm: expect.objectContaining({ model: 'model-b' }) }),
        'llamacpp',
      ])
    })

    it('persists reasoningEfforts and reasoningEffortOverride via updateModelSettings', async () => {
      const manager = buildManager([
        providerWith([{ id: 'model-a', contextWindow: 100000, source: 'default' as const }]),
      ])
      const result = await manager.updateModelSettings('p', 'model-a', {
        reasoningEfforts: ['low', 'medium'],
        reasoningEffortOverride: 'deep',
      })
      expect(result.success).toBe(true)
      expect(result.model?.reasoningEfforts).toEqual(['low', 'medium'])
      expect(result.model?.reasoningEffortOverride).toBe('deep')
      const stored = manager.getProviders()[0]!.models.find((m) => m.id === 'model-a')!
      expect(stored.reasoningEfforts).toEqual(['low', 'medium'])
      expect(stored.reasoningEffortOverride).toBe('deep')
    })

    it('catalog enrichment never overrides a stored preset list or override', () => {
      const manager = buildManager([
        providerWith([
          {
            id: 'deepseek-v4-flash',
            contextWindow: 1_000_000,
            source: 'default' as const,
            reasoningEfforts: ['low'],
            reasoningEffortOverride: 'deep',
          },
        ]),
      ])
      const model = manager.getProviders()[0]!.models[0]!
      expect(model.reasoningEfforts).toEqual(['low'])
      expect(model.reasoningEffortOverride).toBe('deep')
    })
  })
})

describe('fetchModelsWithContext - Ollama vision detection', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('detects vision via vision_start_token_id', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'llava' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ model_info: { vision_start_token_id: 32000 } }),
      })
    const models = await fetchModelsWithContext('http://localhost:11434', undefined, 'ollama')
    expect(models[0]?.supportsVision).toBe(true)
  })

  it('detects vision via clip.vision_projection metadata key', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'llava2' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ model_info: { 'clip.vision_projection': { type: 'tensor' } } }),
      })
    const models = await fetchModelsWithContext('http://localhost:11434', undefined, 'ollama')
    expect(models[0]?.supportsVision).toBe(true)
  })

  it('does not flag a text-only model as vision', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'qwen3' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ model_info: { 'general.architecture': 'qwen3' } }),
      })
    const models = await fetchModelsWithContext('http://localhost:11434', undefined, 'ollama')
    expect(models[0]?.supportsVision).toBeUndefined()
  })
})

describe('ProviderManager - unknown backend URL detection', () => {
  function buildManager(providers: Provider[]) {
    return createProviderManager({
      providers,
      defaultModelSelection: 'p/model-a',
      server: { port: 10369, host: '127.0.0.1', openBrowser: true },
      logging: { level: 'info' as const },
      database: { path: '' },
      llm: {
        baseUrl: 'http://localhost:8000/v1',
        model: 'model-a',
        timeout: 120000,
        idleTimeout: 30000,
        backend: 'vllm',
      },
      context: { maxTokens: 4096, compactionThreshold: 10000, compactionTarget: 8000 },
      agent: { maxIterations: 100, maxConsecutiveFailures: 5, toolTimeout: 30000 },
      workdir: process.cwd(),
    })
  }

  function openAIProvider(backend: Provider['backend'], url = 'https://api.openai.com/v1'): Provider {
    return {
      id: 'p',
      name: 'OpenAI',
      url,
      backend,
      models: [{ id: 'gpt-4.1-mini', contextWindow: 200000, source: 'default' as const }],
      isActive: true,
      createdAt: new Date().toISOString(),
    }
  }

  it('resolves an unknown backend to openai for api.openai.com URLs', () => {
    const manager = buildManager([openAIProvider('unknown')])
    manager.createClient('p', 'gpt-4.1-mini')
    const config = createLLMClientMock.mock.calls.at(-1)![0]!
    expect(config.llm.backend).toBe('openai')
  })

  it('leaves an explicit backend untouched even for api.openai.com', () => {
    const manager = buildManager([openAIProvider('vllm')])
    manager.createClient('p', 'gpt-4.1-mini')
    const config = createLLMClientMock.mock.calls.at(-1)![0]!
    expect(config.llm.backend).toBe('vllm')
  })

  it('keeps unknown when the URL host is not recognized', () => {
    const manager = buildManager([openAIProvider('unknown', 'https://my-vllm.example.com/v1')])
    manager.createClient('p', 'gpt-4.1-mini')
    const config = createLLMClientMock.mock.calls.at(-1)![0]!
    expect(config.llm.backend).toBe('unknown')
  })
})
