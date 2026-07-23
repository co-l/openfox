import { create } from 'zustand'
import { SETTINGS_KEYS } from './settings'
import themeData from './theme-presets.json'

export interface ThemeToken {
  key: string
  category: 'background' | 'text' | 'accent' | 'border' | 'surface'
  label: string
  defaultValue: string
}

export interface ThemePreset {
  id: string
  name: string
  mode?: 'dark' | 'light'
  tokens: Record<string, string>
}

export const THEME_TOKENS: ThemeToken[] = themeData.tokens as ThemeToken[]
export const THEME_PRESETS: ThemePreset[] = themeData.presets as ThemePreset[]

export interface UserThemePreset {
  id: string
  name: string
  basePreset: string
  mode?: 'dark' | 'light'
  tokens: Record<string, string>
}

interface ThemeState {
  currentPreset: string
  basePreset: string
  customTokens: Record<string, string>
  isCustom: boolean
  isCustomizing: boolean
  userPresets: UserThemePreset[]
  followSystemTheme: boolean
  isSystem: boolean

  applySavedTheme: () => void
  applyPreset: (presetId: string) => void
  startCustomizing: () => void
  setCustomToken: (key: string, value: string) => void
  cancelCustomizing: () => void
  saveCustomTheme: () => void
  applyTokens: (tokens: Record<string, string>) => void
  getActiveTheme: () => Record<string, string>
  applyTheme: () => void
  getSavedTheme: () => string | null
  saveTheme: (themeJson: string) => Promise<void>
  clearCustomTheme: () => void
  reset: () => void

  addUserPreset: (name: string) => void
  applyUserPreset: (index: number) => void
  deleteUserPreset: (index: number) => void
  loadUserPresets: () => void
  saveUserPresets: () => void

  setFollowSystemTheme: (enabled: boolean) => void
  initSystemThemeListener: () => () => void

  systemDarkPreset: string
  systemLightPreset: string
  setSystemDarkPreset: (presetId: string) => void
  setSystemLightPreset: (presetId: string) => void
  activeUserPresetId: string | null
}

function getUserPresets(): UserThemePreset[] {
  try {
    const saved = localStorage.getItem('openfox:userPresets')
    if (saved) return JSON.parse(saved)
  } catch {
    // ignore
  }
  return []
}

function getSystemThemePrefs(): { darkPreset: string; lightPreset: string } {
  try {
    const saved = localStorage.getItem('openfox:systemThemePrefs')
    if (saved) return JSON.parse(saved) as { darkPreset: string; lightPreset: string }
  } catch {
    // ignore
  }
  return { darkPreset: 'dark', lightPreset: 'light' }
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const prefs = getSystemThemePrefs()
  return {
    currentPreset: 'dark',
    basePreset: '',
    customTokens: {},
    isCustom: false,
    isCustomizing: false,
    userPresets: getUserPresets(),
    followSystemTheme: true,
    isSystem: false,
    systemDarkPreset: prefs.darkPreset,
    systemLightPreset: prefs.lightPreset,
    activeUserPresetId: null,

    applySavedTheme: () => {
      const { getSavedTheme, applyPreset, applyTokens } = get()
      const savedTheme = getSavedTheme()
      if (savedTheme) {
        try {
          const parsed = JSON.parse(savedTheme) as { preset?: string; tokens?: Record<string, string> }
          if (parsed.preset && parsed.tokens) {
            applyPreset(parsed.preset)
            set({ basePreset: parsed.preset })
            applyTokens(parsed.tokens)
          } else if (parsed.preset) {
            applyPreset(parsed.preset)
          } else if (parsed.tokens) {
            applyTokens(parsed.tokens)
          }
        } catch {
          applyPreset('dark')
        }
      } else {
        applyPreset('dark')
      }
    },

    applyPreset: (presetId: string) => {
      const preset = THEME_PRESETS.find((p) => p.id === presetId)
      if (preset) {
        // System theme is virtual - set basePreset to 'system' to keep it selected in UI
        // but apply the actual dark/light theme tokens
        if (presetId === 'system') {
          const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
          const { systemDarkPreset, systemLightPreset, userPresets } = get()
          const targetPresetId = mediaQuery.matches ? systemDarkPreset : systemLightPreset

          // Check if target is a user preset
          const userPreset = userPresets.find((p) => p.id === targetPresetId)
          if (userPreset) {
            set({
              basePreset: 'system',
              currentPreset: userPreset.basePreset,
              customTokens: { ...userPreset.tokens },
              isCustom: true,
              isCustomizing: false,
              isSystem: true,
              activeUserPresetId: userPreset.id,
            })
          } else {
            set({
              basePreset: 'system',
              currentPreset: targetPresetId,
              customTokens: {},
              isCustom: false,
              isCustomizing: false,
              isSystem: true,
              activeUserPresetId: null,
            })
          }
          get().applyTheme()
        } else {
          set({
            currentPreset: presetId,
            basePreset: '',
            customTokens: {},
            isCustom: false,
            isCustomizing: false,
            isSystem: false,
            activeUserPresetId: null,
          })
          get().applyTheme()
        }
      }
    },

    startCustomizing: () => {
      const { currentPreset } = get()
      const presetTokens = THEME_PRESETS.find((p) => p.id === currentPreset)?.tokens ?? {}
      set({
        basePreset: currentPreset,
        customTokens: { ...presetTokens },
        isCustom: true,
        isCustomizing: true,
      })
    },

    setCustomToken: (key: string, value: string) => {
      set((state) => ({
        customTokens: { ...state.customTokens, [key]: value },
      }))
      get().applyTheme()
    },

    cancelCustomizing: () => {
      get().applyPreset(get().basePreset || get().currentPreset)
    },

    saveCustomTheme: () => {
      const { customTokens } = get()
      get()
        .saveTheme(JSON.stringify({ tokens: customTokens }))
        .catch(() => {})
      set({ isCustomizing: false })
    },

    applyTokens: (tokens: Record<string, string>) => {
      set({ customTokens: tokens, isCustom: true, isCustomizing: false })
      get().applyTheme()
    },

    getActiveTheme: () => {
      const { basePreset, customTokens, isCustom } = get()
      if (isCustom && basePreset) {
        const base = THEME_PRESETS.find((p) => p.id === basePreset)?.tokens ?? {}
        return { ...base, ...customTokens }
      }
      if (isCustom) {
        return { ...THEME_TOKENS.reduce((acc, t) => ({ ...acc, [t.key]: t.defaultValue }), {}), ...customTokens }
      }
      const preset = THEME_PRESETS.find((p) => p.id === get().currentPreset)
      return preset?.tokens ?? THEME_PRESETS[0]?.tokens ?? {}
    },

    applyTheme: () => {
      if (typeof document === 'undefined') return
      const theme = get().getActiveTheme()
      const root = document.documentElement
      Object.entries(theme).forEach(([key, value]) => {
        root.style.setProperty(`--${key}`, value)
      })
    },

    getSavedTheme: () => {
      try {
        const saved = localStorage.getItem('openfox:theme')
        if (!saved) return null
        // Handle both plain preset name and JSON format
        if (saved[0] !== '{') return JSON.stringify({ preset: saved })
        const parsed = JSON.parse(saved)
        if (parsed.preset) {
          return JSON.stringify({ preset: parsed.preset })
        }
        if (parsed.tokens) {
          return JSON.stringify({ tokens: parsed.tokens })
        }
      } catch {
        return null
      }
      return null
    },

    saveTheme: async (themeJson: string) => {
      localStorage.setItem('openfox:theme', themeJson)
      const { useSettingsStore } = await import('./settings')
      await useSettingsStore.getState().setSetting(SETTINGS_KEYS.DISPLAY_THEME, themeJson)
    },

    clearCustomTheme: () => {
      localStorage.removeItem('openfox:theme')
      set({ isCustom: false, isCustomizing: false, basePreset: '' })
    },

    setFollowSystemTheme: (enabled: boolean) => {
      set({ followSystemTheme: enabled })
      import('./settings').then(({ useSettingsStore, SETTINGS_KEYS }) => {
        useSettingsStore.getState().setSetting(SETTINGS_KEYS.DISPLAY_FOLLOW_SYSTEM_THEME, String(enabled))
      })
    },

    initSystemThemeListener: () => {
      if (typeof window === 'undefined') return () => {}

      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

      const applySystemTheme = (isDark: boolean) => {
        const { followSystemTheme, systemDarkPreset, systemLightPreset } = get()
        if (!followSystemTheme) return
        const targetPreset = isDark ? systemDarkPreset : systemLightPreset
        get().applyPreset(targetPreset)
        get().saveTheme(JSON.stringify({ preset: targetPreset }))
      }

      const handler = (e: MediaQueryListEvent) => applySystemTheme(e.matches)
      mediaQuery.addEventListener('change', handler)
      return () => mediaQuery.removeEventListener('change', handler)
    },

    reset: () => {
      set({
        currentPreset: 'dark',
        basePreset: '',
        customTokens: {},
        isCustom: false,
        isCustomizing: false,
        userPresets: [],
        followSystemTheme: true,
        systemDarkPreset: 'dark',
        systemLightPreset: 'light',
        activeUserPresetId: null,
      })
    },

    addUserPreset: (name: string) => {
      const { basePreset, customTokens, currentPreset } = get()
      const effectiveBase = basePreset || currentPreset
      const base = THEME_PRESETS.find((p) => p.id === effectiveBase)
      const preset: UserThemePreset = {
        id: 'custom-' + Date.now(),
        name,
        basePreset: effectiveBase,
        mode: base?.mode,
        tokens: { ...customTokens },
      }
      const updated = [...get().userPresets, preset]
      set({ userPresets: updated })
      get().saveUserPresets()
    },

    applyUserPreset: (index: number) => {
      const preset = get().userPresets[index]
      if (preset) {
        set({
          currentPreset: preset.basePreset,
          basePreset: preset.basePreset,
          customTokens: { ...preset.tokens },
          isCustom: true,
          isCustomizing: false,
          activeUserPresetId: preset.id,
        })
        get().applyTheme()
        get()
          .saveTheme(JSON.stringify({ preset: preset.basePreset, tokens: preset.tokens }))
          .catch(() => {})
      }
    },

    deleteUserPreset: (index: number) => {
      const updated = get().userPresets.filter((_, i) => i !== index)
      set({ userPresets: updated })
      get().saveUserPresets()
    },

    loadUserPresets: () => {
      set({ userPresets: getUserPresets() })
    },

    saveUserPresets: () => {
      localStorage.setItem('openfox:userPresets', JSON.stringify(get().userPresets))
      // Fire-and-forget sync to server
      import('./settings').then(({ useSettingsStore }) => {
        useSettingsStore
          .getState()
          .setSetting(SETTINGS_KEYS.DISPLAY_USER_PRESETS, JSON.stringify(get().userPresets))
          .catch(() => {})
      })
    },

    setSystemDarkPreset: (presetId: string) => {
      set({ systemDarkPreset: presetId })
      localStorage.setItem(
        'openfox:systemThemePrefs',
        JSON.stringify({ darkPreset: presetId, lightPreset: get().systemLightPreset }),
      )
      import('./settings').then(({ useSettingsStore, SETTINGS_KEYS }) => {
        useSettingsStore
          .getState()
          .setSetting(
            SETTINGS_KEYS.DISPLAY_SYSTEM_THEME_PREFS,
            JSON.stringify({ darkPreset: presetId, lightPreset: get().systemLightPreset }),
          )
      })
      if (get().isSystem) {
        get().applyPreset('system')
      }
    },

    setSystemLightPreset: (presetId: string) => {
      set({ systemLightPreset: presetId })
      localStorage.setItem(
        'openfox:systemThemePrefs',
        JSON.stringify({ darkPreset: get().systemDarkPreset, lightPreset: presetId }),
      )
      import('./settings').then(({ useSettingsStore, SETTINGS_KEYS }) => {
        useSettingsStore
          .getState()
          .setSetting(
            SETTINGS_KEYS.DISPLAY_SYSTEM_THEME_PREFS,
            JSON.stringify({ darkPreset: get().systemDarkPreset, lightPreset: presetId }),
          )
      })
      if (get().isSystem) {
        get().applyPreset('system')
      }
    },
  }
})

export function migrateLegacyThemeSetting(legacyValue: string | undefined): string {
  if (!legacyValue || legacyValue === 'dark' || legacyValue === 'light') {
    return JSON.stringify({ preset: legacyValue ?? 'dark' })
  }
  return JSON.stringify({ preset: 'dark' })
}

export function getPresetFromJson(json: string | null): string | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as { preset?: string }
    return parsed.preset ?? null
  } catch {
    return null
  }
}
