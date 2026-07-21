import { create } from 'zustand'
import { authFetch } from '../lib/api'
import type { ModelConfig } from '@shared/types.js'

type LlmStatus = 'connected' | 'disconnected' | 'unknown'

type Backend =
  | 'vllm'
  | 'sglang'
  | 'ollama'
  | 'llamacpp'
  | 'lmstudio'
  | 'openai'
  | 'anthropic'
  | 'opencode-go'
  | 'unknown'
type ProviderStatus = 'connected' | 'disconnected' | 'unknown'

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
  isLocal?: boolean
  thinkingField?: string
  authAdapter?: string
  transportAdapter?: string
  credentialRef?: string
}

export interface PlatformInfo {
  isWSL: boolean
  wslDistro: string
}

interface ConfigState {
  // Version
  version: string | null
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
  // Platform info from server (WSL detection etc.)
  platform: PlatformInfo | null
  // Loading/error state
  loading: boolean
  activating: boolean
  error: string | null
  autoRefreshInterval: ReturnType<typeof setInterval> | null

  // Actions
  fetchConfig: () => Promise<void>
  refreshModel: () => Promise<void>
  activateProvider: (providerId: string) => Promise<boolean>
  setDefaultModel: (providerId: string, model: string) => Promise<boolean>
  startAutoRefresh: () => void
  stopAutoRefresh: () => void
  refreshProviderModels: (providerId: string) => Promise<boolean>

  // Selectors
  getActiveProvider: () => Provider | undefined
  getModelContext: (modelId: string) => number
}

const AUTO_REFRESH_INTERVAL_MS = 30_000

function getBackendDisplayName(backend: Backend): string {
  switch (backend) {
    case 'vllm':
      return 'vLLM'
    case 'sglang':
      return 'SGLang'
    case 'ollama':
      return 'Ollama'
    case 'llamacpp':
      return 'llama.cpp'
    case 'lmstudio':
      return 'LM Studio'
    case 'openai':
      return 'OpenAI'
    case 'anthropic':
      return 'Anthropic'
    case 'opencode-go':
      return 'OpenCode Go'
    case 'unknown':
      return 'Other'
  }
}

export { getBackendDisplayName }
export type { Backend, LlmStatus, Provider, ProviderStatus }

export const useConfigStore = create<ConfigState>((set, get) => ({
  version: null,
  model: null,
  maxContext: 200000,
  llmUrl: null,
  llmStatus: 'unknown',
  backend: 'unknown',
  providers: [],
  activeProviderId: null,
  defaultModelSelection: null,
  platform: null,
  loading: false,
  activating: false,
  error: null,
  autoRefreshInterval: null,

  fetchConfig: async () => {
    set({ loading: true, error: null })
    try {
      const response = await authFetch('/api/config')
      if (!response.ok) {
        throw new Error('Failed to fetch config')
      }
      const data = (await response.json()) as {
        version: string
        model: string
        maxContext: number
        llmUrl: string
        llmStatus: LlmStatus
        backend: Backend
        providers: Provider[]
        activeProviderId: string | null
        defaultModelSelection: string | null
        platform: unknown
      }
      const platform: PlatformInfo | null =
        data.platform && typeof data.platform === 'object'
          ? {
              isWSL: !!(data.platform as Record<string, unknown>).isWSL,
              wslDistro: String((data.platform as Record<string, unknown>).wslDistro ?? ''),
            }
          : null
      set({
        version: data.version,
        model: data.model,
        maxContext: data.maxContext,
        llmUrl: data.llmUrl,
        llmStatus: data.llmStatus,
        backend: data.backend,
        providers: data.providers ?? [],
        activeProviderId: data.activeProviderId ?? null,
        defaultModelSelection: data.defaultModelSelection ?? null,
        platform,
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
      const response = await authFetch('/api/model/refresh', { method: 'POST' })
      if (!response.ok) {
        throw new Error('Failed to refresh model')
      }
      const data = (await response.json()) as {
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
    if (providerId === activeProviderId) return true

    set({ activating: true, error: null })
    try {
      const response = await authFetch(`/api/providers/${providerId}/activate`, { method: 'POST' })
      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string }
        throw new Error(errorData.error ?? 'Failed to activate provider')
      }
      const data = (await response.json()) as {
        success: boolean
        activeProviderId: string
        model: string
        backend: Backend
      }

      set({
        activeProviderId: data.activeProviderId,
        model: data.model,
        backend: data.backend,
        providers: providers.map((p) => ({
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

  setDefaultModel: async (providerId: string, model: string) => {
    const { providers } = get()
    try {
      const response = await authFetch('/api/default-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, model }),
      })
      if (!response.ok) return false
      const data = (await response.json()) as { success: boolean; defaultModelSelection: string }

      set({
        activeProviderId: providerId,
        model,
        defaultModelSelection: data.defaultModelSelection,
        providers: providers.map((p) => ({
          ...p,
          isActive: p.id === providerId,
        })),
      })
      return true
    } catch {
      return false
    }
  },

  refreshProviderModels: async (providerId: string) => {
    set({ activating: true, error: null })
    try {
      const response = await authFetch(`/api/providers/${providerId}/refresh`, { method: 'POST' })
      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string }
        throw new Error(errorData.error ?? 'Failed to refresh models')
      }
      const data = (await response.json()) as {
        models: ModelConfig[]
        status: 'connected' | 'disconnected' | 'unknown'
      }

      const { providers } = get()
      set({
        providers: providers.map((p) => (p.id === providerId ? { ...p, models: data.models, status: data.status } : p)),
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
    return providers.find((p) => p.id === activeProviderId)
  },

  getModelContext: (modelId: string) => {
    const { providers, activeProviderId } = get()
    const activeProvider = providers.find((p) => p.id === activeProviderId)
    if (!activeProvider) return 200000
    const model = activeProvider.models.find((m) => m.id === modelId)
    return model?.contextWindow ?? 200000
  },
}))
