import type { Provider, Config, LlmBackend, ModelConfig } from '../shared/types.js'
import { createLLMClient, detectBackend, detectModel, clearModelCache, setLlmStatus, type LLMClientWithModel } from './llm/index.js'
import { logger } from './utils/logger.js'

function normalizeModelId(s: string): string {
  return s.toLowerCase().replace(/[-_\s:.]+/g, '')
}

async function fetchModelsFromBackend(
  url: string,
  apiKey?: string,
): Promise<{ id: string; contextWindow: number | undefined }[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  try {
    const response = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(10000) })
    if (!response.ok) {
      logger.debug('Failed to fetch models', { url, status: response.status })
      return []
    }
    const data = await response.json() as { data?: { id: string; max_model_len?: number }[] }
    if (data.data && Array.isArray(data.data)) {
      return data.data.map(m => ({
        id: m.id,
        contextWindow: m.max_model_len ?? undefined,
      }))
    }
    return []
  } catch (error) {
    logger.debug('Error fetching models', { url, error: error instanceof Error ? error.message : String(error) })
    return []
  }
}

function mergeModelsWithUserOverrides(backendModels: ModelConfig[], userModels: ModelConfig[]): ModelConfig[] {
  const normalizedUserIdMap = new Map(userModels.map(m => [normalizeModelId(m.id), m]))

  const updatedModels = backendModels.map(backendModel => {
    const existingUserModel = normalizedUserIdMap.get(normalizeModelId(backendModel.id))
    if (existingUserModel) {
      return { ...existingUserModel, id: backendModel.id }
    }
    return backendModel
  })

  const normalizedBackendIds = new Set(backendModels.map(m => normalizeModelId(m.id)))
  for (const userModel of userModels) {
    if (!normalizedBackendIds.has(normalizeModelId(userModel.id))) {
      updatedModels.push(userModel)
    }
  }

  return updatedModels
}

export async function fetchAvailableModelsFromBackend(baseUrl: string, apiKey?: string): Promise<string[]> {
  const url = baseUrl.includes('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`
  const models = await fetchModelsFromBackend(url, apiKey)
  return models.map(m => m.id)
}

/** Fetch models with context window metadata */
export async function fetchModelsWithContext(baseUrl: string, apiKey?: string, backend?: 'ollama' | 'vllm' | 'sglang' | 'llamacpp' | 'unknown'): Promise<ModelConfig[]> {
  logger.info('fetchModelsWithContext called', { baseUrl, apiKey: !!apiKey, backend })

  // Ollama uses /api/show for context detection
  if (backend === 'ollama') {
    logger.info('Fetching Ollama models via /api/tags and /api/show')
    return fetchOllamaModelsWithContext(baseUrl, apiKey)
  }

  // OpenCode Go has models at /zen/v1/models not /zen/go/v1/models
  const isOpenCodeGo = baseUrl.includes('opencode.ai/zen/go')
  const url = isOpenCodeGo
    ? baseUrl.replace('/zen/go', '/zen').replace(/\/v1$/, '') + '/v1/models'
    : baseUrl.includes('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`

  logger.info('Fetching models via /v1/models', { url })
  const models = await fetchModelsFromBackend(url, apiKey)

  if (models.length === 0) return []

  logger.info('Fetched models from /v1/models', { count: models.length })
  return models.map(m => ({
    id: m.id,
    contextWindow: m.contextWindow ?? 200000,
    source: m.contextWindow ? 'backend' : 'default' as const,
  }))
}

/** Fetch Ollama models with context windows via /api/show */
async function fetchOllamaModelsWithContext(baseUrl: string, apiKey?: string): Promise<ModelConfig[]> {
  // First get list of models from /api/tags
  const tagsUrl = `${baseUrl}/api/tags`
  
  try {
    const tagsResponse = await fetch(tagsUrl, {
      signal: AbortSignal.timeout(10000),
    })
    
    if (!tagsResponse.ok) {
      logger.debug('Failed to fetch Ollama tags', { url: tagsUrl })
      return []
    }
    
    const tagsData = await tagsResponse.json() as { models?: Array<{ name: string }> }
    if (!tagsData.models || !Array.isArray(tagsData.models)) {
      return []
    }
    
    // Fetch context info for each model via /api/show
    const modelsWithContext: ModelConfig[] = []
    for (const model of tagsData.models) {
      try {
        const showUrl = `${baseUrl}/api/show`
        const showResponse = await fetch(showUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: model.name, verbose: true }),
          signal: AbortSignal.timeout(5000),
        })
        
        if (showResponse.ok) {
          const showData = await showResponse.json() as { 
            model_info?: { 
              llama?: { context_length?: number }
              context_length?: number
            }
          }
          
          const contextLength = showData.model_info?.llama?.context_length ?? showData.model_info?.context_length ?? 200000
          modelsWithContext.push({
            id: model.name,
            contextWindow: contextLength,
            source: contextLength !== 200000 ? 'backend' : 'default' as const,
          })
        } else {
          // Fall back to default if /api/show fails
          modelsWithContext.push({
            id: model.name,
            contextWindow: 200000,
            source: 'default' as const,
          })
        }
      } catch (error) {
        logger.debug('Failed to fetch Ollama model context', { 
          model: model.name, 
          error: error instanceof Error ? error.message : String(error) 
        })
        // Fall back to default
        modelsWithContext.push({
          id: model.name,
          contextWindow: 200000,
          source: 'default' as const,
        })
      }
    }
    
    return modelsWithContext
  } catch (error) {
    logger.info('Error fetching Ollama models', { url: baseUrl, error: error instanceof Error ? error.message : String(error) })
    return []
  }
}

export interface ProviderManager {
  getProviders(): Provider[]
  getActiveProvider(): Provider | undefined
  getActiveProviderId(): string | undefined
  getCurrentModel(): string | undefined
  getCurrentModelContext(): number
  getLLMClient(): LLMClientWithModel
  activateProvider(providerId: string, options?: { model?: string }): Promise<{ success: boolean; error?: string }>
  addProvider(provider: Omit<Provider, 'id' | 'createdAt'>): Provider
  removeProvider(providerId: string): boolean
  setProviders(providers: Provider[], defaultModelSelection?: string): void
  getProviderStatus(providerId: string): 'connected' | 'disconnected' | 'unknown'
  getProviderModels(providerId: string): Promise<ModelConfig[]>
  setDefaultModelSelection(providerId: string, model: string): Promise<{ success: boolean; error?: string }>
  updateModelContext(providerId: string, modelId: string, contextWindow: number): Promise<{ success: boolean; error?: string }>
  refreshProviderModels(providerId: string): Promise<{ success: boolean; error?: string }>
}

export function parseDefaultModelSelection(selection?: string): { providerId: string | undefined; model: string | undefined } {
  if (!selection) return { providerId: undefined, model: undefined }
  const slashIndex = selection.indexOf('/')
  if (slashIndex === -1) return { providerId: selection, model: 'auto' }
  return {
    providerId: selection.substring(0, slashIndex),
    model: selection.substring(slashIndex + 1),
  }
}

export function createProviderManager(config: Config): ProviderManager {
  let providers: Provider[] = [...(config.providers ?? [])]
  let defaultModelSelection: string | undefined = config.defaultModelSelection
  let llmClient = createLLMClient(config)
  const providerStatus = new Map<string, 'connected' | 'disconnected' | 'unknown'>()
  
  logger.debug('ProviderManager created', { providers: providers.map(p => ({ id: p.id, models: p.models.map(m => ({ id: m.id, contextWindow: m.contextWindow, source: m.source })) })) })
  
  for (const p of providers) {
    providerStatus.set(p.id, 'unknown')
  }
  
  function createConfigForProvider(provider: Provider, model: string): Config {
    return {
      ...config,
      llm: {
        ...config.llm,
        baseUrl: provider.url.includes('/v1') ? provider.url : `${provider.url}/v1`,
        model,
        backend: provider.backend as LlmBackend | 'auto',
        ...(provider.apiKey && { apiKey: provider.apiKey }),
      },
    }
  }
  
  return {
    getProviders() {
      return [...providers]
    },
    
    getActiveProvider() {
      const { providerId } = parseDefaultModelSelection(defaultModelSelection)
      if (!providerId) return undefined
      return providers.find(p => p.id === providerId)
    },
    
    getActiveProviderId() {
      const { providerId } = parseDefaultModelSelection(defaultModelSelection)
      return providerId
    },
    
    getCurrentModel() {
      const { model } = parseDefaultModelSelection(defaultModelSelection)
      return model
    },
    
    getLLMClient() {
      return llmClient
    },
    
    async activateProvider(providerId: string, options?: { model?: string }) {
      const provider = providers.find(p => p.id === providerId)
      if (!provider) {
        return { success: false, error: 'Provider not found' }
      }

      const currentModel = parseDefaultModelSelection(defaultModelSelection).model ?? 'auto'
      const targetModel = options?.model ?? currentModel
      const isModelSwitch = providerId === parseDefaultModelSelection(defaultModelSelection).providerId && options?.model && options.model !== currentModel
      
      if (providerId === parseDefaultModelSelection(defaultModelSelection).providerId && !isModelSwitch) {
        return { success: true }
      }

      logger.info('Switching provider', {
        from: parseDefaultModelSelection(defaultModelSelection).providerId,
        to: providerId,
        providerName: provider.name,
        url: provider.url,
        model: targetModel,
      })

      const providerConfig = createConfigForProvider(provider, targetModel)
      const newClient = createLLMClient(providerConfig)

      try {
        const url = provider.url.includes('/v1') ? provider.url.replace('/v1', '') : provider.url
        clearModelCache(url)

        // Refetch models from backend when switching providers
        const backend = provider.backend as 'ollama' | 'vllm' | 'sglang' | 'llamacpp' | 'unknown'
        logger.info('activateProvider fetching models', { providerId, providerName: provider.name, url, backend })
        const modelsWithContext = await fetchModelsWithContext(url, provider.apiKey, backend)
        
        const userModels = provider.models.filter(m => m.source === 'user')
        logger.debug('activateProvider', { providerId, backendModelsCount: modelsWithContext.length, userModelsCount: userModels.length })
        
        if (modelsWithContext.length > 0) {
          const updatedModels = mergeModelsWithUserOverrides(modelsWithContext, userModels)
          providers = providers.map(p => p.id === providerId ? { ...p, models: updatedModels } : p)
        } else if (userModels.length > 0) {
          // Backend unavailable but we have user models - preserve them
          logger.debug('Backend unavailable during provider switch, preserving user models', { providerId, userModelsCount: userModels.length })
          providers = providers.map(p => p.id === providerId ? { ...p, models: userModels } : p)
        }

        if (provider.backend === 'auto') {
          const detected = await detectBackend(url)
          newClient.setBackend(detected)
        } else {
          newClient.setBackend(provider.backend as LlmBackend)
        }

        if (targetModel === 'auto') {
          const detected = await detectModel(url)
          if (detected) {
            newClient.setModel(detected)
          }
        } else {
          newClient.setModel(targetModel)
        }

        providerStatus.set(providerId, 'connected')
      } catch (err) {
        logger.warn('Could not connect to provider', {
          providerId,
          error: err instanceof Error ? err.message : String(err),
        })
        providerStatus.set(providerId, 'disconnected')
      }

      providers = providers.map(p => ({
        ...p,
        isActive: p.id === providerId,
      }))
      defaultModelSelection = `${providerId}/${targetModel}`
      llmClient = newClient

      logger.info('Provider activated', {
        providerId,
        providerName: provider.name,
        model: llmClient.getModel(),
        backend: llmClient.getBackend(),
      })

      return { success: true }
    },
    
    addProvider(providerData) {
      const id = crypto.randomUUID()
      const provider: Provider = {
        ...providerData,
        id,
        createdAt: new Date().toISOString(),
      }
      
      if (providerData.isActive || providers.length === 0) {
        providers = providers.map(p => ({ ...p, isActive: false }))
        provider.isActive = true
        defaultModelSelection = `${id}/auto`
      }
      
      providers.push(provider)
      providerStatus.set(id, 'unknown')
      
      return provider
    },
    
    removeProvider(providerId) {
      const index = providers.findIndex(p => p.id === providerId)
      if (index === -1) return false
      
      const wasActive = providers[index]?.isActive
      providers.splice(index, 1)
      providerStatus.delete(providerId)
      
      if (wasActive && providers.length > 0) {
        providers[0]!.isActive = true
        defaultModelSelection = `${providers[0]!.id}/auto`
      } else if (providers.length === 0) {
        defaultModelSelection = undefined
      }
      
      return true
    },
    
    setProviders(newProviders, newDefaultModelSelection) {
      const wasActiveProviderId = this.getActiveProviderId()
      
      providers = [...newProviders]
      defaultModelSelection = newDefaultModelSelection
      
      providerStatus.clear()
      for (const p of providers) {
        providerStatus.set(p.id, 'unknown')
      }
      
      // If the active provider changed, recreate the LLM client with the new provider's config
      const newActiveProviderId = this.getActiveProviderId()
      if (newActiveProviderId && newActiveProviderId !== wasActiveProviderId) {
        const activeProvider = providers.find(p => p.id === newActiveProviderId)
        if (activeProvider) {
          const providerConfig = createConfigForProvider(activeProvider, this.getCurrentModel() ?? 'auto')
          llmClient = createLLMClient(providerConfig)
          logger.info('setProviders: recreated LLM client for new active provider', {
            providerId: newActiveProviderId,
            url: activeProvider.url,
            hasApiKey: !!activeProvider.apiKey,
          })
        }
      }
    },
    
    getProviderStatus(providerId) {
      return providerStatus.get(providerId) ?? 'unknown'
    },

    async getProviderModels(providerId: string): Promise<ModelConfig[]> {
      const provider = providers.find(p => p.id === providerId)
      if (!provider) {
        return []
      }

      // Return stored models with context info
      if (provider.models && provider.models.length > 0) {
        return provider.models
      }

      // Fallback: fetch from backend if no stored models
      const url = provider.url.includes('/v1') ? provider.url.replace('/v1', '') : provider.url
      const backend = provider.backend as 'ollama' | 'vllm' | 'sglang' | 'llamacpp' | 'unknown'
      return fetchModelsWithContext(url, provider.apiKey, backend)
    },

    async setDefaultModelSelection(providerId: string, model: string) {
      const provider = providers.find(p => p.id === providerId)
      if (!provider) {
        return { success: false, error: 'Provider not found' }
      }

      logger.info('Setting default model selection', { providerId, model, providerName: provider.name })

      defaultModelSelection = `${providerId}/${model}`
      providers = providers.map(p => ({ ...p, isActive: p.id === providerId }))

      const currentProviderId = parseDefaultModelSelection(defaultModelSelection).providerId
      if (currentProviderId === providerId) {
        llmClient.setModel(model)
        logger.info('Model updated', { providerId, model })
      }

      return { success: true }
    },

    getCurrentModelContext(): number {
      const { providerId, model } = parseDefaultModelSelection(defaultModelSelection)
      if (!providerId || !model) return config.context.maxTokens
      
      const provider = providers.find(p => p.id === providerId)
      if (!provider) return config.context.maxTokens
      
      const modelConfig = provider.models.find(m => m.id === model)
      return modelConfig?.contextWindow ?? config.context.maxTokens
    },

    async updateModelContext(providerId: string, modelId: string, contextWindow: number) {
      const provider = providers.find(p => p.id === providerId)
      if (!provider) {
        return { success: false, error: 'Provider not found' }
      }

      const modelIndex = provider.models.findIndex(m => m.id === modelId)
      if (modelIndex === -1) {
        // Model not found, add it
        providers = providers.map(p => p.id === providerId 
          ? { ...p, models: [...p.models, { id: modelId, contextWindow, source: 'user' as const }] }
          : p
        )
      } else {
        providers = providers.map(p => p.id === providerId 
          ? { ...p, models: p.models.map((m, i) => i === modelIndex ? { ...m, contextWindow, source: 'user' as const } : m) }
          : p
        )
      }

      logger.info('Model context updated', { providerId, modelId, contextWindow })
      return { success: true }
    },

    async refreshProviderModels(providerId: string) {
      const provider = providers.find(p => p.id === providerId)
      if (!provider) {
        return { success: false, error: 'Provider not found' }
      }

      const url = provider.url.includes('/v1') ? provider.url.replace('/v1', '') : provider.url
      const backend = provider.backend as 'ollama' | 'vllm' | 'sglang' | 'llamacpp' | 'unknown'
      logger.info('refreshProviderModels fetching models', { providerId, providerName: provider.name, url, backend })
      const modelsWithContext = await fetchModelsWithContext(url, provider.apiKey, backend)
      
      // Preserve user-set models even if backend fetch fails or returns empty
      const userModels = provider.models.filter(m => m.source === 'user')
      logger.info('refreshProviderModels', { providerId, userModelsCount: userModels.length, backendModelsCount: modelsWithContext.length })

      if (modelsWithContext.length === 0) {
        setLlmStatus('disconnected')
        // Keep existing user models when backend is unavailable
        if (userModels.length > 0) {
          logger.debug('Backend unavailable, preserving user models', { providerId, userModels: userModels.map(m => ({ id: m.id, contextWindow: m.contextWindow })) })
          providers = providers.map(p => p.id === providerId ? { ...p, models: userModels } : p)
          return { success: true }
        }
        return { success: false, error: 'No models returned from backend' }
      }

      setLlmStatus('connected')

      const updatedModels = mergeModelsWithUserOverrides(modelsWithContext, userModels)
      providers = providers.map(p => p.id === providerId ? { ...p, models: updatedModels } : p)
      
      // Update defaultModelSelection if the model ID was changed due to fuzzy matching
      const { providerId: currentProviderId, model: currentModel } = parseDefaultModelSelection(defaultModelSelection)
      if (currentProviderId === providerId && currentModel) {
        const normalizedCurrentModel = normalizeModelId(currentModel)
        const matchedModel = updatedModels.find(m => normalizeModelId(m.id) === normalizedCurrentModel)
        if (matchedModel && matchedModel.id !== currentModel) {
          defaultModelSelection = `${providerId}/${matchedModel.id}`
          logger.debug('Updated defaultModelSelection after fuzzy match', { from: currentModel, to: matchedModel.id })
        }
      }
      logger.info('Provider models refreshed', { providerId, modelCount: updatedModels.length })
      return { success: true }
    },
  }
}
