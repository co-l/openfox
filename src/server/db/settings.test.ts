import { beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { closeDatabase, initDatabase } from './index.js'
import {
  SETTINGS_DEFAULTS,
  SETTINGS_KEYS,
  deleteSetting,
  getAllSettings,
  getSetting,
  setSetting,
  validateSettingValue,
} from './settings.js'

describe('db settings', () => {
  beforeEach(() => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
  })

  it('defines and validates cascade cooldown settings', () => {
    expect(SETTINGS_DEFAULTS[SETTINGS_KEYS.MODEL_CASCADE_OVERLOAD_COOLDOWN_MS]).toBe('1200000')
    expect(SETTINGS_DEFAULTS[SETTINGS_KEYS.MODEL_CASCADE_TRANSIENT_COOLDOWN_MS]).toBe('120000')
    expect(validateSettingValue(SETTINGS_KEYS.MODEL_CASCADE_OVERLOAD_COOLDOWN_MS, '60000')).toBeNull()
    expect(validateSettingValue(SETTINGS_KEYS.MODEL_CASCADE_TRANSIENT_COOLDOWN_MS, '-1')).toContain('non-negative')
    expect(validateSettingValue(SETTINGS_KEYS.MODEL_CASCADE_TRANSIENT_COOLDOWN_MS, 'invalid')).toContain('non-negative')
  })

  it('gets, sets, updates, deletes, and lists settings', () => {
    expect(getSetting(SETTINGS_KEYS.GLOBAL_INSTRUCTIONS)).toBeNull()

    setSetting(SETTINGS_KEYS.GLOBAL_INSTRUCTIONS, 'Always test first')
    setSetting('theme', 'dark')
    expect(getSetting(SETTINGS_KEYS.GLOBAL_INSTRUCTIONS)).toBe('Always test first')
    expect(getAllSettings()).toEqual({
      [SETTINGS_KEYS.GLOBAL_INSTRUCTIONS]: 'Always test first',
      theme: 'dark',
    })

    setSetting('theme', 'light')
    expect(getSetting('theme')).toBe('light')

    deleteSetting('theme')
    expect(getSetting('theme')).toBeNull()
    expect(getAllSettings()).toEqual({
      [SETTINGS_KEYS.GLOBAL_INSTRUCTIONS]: 'Always test first',
    })
  })

  describe('search engine settings', () => {
    it('sets and gets SEARCH_ENGINE', () => {
      setSetting(SETTINGS_KEYS.SEARCH_ENGINE, 'tavily')
      expect(getSetting(SETTINGS_KEYS.SEARCH_ENGINE)).toBe('tavily')

      setSetting(SETTINGS_KEYS.SEARCH_ENGINE, 'searxng')
      expect(getSetting(SETTINGS_KEYS.SEARCH_ENGINE)).toBe('searxng')

      setSetting(SETTINGS_KEYS.SEARCH_ENGINE, '')
      expect(getSetting(SETTINGS_KEYS.SEARCH_ENGINE)).toBe('')
    })

    it('sets and gets SEARCH_TAVILY_API_KEY', () => {
      setSetting(SETTINGS_KEYS.SEARCH_TAVILY_API_KEY, 'tvly-test-key-123')
      expect(getSetting(SETTINGS_KEYS.SEARCH_TAVILY_API_KEY)).toBe('tvly-test-key-123')
    })

    it('sets and gets SEARCH_SEARXNG_URL', () => {
      setSetting(SETTINGS_KEYS.SEARCH_SEARXNG_URL, 'http://localhost:4000')
      expect(getSetting(SETTINGS_KEYS.SEARCH_SEARXNG_URL)).toBe('http://localhost:4000')
    })

    it('sets and gets SEARCH_SEARXNG_API_KEY', () => {
      setSetting(SETTINGS_KEYS.SEARCH_SEARXNG_API_KEY, 'sx-secret')
      expect(getSetting(SETTINGS_KEYS.SEARCH_SEARXNG_API_KEY)).toBe('sx-secret')
    })

    it('all four keys are independent', () => {
      setSetting(SETTINGS_KEYS.SEARCH_ENGINE, 'tavily')
      setSetting(SETTINGS_KEYS.SEARCH_TAVILY_API_KEY, 'tvly-key')
      setSetting(SETTINGS_KEYS.SEARCH_SEARXNG_URL, 'http://searxng:4000')
      setSetting(SETTINGS_KEYS.SEARCH_SEARXNG_API_KEY, 'sx-key')

      expect(getSetting(SETTINGS_KEYS.SEARCH_ENGINE)).toBe('tavily')
      expect(getSetting(SETTINGS_KEYS.SEARCH_TAVILY_API_KEY)).toBe('tvly-key')
      expect(getSetting(SETTINGS_KEYS.SEARCH_SEARXNG_URL)).toBe('http://searxng:4000')
      expect(getSetting(SETTINGS_KEYS.SEARCH_SEARXNG_API_KEY)).toBe('sx-key')
    })

    it('returns null for unset keys', () => {
      expect(getSetting(SETTINGS_KEYS.SEARCH_ENGINE)).toBeNull()
      expect(getSetting(SETTINGS_KEYS.SEARCH_TAVILY_API_KEY)).toBeNull()
      expect(getSetting(SETTINGS_KEYS.SEARCH_SEARXNG_URL)).toBeNull()
      expect(getSetting(SETTINGS_KEYS.SEARCH_SEARXNG_API_KEY)).toBeNull()
    })

    it('deletes search engine keys', () => {
      setSetting(SETTINGS_KEYS.SEARCH_ENGINE, 'tavily')
      deleteSetting(SETTINGS_KEYS.SEARCH_ENGINE)
      expect(getSetting(SETTINGS_KEYS.SEARCH_ENGINE)).toBeNull()
    })
  })
})
