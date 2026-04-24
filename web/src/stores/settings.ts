import { create } from 'zustand'
import { authFetch } from '../lib/api'

// Well-known settings keys (should match server's SETTINGS_KEYS)
export const SETTINGS_KEYS = {
  GLOBAL_INSTRUCTIONS: 'global_instructions',
  NOTIFICATION_SETTINGS: 'notification_settings',
  DISPLAY_SHOW_THINKING: 'display.showThinking',
  DISPLAY_SHOW_VERBOSE_TOOL_OUTPUT: 'display.showVerboseToolOutput',
  DISPLAY_SHOW_STATS: 'display.showStats',
  DISPLAY_SHOW_AGENT_DEFINITIONS: 'display.showAgentDefinitions',
  DISPLAY_SHOW_WORKFLOW_BARS: 'display.showWorkflowBars',
  DISPLAY_THEME: 'display.theme',
  DISPLAY_USER_PRESETS: 'display.userPresets',
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

export const DISPLAY_SETTINGS_KEYS = [
  SETTINGS_KEYS.DISPLAY_SHOW_THINKING,
  SETTINGS_KEYS.DISPLAY_SHOW_VERBOSE_TOOL_OUTPUT,
  SETTINGS_KEYS.DISPLAY_SHOW_STATS,
  SETTINGS_KEYS.DISPLAY_SHOW_AGENT_DEFINITIONS,
  SETTINGS_KEYS.DISPLAY_SHOW_WORKFLOW_BARS,
] as const

export function useDisplaySettings() {
  return {
    showThinking: useSettingsStore(state => state.settings[SETTINGS_KEYS.DISPLAY_SHOW_THINKING] ?? 'true') === 'true',
    showVerboseToolOutput: useSettingsStore(state => state.settings[SETTINGS_KEYS.DISPLAY_SHOW_VERBOSE_TOOL_OUTPUT] ?? 'true') === 'true',
    showStats: useSettingsStore(state => state.settings[SETTINGS_KEYS.DISPLAY_SHOW_STATS] ?? 'true') === 'true',
    showAgentDefinitions: useSettingsStore(state => state.settings[SETTINGS_KEYS.DISPLAY_SHOW_AGENT_DEFINITIONS] ?? 'true') === 'true',
    showWorkflowBars: useSettingsStore(state => state.settings[SETTINGS_KEYS.DISPLAY_SHOW_WORKFLOW_BARS] ?? 'true') === 'true',
  }
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
