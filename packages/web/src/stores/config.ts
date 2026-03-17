import { create } from 'zustand'

type LlmStatus = 'connected' | 'disconnected' | 'unknown'
type Backend = 'vllm' | 'sglang' | 'ollama' | 'llamacpp' | 'unknown'

interface ConfigState {
  model: string | null
  maxContext: number
  llmUrl: string | null
  llmStatus: LlmStatus
  backend: Backend
  loading: boolean
  error: string | null
  autoRefreshInterval: ReturnType<typeof setInterval> | null
  
  fetchConfig: () => Promise<void>
  refreshModel: () => Promise<void>
  startAutoRefresh: () => void
  stopAutoRefresh: () => void
}

const AUTO_REFRESH_INTERVAL_MS = 30_000 // 30 seconds

/** Display name for each backend */
function getBackendDisplayName(backend: Backend): string {
  switch (backend) {
    case 'vllm': return 'vLLM'
    case 'sglang': return 'SGLang'
    case 'ollama': return 'Ollama'
    case 'llamacpp': return 'llama.cpp'
    case 'unknown': return ''
  }
}

export { getBackendDisplayName }
export type { Backend, LlmStatus }

export const useConfigStore = create<ConfigState>((set, get) => ({
  model: null,
  maxContext: 200000,
  llmUrl: null,
  llmStatus: 'unknown',
  backend: 'unknown',
  loading: false,
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
      }
      set({
        model: data.model,
        maxContext: data.maxContext,
        llmUrl: data.llmUrl,
        llmStatus: data.llmStatus,
        backend: data.backend,
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
}))
