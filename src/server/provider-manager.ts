import type { Provider, Config, LlmBackend } from '../shared/types.js'
import { createLLMClient, detectBackend, detectModel, clearModelCache, type LLMClientWithModel } from './llm/index.js'
import { logger } from './utils/logger.js'

/** Fetch available models from a provider's backend */
export async function fetchAvailableModelsFromBackend(baseUrl: string, apiKey?: string): Promise<string[]> {
  const url = baseUrl.includes('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      logger.debug('Failed to fetch models', { url, status: response.status })
      return []
    }

    const data = await response.json() as { data?: Array<{ id: string }> }
    if (data.data && Array.isArray(data.data)) {
      return data.data.map(m => m.id).filter(Boolean)
    }

    return []
  } catch (error) {
    logger.debug('Error fetching models from backend', { url, error: error instanceof Error ? error.message : String(error) })
    return []
  }
}

export interface ProviderManager {
  getProviders(): Provider[]
  getActiveProvider(): Provider | undefined
  getActiveProviderId(): string | undefined
  getCurrentModel(): string | undefined
  getLLMClient(): LLMClientWithModel
  activateProvider(providerId: string, options?: { model?: string }): Promise<{ success: boolean; error?: string }>
  addProvider(provider: Omit<Provider, 'id' | 'createdAt'>): Provider
  removeProvider(providerId: string): boolean
  setProviders(providers: Provider[], defaultModelSelection?: string): void
  getProviderStatus(providerId: string): 'connected' | 'disconnected' | 'unknown'
  getProviderModels(providerId: string): Promise<string[]>
  setDefaultModelSelection(providerId: string, model: string): Promise<{ success: boolean; error?: string }>
}

function parseDefaultModelSelection(selection?: string): { providerId: string | undefined; model: string | undefined } {
  if (!selection) return { providerId: undefined, model: undefined }
  const parts = selection.split('/')
  return {
    providerId: parts[0],
    model: parts[1] ?? 'auto',
  }
}

export function createProviderManager(config: Config): ProviderManager {
  let providers: Provider[] = [...(config.providers ?? [])]
  const { providerId: initialProviderId, model: initialModel } = parseDefaultModelSelection(config.defaultModelSelection)
  let defaultModelSelection: string | undefined = config.defaultModelSelection
  let llmClient = createLLMClient(config)
  const providerStatus = new Map<string, 'connected' | 'disconnected' | 'unknown'>()
  
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
      providers = [...newProviders]
      defaultModelSelection = newDefaultModelSelection
      
      providerStatus.clear()
      for (const p of providers) {
        providerStatus.set(p.id, 'unknown')
      }
    },
    
    getProviderStatus(providerId) {
      return providerStatus.get(providerId) ?? 'unknown'
    },

    async getProviderModels(providerId: string): Promise<string[]> {
      const provider = providers.find(p => p.id === providerId)
      if (!provider) {
        return []
      }

      const url = provider.url.includes('/v1') ? provider.url.replace('/v1', '') : provider.url
      return fetchAvailableModelsFromBackend(url, provider.apiKey)
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
  }
}
