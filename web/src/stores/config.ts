import { create } from 'zustand'
import { useSessionStore } from './session'

type LlmStatus = 'connected' | 'disconnected' | 'unknown'
type Backend = 'vllm' | 'sglang' | 'ollama' | 'llamacpp' | 'openai' | 'anthropic' | 'auto' | 'unknown'
type ProviderStatus = 'connected' | 'disconnected' | 'unknown'

interface ModelConfig {
  id: string
  contextWindow: number
  source: 'backend' | 'user' | 'default'
}

interface Provider {
  id: string
  name: string
  url: string
  backend: Backend
  apiKey?: string
  models: ModelConfig[]
  isActive: boolean
  createdAt: string
  status?: ProviderStatus
}

interface ConfigState {
  // Current active model/backend
  model: string | null
  maxContext: number
  llmUrl: string | null
  llmStatus: LlmStatus
  backend: Backend
  // Provider management
  providers: Provider[]
  activeProviderId: string | null
  defaultModelSelection: string | null
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
  updateModelContext: (providerId: string, modelId: string, contextWindow: number) => Promise<boolean>
  refreshProviderModels: (providerId: string) => Promise<boolean>

  // Selectors
  getActiveProvider: () => Provider | undefined
  getModelContext: (modelId: string) => number
}

const AUTO_REFRESH_INTERVAL_MS = 30_000

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
  defaultModelSelection: null,
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
        defaultModelSelection: string | null
      }
      set({
        model: data.model,
        maxContext: data.maxContext,
        llmUrl: data.llmUrl,
        llmStatus: data.llmStatus,
        backend: data.backend,
        providers: data.providers ?? [],
        activeProviderId: data.activeProviderId ?? null,
        defaultModelSelection: data.defaultModelSelection ?? null,
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
      
      // Check if current session has a provider/model override
      // If yes, preserve the session-specific model and don't overwrite it
      const sessionStore = useSessionStore.getState()
      const currentSession = sessionStore.currentSession
      if (currentSession?.providerId && currentSession.providerModel) {
        // Session has explicit model selection - preserve it
        set({ llmStatus: data.llmStatus, backend: data.backend })
        return
      }
      
      set({ model: data.model, llmStatus: data.llmStatus, backend: data.backend })
    } catch (error) {
      console.error('Failed to refresh model:', error)
    }
  },
  
  activateProvider: async (providerId: string) => {
    const { activeProviderId, providers } = get()
    if (providerId === activeProviderId) return true
    
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
      defaultModelSelection: `${providerId}/${model}`,
      providers: providers.map(p => ({
        ...p,
        isActive: p.id === providerId,
      })),
    })
  },

  updateModelContext: async (providerId: string, modelId: string, contextWindow: number) => {
    set({ activating: true, error: null })
    try {
      const response = await fetch(`/api/providers/${providerId}/models/${modelId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextWindow }),
      })
      if (!response.ok) {
        const errorData = await response.json() as { error?: string }
        throw new Error(errorData.error ?? 'Failed to update model context')
      }
      
      const data = await response.json() as { 
        success: boolean
        contextState?: { currentTokens: number; maxTokens: number; compactionCount: number; dangerZone: boolean; canCompact: boolean } | null
      }
      
      const { providers } = get()
      set({
        providers: providers.map(p => p.id === providerId
          ? { ...p, models: p.models.map(m => m.id === modelId ? { ...m, contextWindow, source: 'user' as const } : m) }
          : p,
        ),
        activating: false,
      })
      
      // Update session context state if returned from server
      // This ensures the session header updates immediately without requiring a provider re-click
      if (data.contextState) {
        const sessionStore = useSessionStore.getState()
        sessionStore.updateContextState(data.contextState)
      }
      
      return true
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to update model context',
        activating: false,
      })
      return false
    }
  },

  refreshProviderModels: async (providerId: string) => {
    set({ activating: true, error: null })
    try {
      const response = await fetch(`/api/providers/${providerId}/refresh`, { method: 'POST' })
      if (!response.ok) {
        const errorData = await response.json() as { error?: string }
        throw new Error(errorData.error ?? 'Failed to refresh models')
      }
      const data = await response.json() as { models: ModelConfig[] }
      
      const { providers } = get()
      set({
        providers: providers.map(p => p.id === providerId ? { ...p, models: data.models } : p),
        activating: false,
      })
      return true
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to refresh models',
        activating: false,
      })
      return false
    }
  },

  startAutoRefresh: () => {
    const { autoRefreshInterval, refreshModel } = get()
    if (autoRefreshInterval) return
    
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
  
  getModelContext: (modelId: string) => {
    const { providers, activeProviderId } = get()
    const activeProvider = providers.find(p => p.id === activeProviderId)
    if (!activeProvider) return 200000
    const model = activeProvider.models.find(m => m.id === modelId)
    return model?.contextWindow ?? 200000
  },
}))
