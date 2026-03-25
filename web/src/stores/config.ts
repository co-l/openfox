import { create } from 'zustand'

type LlmStatus = 'connected' | 'disconnected' | 'unknown'
type Backend = 'vllm' | 'sglang' | 'ollama' | 'llamacpp' | 'openai' | 'anthropic' | 'auto' | 'unknown'
type ProviderStatus = 'connected' | 'disconnected' | 'unknown'

interface Provider {
  id: string
  name: string
  url: string
  model: string
  backend: Backend
  apiKey?: string
  maxContext?: number
  isActive: boolean
  createdAt: string
  status?: ProviderStatus
}

interface ConfigState {
  // Current active model/backend (derived from active provider)
  model: string | null
  maxContext: number
  llmUrl: string | null
  llmStatus: LlmStatus
  backend: Backend
  // Provider management
  providers: Provider[]
  activeProviderId: string | null
  // Loading/error state
  loading: boolean
  activating: boolean
  error: string | null
  autoRefreshInterval: ReturnType<typeof setInterval> | null
  
  // Actions
  fetchConfig: () => Promise<void>
  refreshModel: () => Promise<void>
  activateProvider: (providerId: string) => Promise<boolean>
  syncFromSession: (providerId: string, model: string) => void
  startAutoRefresh: () => void
  stopAutoRefresh: () => void

  // Selectors
  getActiveProvider: () => Provider | undefined
}

const AUTO_REFRESH_INTERVAL_MS = 30_000 // 30 seconds

/** Display name for each backend */
function getBackendDisplayName(backend: Backend): string {
  switch (backend) {
    case 'vllm': return 'vLLM'
    case 'sglang': return 'SGLang'
    case 'ollama': return 'Ollama'
    case 'llamacpp': return 'llama.cpp'
    case 'openai': return 'OpenAI'
    case 'anthropic': return 'Anthropic'
    case 'auto': return 'Auto'
    case 'unknown': return ''
  }
}

export { getBackendDisplayName }
export type { Backend, LlmStatus, Provider, ProviderStatus }

export const useConfigStore = create<ConfigState>((set, get) => ({
  model: null,
  maxContext: 200000,
  llmUrl: null,
  llmStatus: 'unknown',
  backend: 'unknown',
  providers: [],
  activeProviderId: null,
  loading: false,
  activating: false,
  error: null,
  autoRefreshInterval: null,
  
  fetchConfig: async () => {
    set({ loading: true, error: null })
    try {
      const response = await fetch('/api/config')
      if (!response.ok) {
        throw new Error('Failed to fetch config')
      }
      const data = await response.json() as { 
        model: string
        maxContext: number
        llmUrl: string
        llmStatus: LlmStatus
        backend: Backend
        providers: Provider[]
        activeProviderId: string | null
      }
      set({
        model: data.model,
        maxContext: data.maxContext,
        llmUrl: data.llmUrl,
        llmStatus: data.llmStatus,
        backend: data.backend,
        providers: data.providers ?? [],
        activeProviderId: data.activeProviderId ?? null,
        loading: false,
      })
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        loading: false,
      })
    }
  },
  
  refreshModel: async () => {
    try {
      const response = await fetch('/api/model/refresh', { method: 'POST' })
      if (!response.ok) {
        throw new Error('Failed to refresh model')
      }
      const data = await response.json() as { 
        model: string
        source: string
        llmStatus: LlmStatus
        backend: Backend
      }
      set({ model: data.model, llmStatus: data.llmStatus, backend: data.backend })
    } catch (error) {
      console.error('Failed to refresh model:', error)
    }
  },
  
  activateProvider: async (providerId: string) => {
    const { activeProviderId, providers } = get()
    if (providerId === activeProviderId) return true // Already active
    
    set({ activating: true, error: null })
    try {
      const response = await fetch(`/api/providers/${providerId}/activate`, { method: 'POST' })
      if (!response.ok) {
        const errorData = await response.json() as { error?: string }
        throw new Error(errorData.error ?? 'Failed to activate provider')
      }
      const data = await response.json() as {
        success: boolean
        activeProviderId: string
        model: string
        backend: Backend
      }
      
      // Update local state
      set({
        activeProviderId: data.activeProviderId,
        model: data.model,
        backend: data.backend,
        providers: providers.map(p => ({
          ...p,
          isActive: p.id === data.activeProviderId,
        })),
        activating: false,
      })
      return true
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to switch provider',
        activating: false,
      })
      return false
    }
  },

  syncFromSession: (providerId: string, model: string) => {
    const { providers } = get()
    set({
      activeProviderId: providerId,
      model,
      providers: providers.map(p => ({
        ...p,
        isActive: p.id === providerId,
      })),
    })
  },

  startAutoRefresh: () => {
    const { autoRefreshInterval, refreshModel } = get()
    if (autoRefreshInterval) return // Already running
    
    const interval = setInterval(() => {
      refreshModel()
    }, AUTO_REFRESH_INTERVAL_MS)
    
    set({ autoRefreshInterval: interval })
  },
  
  stopAutoRefresh: () => {
    const { autoRefreshInterval } = get()
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval)
      set({ autoRefreshInterval: null })
    }
  },
  
  getActiveProvider: () => {
    const { providers, activeProviderId } = get()
    return providers.find(p => p.id === activeProviderId)
  },
}))
