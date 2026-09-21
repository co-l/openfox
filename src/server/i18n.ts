import { t, getLocale, setLocale, type Locale, type Translation } from '../shared/i18n/index.js'
import { getSetting, SETTINGS_KEYS } from './db/settings.js'

/**
 * Resolve the locale the server should emit user-facing strings in.
 * Reads the DB `display.locale` setting; 'automatic' (the default) falls
 * back to 'en' because the server cannot know the browser language.
 */
function resolveLocale(): Locale {
  return getSetting(SETTINGS_KEYS.DISPLAY_LOCALE) === 'fr' ? 'fr' : 'en'
}

/**
 * Server-side translation helper for user-facing strings (tool result
 * summaries/errors, chat notices, route validation messages). The locale is
 * DB-driven: 'automatic' resolves to 'en', so only users who explicitly pick
 * a language see translated server output.
 */
export function serverT(tx: Translation, vars?: Record<string, string | number>): string {
  const locale = resolveLocale()
  if (getLocale() !== locale) setLocale(locale)
  return t(tx, vars)
}
