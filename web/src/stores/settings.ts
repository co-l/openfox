import { create } from 'zustand'
import type { ServerMessage, SettingsValuePayload } from '@shared/protocol.js'
import { wsClient } from '../lib/ws'

// Well-known settings keys (should match server's SETTINGS_KEYS)
export const SETTINGS_KEYS = {
  GLOBAL_INSTRUCTIONS: 'global_instructions',
} as const

interface SettingsState {
  // Cached settings values
  settings: Record<string, string>
  loading: Record<string, boolean>
  
  // Actions
  getSetting: (key: string) => void
  setSetting: (key: string, value: string) => void
  
  // Internal
  handleServerMessage: (message: ServerMessage) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: {},
  loading: {},
  
  getSetting: (key) => {
    set(state => ({ loading: { ...state.loading, [key]: true } }))
    wsClient.send('settings.get', { key })
  },
  
  setSetting: (key, value) => {
    set(state => ({ loading: { ...state.loading, [key]: true } }))
    wsClient.send('settings.set', { key, value })
  },
  
  handleServerMessage: (message) => {
    switch (message.type) {
      case 'settings.value': {
        const payload = message.payload as SettingsValuePayload
        set(state => ({
          settings: { ...state.settings, [payload.key]: payload.value ?? '' },
          loading: { ...state.loading, [payload.key]: false },
        }))
        break
      }
    }
  },
}))
