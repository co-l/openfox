import { create } from 'zustand'

type VllmStatus = 'connected' | 'disconnected' | 'unknown'

interface ConfigState {
  model: string | null
  maxContext: number
  vllmUrl: string | null
  vllmStatus: VllmStatus
  loading: boolean
  error: string | null
  autoRefreshInterval: ReturnType<typeof setInterval> | null
  
  fetchConfig: () => Promise<void>
  refreshModel: () => Promise<void>
  startAutoRefresh: () => void
  stopAutoRefresh: () => void
}

const AUTO_REFRESH_INTERVAL_MS = 30_000 // 30 seconds

export const useConfigStore = create<ConfigState>((set, get) => ({
  model: null,
  maxContext: 200000,
  vllmUrl: null,
  vllmStatus: 'unknown',
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
        vllmUrl: string
        vllmStatus: VllmStatus 
      }
      set({
        model: data.model,
        maxContext: data.maxContext,
        vllmUrl: data.vllmUrl,
        vllmStatus: data.vllmStatus,
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
        vllmStatus: VllmStatus 
      }
      set({ model: data.model, vllmStatus: data.vllmStatus })
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
