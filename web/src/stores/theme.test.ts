import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  THEME_TOKENS,
  THEME_PRESETS,
  migrateLegacyThemeSetting,
  getPresetFromJson,
  useThemeStore,
} from './theme'

describe('Theme System', () => {
  describe('THEME_TOKENS', () => {
    it('has all required categories', () => {
      const categories = new Set(THEME_TOKENS.map(t => t.category))
      expect(categories.has('background')).toBe(true)
      expect(categories.has('text')).toBe(true)
      expect(categories.has('accent')).toBe(true)
      expect(categories.has('border')).toBe(true)
    })

    it('each token has a default value', () => {
      THEME_TOKENS.forEach(token => {
        expect(token.defaultValue).toBeTruthy()
        expect(token.defaultValue).toMatch(/^[\d ]+$/)
      })
    })
  })

  describe('THEME_PRESETS', () => {
    it('has required presets', () => {
      const presetIds = THEME_PRESETS.map(p => p.id)
      expect(presetIds).toContain('dark')
      expect(presetIds).toContain('light')
      expect(presetIds).toContain('monokai')
      expect(presetIds).toContain('dracula')
      expect(presetIds).toContain('nord')
    })

    it('each preset has all tokens', () => {
      THEME_PRESETS.forEach(preset => {
        THEME_TOKENS.forEach(token => {
          expect(preset.tokens[token.key]).toBeTruthy()
        })
      })
    })
  })

  describe('migrateLegacyThemeSetting', () => {
    it('converts dark to preset', () => {
      const result = migrateLegacyThemeSetting('dark')
      expect(JSON.parse(result)).toEqual({ preset: 'dark' })
    })

    it('converts light to preset', () => {
      const result = migrateLegacyThemeSetting('light')
      expect(JSON.parse(result)).toEqual({ preset: 'light' })
    })

    it('defaults to dark for unknown values', () => {
      const result = migrateLegacyThemeSetting('unknown')
      expect(JSON.parse(result)).toEqual({ preset: 'dark' })
    })

    it('defaults to dark for undefined', () => {
      const result = migrateLegacyThemeSetting(undefined)
      expect(JSON.parse(result)).toEqual({ preset: 'dark' })
    })
  })

  describe('getPresetFromJson', () => {
    it('extracts preset from JSON', () => {
      const result = getPresetFromJson(JSON.stringify({ preset: 'monokai' }))
      expect(result).toBe('monokai')
    })

    it('returns null for tokens JSON', () => {
      const result = getPresetFromJson(JSON.stringify({ tokens: {} }))
      expect(result).toBeNull()
    })

    it('returns null for invalid JSON', () => {
      const result = getPresetFromJson('invalid')
      expect(result).toBeNull()
    })

    it('returns null for null input', () => {
      const result = getPresetFromJson(null)
      expect(result).toBeNull()
    })
  })

  describe('useThemeStore', () => {
    beforeEach(() => {
      useThemeStore.getState().reset()
      localStorage.removeItem('openfox:theme')
      localStorage.removeItem('openfox:userPresets')
    })

    afterEach(() => {
      useThemeStore.getState().reset()
      localStorage.removeItem('openfox:theme')
      localStorage.removeItem('openfox:userPresets')
    })

    describe('basePreset tracking', () => {
      it('preserves basePreset when customizing from a preset', () => {
        useThemeStore.getState().applyPreset('dracula')
        useThemeStore.getState().startCustomizing()
        const state = useThemeStore.getState()
        expect(state.basePreset).toBe('dracula')
        expect(state.isCustomizing).toBe(true)
      })

      it('getActiveTheme uses basePreset as foundation when customizing', () => {
        useThemeStore.getState().applyPreset('dracula')
        useThemeStore.getState().startCustomizing()
        useThemeStore.getState().setCustomToken('color-accent-primary', '255 0 0')
        const active = useThemeStore.getState().getActiveTheme()
        expect(active['color-accent-primary']).toBe('255 0 0')
        expect(active['color-bg-primary']).toBe('40 42 54')
      })

      it('clears basePreset when applying a new preset', () => {
        useThemeStore.getState().applyPreset('dracula')
        useThemeStore.getState().startCustomizing()
        useThemeStore.getState().applyPreset('nord')
        const state = useThemeStore.getState()
        expect(state.isCustomizing).toBe(false)
        expect(state.basePreset).toBe('')
      })
    })

    describe('userPresets', () => {
      it('starts with empty user presets', () => {
        const presets = useThemeStore.getState().userPresets
        expect(presets).toEqual([])
      })

      it('can add a user preset', () => {
        useThemeStore.getState().applyPreset('dark')
        useThemeStore.getState().startCustomizing()
        useThemeStore.getState().setCustomToken('color-accent-primary', '255 0 0')
        useThemeStore.getState().addUserPreset('My Red Theme')
        const presets = useThemeStore.getState().userPresets
        expect(presets.length).toBe(1)
        expect(presets[0]?.name).toBe('My Red Theme')
        expect(presets[0]?.basePreset).toBe('dark')
        expect(presets[0]?.tokens['color-accent-primary']).toBe('255 0 0')
      })

      it('can apply a user preset', () => {
        useThemeStore.getState().applyPreset('dark')
        useThemeStore.getState().startCustomizing()
        useThemeStore.getState().setCustomToken('color-accent-primary', '255 0 0')
        useThemeStore.getState().addUserPreset('My Red Theme')
        useThemeStore.getState().applyPreset('light')
        useThemeStore.getState().applyUserPreset(0)
        const state = useThemeStore.getState()
        expect(state.isCustom).toBe(true)
        expect(state.getActiveTheme()['color-accent-primary']).toBe('255 0 0')
      })

      it('can delete a user preset', () => {
        useThemeStore.getState().applyPreset('dark')
        useThemeStore.getState().startCustomizing()
        useThemeStore.getState().addUserPreset('Test')
        useThemeStore.getState().deleteUserPreset(0)
        expect(useThemeStore.getState().userPresets.length).toBe(0)
      })

      it('persists user presets to localStorage', () => {
        useThemeStore.getState().applyPreset('dark')
        useThemeStore.getState().startCustomizing()
        useThemeStore.getState().addUserPreset('Saved')
        const saved = localStorage.getItem('openfox:userPresets')
        expect(saved).toBeTruthy()
        const parsed = JSON.parse(saved ?? '[]')
        expect(parsed[0].name).toBe('Saved')
      })

      it('loads user presets from localStorage', () => {
        localStorage.setItem(
          'openfox:userPresets',
          JSON.stringify([{ id: 'custom-1', name: 'Loaded', basePreset: 'dark', tokens: { 'color-accent-primary': '100 100 100' } }])
        )
        useThemeStore.getState().loadUserPresets()
        const presets = useThemeStore.getState().userPresets
        expect(presets.length).toBe(1)
        expect(presets[0]?.name).toBe('Loaded')
      })
    })

    describe('customizing workflow', () => {
      it('startCustomizing sets isCustomizing and isCustom', () => {
        useThemeStore.getState().applyPreset('monokai')
        useThemeStore.getState().startCustomizing()
        const state = useThemeStore.getState()
        expect(state.isCustomizing).toBe(true)
        expect(state.isCustom).toBe(true)
      })

      it('setCustomToken updates customTokens', () => {
        useThemeStore.getState().applyPreset('dark')
        useThemeStore.getState().startCustomizing()
        useThemeStore.getState().setCustomToken('color-border', '255 255 255')
        expect(useThemeStore.getState().customTokens['color-border']).toBe('255 255 255')
      })

      it('cancelCustomizing restores preset', () => {
        useThemeStore.getState().applyPreset('dracula')
        useThemeStore.getState().startCustomizing()
        useThemeStore.getState().setCustomToken('color-accent-primary', '0 0 0')
        useThemeStore.getState().cancelCustomizing()
        const state = useThemeStore.getState()
        expect(state.isCustomizing).toBe(false)
        expect(state.isCustom).toBe(false)
        expect(state.currentPreset).toBe('dracula')
      })

      it('saveCustomTheme saves to localStorage and stops customizing', () => {
        useThemeStore.getState().applyPreset('dark')
        useThemeStore.getState().startCustomizing()
        useThemeStore.getState().setCustomToken('color-accent-primary', '255 0 0')
        useThemeStore.getState().saveCustomTheme()
        const state = useThemeStore.getState()
        expect(state.isCustomizing).toBe(false)
        expect(state.isCustom).toBe(true)
        const saved = JSON.parse(localStorage.getItem('openfox:theme') ?? '{}')
        expect(saved.tokens['color-accent-primary']).toBe('255 0 0')
      })
    })

    describe('backwards compatibility', () => {
      it('loads legacy custom theme tokens (no basePreset)', () => {
        localStorage.setItem(
          'openfox:theme',
          JSON.stringify({ tokens: { 'color-accent-primary': '999 0 0' } })
        )
        const saved = useThemeStore.getState().getSavedTheme()
        expect(saved).toBeTruthy()
        const parsed = JSON.parse(saved!)
        expect(parsed.tokens['color-accent-primary']).toBe('999 0 0')
      })

      it('loads legacy preset theme', () => {
        localStorage.setItem('openfox:theme', JSON.stringify({ preset: 'nord' }))
        const saved = useThemeStore.getState().getSavedTheme()
        expect(saved).toBeTruthy()
        const parsed = JSON.parse(saved!)
        expect(parsed.preset).toBe('nord')
      })
    })
  })
})
