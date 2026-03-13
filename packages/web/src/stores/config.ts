import { create } from 'zustand'

interface ConfigState {
  model: string | null
  maxContext: number
  vllmUrl: string | null
  loading: boolean
  error: string | null
  
  fetchConfig: () => Promise<void>
  refreshModel: () => Promise<void>
}

export const useConfigStore = create<ConfigState>((set) => ({
  model: null,
  maxContext: 200000,
  vllmUrl: null,
  loading: false,
  error: null,
  
  fetchConfig: async () => {
    set({ loading: true, error: null })
    try {
      const response = await fetch('/api/config')
      if (!response.ok) {
        throw new Error('Failed to fetch config')
      }
      const data = await response.json() as { model: string; maxContext: number; vllmUrl: string }
      set({
        model: data.model,
        maxContext: data.maxContext,
        vllmUrl: data.vllmUrl,
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
      const data = await response.json() as { model: string; source: string }
      set({ model: data.model })
    } catch (error) {
      console.error('Failed to refresh model:', error)
    }
  },
}))
