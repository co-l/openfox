import type { Provider, Config, LlmBackend } from '../shared/types.js'
import { createLLMClient, detectBackend, detectModel, clearModelCache, type LLMClientWithModel } from './llm/index.js'
import { logger } from './utils/logger.js'

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
  activateProvider(providerId: string): Promise<{ success: boolean; error?: string }>
  
  /** Add a new provider */
  addProvider(provider: Omit<Provider, 'id' | 'createdAt'>): Provider
  
  /** Remove a provider */
  removeProvider(providerId: string): boolean
  
  /** Update provider list (e.g., from external config change) */
  setProviders(providers: Provider[], activeProviderId?: string): void
  
  /** Get provider status (for UI) */
  getProviderStatus(providerId: string): 'connected' | 'disconnected' | 'unknown'
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
    
    async activateProvider(providerId: string) {
      const provider = providers.find(p => p.id === providerId)
      if (!provider) {
        return { success: false, error: 'Provider not found' }
      }
      
      if (providerId === activeProviderId) {
        return { success: true } // Already active
      }
      
      logger.info('Switching provider', { 
        from: activeProviderId,
        to: providerId,
        providerName: provider.name,
        url: provider.url,
      })
      
      // Create new LLM client for this provider
      const providerConfig = createConfigForProvider(provider)
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
        
        if (provider.model === 'auto') {
          const detected = await detectModel(url)
          if (detected) {
            newClient.setModel(detected)
          }
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
  }
}
