import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const TEST_DIR = join(tmpdir(), `openfox-cli-i18n-test-${Date.now()}`)

vi.mock('./paths.js', () => ({
  getDatabasePath: (mode: string) => join(TEST_DIR, mode, 'sessions.db'),
}))

const TX = {
  en: 'Hello {{name}}',
  fr: 'Bonjour {{name}}',
}

describe('cli i18n', () => {
  let cliT: typeof import('./i18n.js').cliT
  let setCliMode: typeof import('./i18n.js').setCliMode

  beforeEach(async () => {
    vi.resetModules()
    ;({ cliT, setCliMode } = await import('./i18n.js'))
    await mkdir(join(TEST_DIR, 'production'), { recursive: true })
  })

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  function seedLocale(locale: string): void {
    const db = new Database(join(TEST_DIR, 'production', 'sessions.db'))
    db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('display.locale', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(locale, new Date().toISOString())
    db.close()
  }

  it('defaults to English when the database has no locale setting', () => {
    setCliMode('production')
    expect(cliT(TX, { name: 'World' })).toBe('Hello World')
  })

  it('defaults to English when the database is missing', () => {
    setCliMode('development')
    expect(cliT(TX, { name: 'World' })).toBe('Hello World')
  })

  it('keeps English output byte-identical to the en entry', () => {
    seedLocale('automatic')
    setCliMode('production')
    expect(cliT(TX, { name: 'World' })).toBe('Hello World')
  })

  it('uses French when display.locale is fr', () => {
    seedLocale('fr')
    setCliMode('production')
    expect(cliT(TX, { name: 'Monde' })).toBe('Bonjour Monde')
  })

  it('interpolates variables and leaves unknown placeholders untouched', () => {
    seedLocale('fr')
    setCliMode('production')
    expect(cliT({ en: 'Value: {{missing}}', fr: 'Valeur : {{missing}}' })).toBe('Valeur : {{missing}}')
  })
})
