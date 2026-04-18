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

function setLoading(key: string, loading: boolean) {
  return (state: SettingsState) => ({ loading: { ...state.loading, [key]: loading } })
}

function setValue(key: string, value: string) {
  return (state: SettingsState) => ({
    settings: { ...state.settings, [key]: value },
    loading: { ...state.loading, [key]: false },
  })
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: {},
  loading: {},
  
  getSetting: async (key) => {
    set(setLoading(key, true))
    try {
      const res = await authFetch(`/api/settings/${key}`)
      const data = await res.json()
      set(setValue(key, data.value ?? ''))
      return data.value
    } catch {
      set(setLoading(key, false))
      return null
    }
  },
  
  setSetting: async (key, value) => {
    set(setLoading(key, true))
    try {
      const res = await authFetch(`/api/settings/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      })
      const data = await res.json()
      set(setValue(key, data.value ?? ''))
    } catch {
      set(setLoading(key, false))
    }
  },
}))
