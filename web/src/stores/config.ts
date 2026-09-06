import { create } from 'zustand'
import { authFetch } from '../lib/api'
import { configResource, providersResource, providerModelsResource, readProviders } from '../lib/resources'
import type { ModelConfig } from '@shared/types.js'

type LlmStatus = 'connected' | 'disconnected' | 'unknown'

type Backend =
  | 'vllm'
  | 'sglang'
  | 'ollama'
  | 'llamacpp'
  | 'lmstudio'
  | 'unsloth'
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
  sendReasoningInMessages?: boolean
  authAdapter?: string
  transportAdapter?: string
  credentialRef?: string
}

export interface PlatformInfo {
  isWSL: boolean
  wslDistro: string
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
    case 'unsloth':
      return 'Unsloth Studio'
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

interface ConfigState {
  /** Local UI state only — all server data lives in the config/providers resources. */
  loading: boolean
  activating: boolean
  error: string | null
  autoRefreshInterval: ReturnType<typeof setInterval> | null

  // Mutations delegating to the resource cache so all subscribers converge.
  fetchConfig: () => Promise<void>
  refreshModel: () => Promise<void>
  activateProvider: (providerId: string) => Promise<boolean>
  setDefaultModel: (providerId: string, model: string) => Promise<boolean>
  updateModelSettings: (
    providerId: string,
    modelId: string,
    settings: { thinkingLevel?: string; thinkingEnabled?: boolean },
  ) => Promise<boolean>
  refreshProviderModels: (providerId: string) => Promise<boolean>
  startAutoRefresh: () => void
  stopAutoRefresh: () => void
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  loading: false,
  activating: false,
  error: null,
  autoRefreshInterval: null,

  fetchConfig: async () => {
    set({ loading: true, error: null })
    try {
      await Promise.all([configResource.refresh(), providersResource.refresh()])
      set({ loading: false })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error', loading: false })
    }
  },

  refreshModel: async () => {
    try {
      const response = await authFetch('/api/model/refresh', { method: 'POST' })
      if (!response.ok) throw new Error('Failed to refresh model')
      await configResource.refresh()
    } catch (error) {
      console.error('Failed to refresh model:', error)
    }
  },

  activateProvider: async (providerId: string) => {
    const activeProviderId = readProviders()?.activeProviderId ?? null
    if (providerId === activeProviderId) return true

    set({ activating: true, error: null })
    try {
      const response = await authFetch(`/api/providers/${providerId}/activate`, { method: 'POST' })
      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string }
        throw new Error(errorData.error ?? 'Failed to activate provider')
      }
      await Promise.all([providersResource.refresh(), configResource.refresh()])
      set({ activating: false })
      return true
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to switch provider', activating: false })
      return false
    }
  },

  setDefaultModel: async (providerId: string, model: string) => {
    try {
      const response = await authFetch('/api/default-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, model }),
      })
      if (!response.ok) return false
      await Promise.all([configResource.refresh(), providersResource.refresh()])
      return true
    } catch {
      return false
    }
  },

  updateModelSettings: async (providerId, modelId, settings) => {
    try {
      const response = await authFetch(`/api/providers/${providerId}/models/${encodeURIComponent(modelId)}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (!response.ok) return false
      await providersResource.refresh()
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
      await Promise.all([providerModelsResource.refresh(providerId), providersResource.refresh()])
      set({ activating: false })
      return true
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to refresh models', activating: false })
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
}))
