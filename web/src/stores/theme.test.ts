import { describe, it, expect } from 'vitest'
import { THEME_TOKENS, THEME_PRESETS, migrateLegacyThemeSetting, getPresetFromJson } from './theme'

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
})