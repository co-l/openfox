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
  DISPLAY_SHOW_SYNTAX_HIGHLIGHTING: 'display.showSyntaxHighlighting',
  DISPLAY_THEME: 'display.theme',
  DISPLAY_USER_PRESETS: 'display.userPresets',
  DISPLAY_FOLLOW_SYSTEM_THEME: 'display.followSystemTheme',
  DISPLAY_SHOW_OPEN_IN_EDITOR: 'display.showOpenInEditorLinks',
  DISPLAY_MAX_VISIBLE_ITEMS: 'display.maxVisibleItems',
  LLM_DYNAMIC_SYSTEM_PROMPT: 'llm.dynamicSystemPrompt',
  CACHE_WARMING: 'cache.warming',
  KEYBINDINGS: 'keybindings',
  RETRY_PATTERNS: 'agent.retryPatterns',
  SKILLS_DIRECTORIES: 'skills.directories',
  SEARCH_ENGINE: 'search.engine',
  SEARCH_TAVILY_API_KEY: 'search.tavilyApiKey',
  SEARCH_SEARXNG_URL: 'search.searxngUrl',
  SEARCH_SEARXNG_API_KEY: 'search.searxngApiKey',
  TOOLS_USE_RTK: 'tools.useRtk',
  TOOLS_SHELL: 'tools.shell',
} as const

interface SettingsState {
  // Cached settings values
  settings: Record<string, string>
  loading: Record<string, boolean>

  // Actions
  getSetting: (key: string) => Promise<string | null>
  getSettings: (keys: string[]) => Promise<void>
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
  SETTINGS_KEYS.DISPLAY_SHOW_SYNTAX_HIGHLIGHTING,
  SETTINGS_KEYS.DISPLAY_FOLLOW_SYSTEM_THEME,
  SETTINGS_KEYS.DISPLAY_SHOW_OPEN_IN_EDITOR,
  SETTINGS_KEYS.DISPLAY_MAX_VISIBLE_ITEMS,
] as const

export function useDisplaySettings() {
  return {
    showThinking: useSettingsStore((state) => state.settings[SETTINGS_KEYS.DISPLAY_SHOW_THINKING] ?? 'true') === 'true',
    showVerboseToolOutput:
      useSettingsStore((state) => state.settings[SETTINGS_KEYS.DISPLAY_SHOW_VERBOSE_TOOL_OUTPUT] ?? 'true') === 'true',
    showStats: useSettingsStore((state) => state.settings[SETTINGS_KEYS.DISPLAY_SHOW_STATS] ?? 'true') === 'true',
    showAgentDefinitions:
      useSettingsStore((state) => state.settings[SETTINGS_KEYS.DISPLAY_SHOW_AGENT_DEFINITIONS] ?? 'true') === 'true',
    showWorkflowBars:
      useSettingsStore((state) => state.settings[SETTINGS_KEYS.DISPLAY_SHOW_WORKFLOW_BARS] ?? 'true') === 'true',
    showSyntaxHighlighting:
      useSettingsStore((state) => state.settings[SETTINGS_KEYS.DISPLAY_SHOW_SYNTAX_HIGHLIGHTING] ?? 'true') === 'true',
    maxVisibleItems: Number(
      useSettingsStore((state) => state.settings[SETTINGS_KEYS.DISPLAY_MAX_VISIBLE_ITEMS] ?? '300'),
    ),
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

  getSettings: async (keys: string[]) => {
    if (keys.length === 0) return
    try {
      const res = await authFetch(`/api/settings?keys=${encodeURIComponent(keys.join(','))}`)
      const data = await res.json()
      // Update all settings at once
      set({
        settings: data,
        loading: Object.fromEntries(keys.map((k) => [k, false])),
      })
    } catch {
      set({
        loading: Object.fromEntries(keys.map((k) => [k, false])),
      })
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
