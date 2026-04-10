import { create } from 'zustand'
import { authFetch } from '../lib/api'

// Well-known settings keys (should match server's SETTINGS_KEYS)
export const SETTINGS_KEYS = {
  GLOBAL_INSTRUCTIONS: 'global_instructions',
  NOTIFICATION_SETTINGS: 'notification_settings',
} as const

interface SettingsState {
  // Cached settings values
  settings: Record<string, string>
  loading: Record<string, boolean>
  
  // Actions
  getSetting: (key: string) => Promise<string | null>
  setSetting: (key: string, value: string) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: {},
  loading: {},
  
  getSetting: async (key) => {
    set(state => ({ loading: { ...state.loading, [key]: true } }))
    try {
      const res = await authFetch(`//settings/${key}`)
      const data = await res.json()
      set(state => ({
        settings: { ...state.settings, [key]: data.value ?? '' },
        loading: { ...state.loading, [key]: false },
      }))
      return data.value
    } catch {
      set(state => ({ loading: { ...state.loading, [key]: false } }))
      return null
    }
  },
  
  setSetting: async (key, value) => {
    set(state => ({ loading: { ...state.loading, [key]: true } }))
    try {
      const res = await authFetch(`//settings/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      })
      const data = await res.json()
      set(state => ({
        settings: { ...state.settings, [key]: data.value ?? '' },
        loading: { ...state.loading, [key]: false },
      }))
    } catch {
      set(state => ({ loading: { ...state.loading, [key]: false } }))
    }
  },
}))
