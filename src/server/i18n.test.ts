import { beforeEach, describe, expect, it } from 'vitest'
import { getLocale } from '../shared/i18n/index.js'
import { loadConfig } from './config.js'
import { closeDatabase, initDatabase } from './db/index.js'
import { SETTINGS_KEYS, setSetting } from './db/settings.js'
import { serverT } from './i18n.js'

describe('serverT', () => {
  beforeEach(() => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
  })

  it('falls back to English when locale is unset (automatic default)', () => {
    expect(serverT({ en: 'File not found', fr: 'Fichier introuvable' })).toBe('File not found')
    expect(getLocale()).toBe('en')
  })

  it('renders French when display.locale is fr', () => {
    setSetting(SETTINGS_KEYS.DISPLAY_LOCALE, 'fr')
    expect(serverT({ en: 'File not found', fr: 'Fichier introuvable' })).toBe('Fichier introuvable')
    expect(getLocale()).toBe('fr')
  })

  it('renders English when display.locale is en', () => {
    setSetting(SETTINGS_KEYS.DISPLAY_LOCALE, 'en')
    expect(serverT({ en: 'File not found', fr: 'Fichier introuvable' })).toBe('File not found')
  })

  it('interpolates variables', () => {
    setSetting(SETTINGS_KEYS.DISPLAY_LOCALE, 'fr')
    expect(serverT({ en: 'Added item "{{id}}"', fr: 'Élément « {{id}} » ajouté' }, { id: 'c1' })).toBe(
      'Élément « c1 » ajouté',
    )
  })

  it('selects plural forms from the active locale', () => {
    setSetting(SETTINGS_KEYS.DISPLAY_LOCALE, 'fr')
    const tx = {
      en: { one: '{{count}} item', other: '{{count}} items' },
      fr: { one: '{{count}} élément', other: '{{count}} éléments' },
    }
    expect(serverT(tx, { count: 1 })).toBe('1 élément')
    expect(serverT(tx, { count: 2 })).toBe('2 éléments')
  })
})
