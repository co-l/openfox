import { create } from 'zustand'

export interface ThemeToken {
  key: string
  category: 'background' | 'text' | 'accent' | 'border' | 'surface'
  label: string
  defaultValue: string
}

export const THEME_TOKENS: ThemeToken[] = [
  { key: 'color-bg-primary', category: 'background', label: 'Primary Background', defaultValue: '13 17 23' },
  { key: 'color-bg-secondary', category: 'background', label: 'Secondary Background', defaultValue: '22 27 34' },
  { key: 'color-bg-tertiary', category: 'background', label: 'Tertiary Background', defaultValue: '33 38 45' },
  { key: 'color-primary', category: 'surface', label: 'Primary Surface', defaultValue: '10 10 10' },
  { key: 'color-secondary', category: 'surface', label: 'Secondary Surface', defaultValue: '20 20 20' },
  { key: 'color-text-primary', category: 'text', label: 'Primary Text', defaultValue: '139 148 158' },
  { key: 'color-text-secondary', category: 'text', label: 'Secondary Text', defaultValue: '139 148 158' },
  { key: 'color-text-muted', category: 'text', label: 'Muted Text', defaultValue: '72 79 88' },
  { key: 'color-accent-primary', category: 'accent', label: 'Primary Accent', defaultValue: '88 166 255' },
  { key: 'color-accent-success', category: 'accent', label: 'Success Accent', defaultValue: '63 185 80' },
  { key: 'color-accent-warning', category: 'accent', label: 'Warning Accent', defaultValue: '210 153 34' },
  { key: 'color-accent-error', category: 'accent', label: 'Error Accent', defaultValue: '248 81 73' },
  { key: 'color-border', category: 'border', label: 'Border', defaultValue: '48 53 60' },
]

export interface ThemePreset {
  id: string
  name: string
  tokens: Record<string, string>
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'dark',
    name: 'Dark',
    tokens: {
      'color-bg-primary': '13 17 23',
      'color-bg-secondary': '22 27 34',
      'color-bg-tertiary': '33 38 45',
      'color-primary': '10 10 10',
      'color-secondary': '20 20 20',
      'color-text-primary': '139 148 158',
      'color-text-secondary': '139 148 158',
      'color-text-muted': '72 79 88',
      'color-accent-primary': '88 166 255',
      'color-accent-success': '63 185 80',
      'color-accent-warning': '210 153 34',
      'color-accent-error': '248 81 73',
      'color-border': '48 53 60',
    },
  },
  {
    id: 'light',
    name: 'Light',
    tokens: {
      'color-bg-primary': '255 255 255',
      'color-bg-secondary': '250 251 252',
      'color-bg-tertiary': '243 244 246',
      'color-primary': '245 245 245',
      'color-secondary': '229 229 229',
      'color-text-primary': '15 23 42',
      'color-text-secondary': '30 41 59',
      'color-text-muted': '100 116 139',
      'color-accent-primary': '37 99 235',
      'color-accent-success': '22 163 74',
      'color-accent-warning': '217 119 6',
      'color-accent-error': '220 38 38',
      'color-border': '203 213 225',
    },
  },
  {
    id: 'monokai',
    name: 'Monokai',
    tokens: {
      'color-bg-primary': '39 40 34',
      'color-bg-secondary': '30 31 28',
      'color-bg-tertiary': '62 61 50',
      'color-primary': '30 31 28',
      'color-secondary': '45 46 39',
      'color-text-primary': '248 248 242',
      'color-text-secondary': '207 207 194',
      'color-text-muted': '117 113 94',
      'color-accent-primary': '102 217 239',
      'color-accent-success': '166 226 46',
      'color-accent-warning': '230 219 116',
      'color-accent-error': '249 38 114',
      'color-border': '73 72 62',
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    tokens: {
      'color-bg-primary': '40 42 54',
      'color-bg-secondary': '33 34 44',
      'color-bg-tertiary': '68 71 90',
      'color-primary': '30 31 41',
      'color-secondary': '44 46 61',
      'color-text-primary': '248 248 242',
      'color-text-secondary': '230 230 230',
      'color-text-muted': '98 114 164',
      'color-accent-primary': '189 147 249',
      'color-accent-success': '80 250 123',
      'color-accent-warning': '255 184 108',
      'color-accent-error': '255 85 85',
      'color-border': '68 71 90',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    tokens: {
      'color-bg-primary': '46 52 64',
      'color-bg-secondary': '59 66 82',
      'color-bg-tertiary': '67 76 94',
      'color-primary': '46 52 64',
      'color-secondary': '59 66 82',
      'color-text-primary': '236 239 244',
      'color-text-secondary': '229 233 240',
      'color-text-muted': '76 86 106',
      'color-accent-primary': '129 161 193',
      'color-accent-success': '163 190 140',
      'color-accent-warning': '235 203 139',
      'color-accent-error': '191 97 106',
      'color-border': '76 86 106',
    },
  },
]

interface ThemeState {
  currentPreset: string
  customTokens: Record<string, string>
  isCustom: boolean

  applyPreset: (presetId: string) => void
  applyTokens: (tokens: Record<string, string>) => void
  getActiveTheme: () => Record<string, string>
  applyTheme: () => void
  getSavedTheme: () => string | null
  saveTheme: (themeJson: string) => void
  clearCustomTheme: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  currentPreset: 'dark',
  customTokens: {},
  isCustom: false,

  applyPreset: (presetId: string) => {
    const preset = THEME_PRESETS.find(p => p.id === presetId)
    if (preset) {
      set({ currentPreset: presetId, customTokens: {}, isCustom: false })
      get().applyTheme()
    }
  },

  applyTokens: (tokens: Record<string, string>) => {
    set({ customTokens: tokens, isCustom: true, currentPreset: '' })
    get().applyTheme()
  },

  getActiveTheme: () => {
    const { currentPreset, customTokens, isCustom } = get()
    if (isCustom) {
      return { ...THEME_TOKENS.reduce((acc, t) => ({ ...acc, [t.key]: t.defaultValue }), {}), ...customTokens }
    }
    const preset = THEME_PRESETS.find(p => p.id === currentPreset)
    return preset?.tokens ?? THEME_PRESETS[0]?.tokens ?? {}
  },

  applyTheme: () => {
    const theme = get().getActiveTheme()
    const root = document.documentElement
    Object.entries(theme).forEach(([key, value]) => {
      root.style.setProperty(`--${key}`, value)
    })
  },

  getSavedTheme: () => {
    try {
      const saved = localStorage.getItem('openfox:theme')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed.preset) {
          return JSON.stringify({ preset: parsed.preset })
        }
        if (parsed.tokens) {
          return JSON.stringify({ tokens: parsed.tokens })
        }
      }
    } catch {
      return null
    }
    return null
  },

  saveTheme: (themeJson: string) => {
    localStorage.setItem('openfox:theme', themeJson)
  },

  clearCustomTheme: () => {
    localStorage.removeItem('openfox:theme')
    set({ isCustom: false })
  },
}))

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