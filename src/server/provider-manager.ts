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
  /** Get all configured providers */
  getProviders(): Provider[]
  
  /** Get the active provider */
  getActiveProvider(): Provider | undefined
  
  /** Get the active provider ID */
  getActiveProviderId(): string | undefined
  
  /** Get the LLM client for the active provider */
  getLLMClient(): LLMClientWithModel
  
  /** Switch to a different provider */
  activateProvider(providerId: string, options?: { model?: string }): Promise<{ success: boolean; error?: string }>
  
  /** Add a new provider */
  addProvider(provider: Omit<Provider, 'id' | 'createdAt'>): Provider
  
  /** Remove a provider */
  removeProvider(providerId: string): boolean
  
  /** Update provider list (e.g., from external config change) */
  setProviders(providers: Provider[], activeProviderId?: string): void
  
  /** Get provider status (for UI) */
  getProviderStatus(providerId: string): 'connected' | 'disconnected' | 'unknown'

  /** Get available models for a provider (fetches from backend) */
  getProviderModels(providerId: string): Promise<string[]>

  /** Set the model for a provider */
  setProviderModel(providerId: string, model: string): Promise<{ success: boolean; error?: string }>
}

export function createProviderManager(config: Config): ProviderManager {
  // Copy providers from config
  let providers: Provider[] = [...(config.providers ?? [])]
  let activeProviderId: string | undefined = config.activeProviderId
  
  // Create initial LLM client from config (may be from active provider or env vars)
  let llmClient = createLLMClient(config)
  
  // Track connection status for each provider
  const providerStatus = new Map<string, 'connected' | 'disconnected' | 'unknown'>()
  
  // Initialize status for all providers
  for (const p of providers) {
    providerStatus.set(p.id, 'unknown')
  }
  
  // Helper to create a config for a specific provider
  function createConfigForProvider(provider: Provider): Config {
    return {
      ...config,
      llm: {
        ...config.llm,
        baseUrl: provider.url.includes('/v1') ? provider.url : `${provider.url}/v1`,
        model: provider.model,
        backend: provider.backend as LlmBackend | 'auto',
      },
    }
  }
  
  return {
    getProviders() {
      return [...providers]
    },
    
    getActiveProvider() {
      if (!activeProviderId) return undefined
      return providers.find(p => p.id === activeProviderId)
    },
    
    getActiveProviderId() {
      return activeProviderId
    },
    
    getLLMClient() {
      return llmClient
    },
    
    async activateProvider(providerId: string, options?: { model?: string }) {
      const provider = providers.find(p => p.id === providerId)
      if (!provider) {
        return { success: false, error: 'Provider not found' }
      }

      // Determine which model to use (option overrides provider's default)
      const targetModel = options?.model ?? provider.model
      const isModelSwitch = providerId === activeProviderId && options?.model && options.model !== provider.model
      
      if (providerId === activeProviderId && !isModelSwitch) {
        return { success: true } // Already active and not switching model
      }

      logger.info('Switching provider', {
        from: activeProviderId,
        to: providerId,
        providerName: provider.name,
        url: provider.url,
        model: targetModel,
      })

      // Create new LLM client for this provider
      const providerConfig = createConfigForProvider({ ...provider, model: targetModel })
      const newClient = createLLMClient(providerConfig)

      // Try to detect backend and model
      try {
        const url = provider.url.includes('/v1') ? provider.url.replace('/v1', '') : provider.url

        // Clear cache for this URL to force fresh detection
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
          // Explicitly set the model if it's not auto
          newClient.setModel(targetModel)
        }

        providerStatus.set(providerId, 'connected')
      } catch (err) {
        logger.warn('Could not connect to provider', {
          providerId,
          error: err instanceof Error ? err.message : String(err),
        })
        providerStatus.set(providerId, 'disconnected')
        // Still switch - user may want to use it anyway
      }

      // Update state
      providers = providers.map(p => ({
        ...p,
        isActive: p.id === providerId,
        model: p.id === providerId ? targetModel : p.model,
      }))
      activeProviderId = providerId
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
      
      // If this is the first provider or marked active, make it active
      if (providerData.isActive || providers.length === 0) {
        providers = providers.map(p => ({ ...p, isActive: false }))
        provider.isActive = true
        activeProviderId = id
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
      
      // If we removed the active provider, activate the first remaining one
      if (wasActive && providers.length > 0) {
        providers[0]!.isActive = true
        activeProviderId = providers[0]!.id
      } else if (providers.length === 0) {
        activeProviderId = undefined
      }
      
      return true
    },
    
    setProviders(newProviders, newActiveId) {
      providers = [...newProviders]
      activeProviderId = newActiveId
      
      // Reset status for all providers
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

    async setProviderModel(providerId: string, model: string) {
      const provider = providers.find(p => p.id === providerId)
      if (!provider) {
        return { success: false, error: 'Provider not found' }
      }

      logger.info('Setting provider model', { providerId, model, providerName: provider.name })

      // Update provider's model
      providers = providers.map(p =>
        p.id === providerId ? { ...p, model } : p
      )

      // If this is the active provider, update the LLM client
      if (providerId === activeProviderId) {
        llmClient.setModel(model)
        logger.info('Provider model updated', { providerId, model })
      }

      return { success: true }
    },
  }
}
