import { beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { closeDatabase, initDatabase } from './index.js'
import { SETTINGS_KEYS, deleteSetting, getAllSettings, getSetting, setSetting } from './settings.js'

describe('db settings', () => {
  beforeEach(() => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
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
})
