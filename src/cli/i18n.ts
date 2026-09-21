import Database from 'better-sqlite3'
import { t, getLocale, setLocale, type Locale, type Translation } from '../shared/i18n/index.js'
import { getDatabasePath } from './paths.js'
import type { Mode } from './main.js'

let mode: Mode | null = null
let resolved: Locale | null = null

/**
 * Bind the CLI process to a mode so cliT() reads the locale from the matching
 * database. Called once at the CLI entry point; every command flows through it.
 */
export function setCliMode(value: Mode): void {
  mode = value
  resolved = null
}

/**
 * Resolve the CLI locale from the DB `display.locale` setting. Only an
 * explicit 'fr' yields French; anything else (including a missing/unreadable
 * database) falls back to English.
 */
function resolveLocale(): Locale {
  if (resolved) return resolved
  let locale: Locale = 'en'
  try {
    if (!mode) return 'en'
    const db = new Database(getDatabasePath(mode), { readonly: true })
    try {
      const row = db.prepare(`SELECT value FROM settings WHERE key = 'display.locale'`).get() as
        { value: string } | undefined
      if (row?.value === 'fr') locale = 'fr'
    } finally {
      db.close()
    }
  } catch {
    // Database unavailable (fresh install, locked, etc.) — fall back to English.
  }
  resolved = locale
  return locale
}

/**
 * CLI translation helper. The locale is DB-driven: 'automatic' (default)
 * resolves to 'en', so only users who explicitly pick a language see
 * translated CLI output.
 */
export function cliT(tx: Translation, vars?: Record<string, string | number>): string {
  const locale = resolveLocale()
  if (getLocale() !== locale) setLocale(locale)
  return t(tx, vars)
}
