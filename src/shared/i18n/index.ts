export const locales = ['en', 'fr'] as const
export type Locale = (typeof locales)[number]

export const pluralForms = ['one', 'other'] as const
export type PluralForm = (typeof pluralForms)[number]

export type Translation = { [L in Locale]: string | Record<PluralForm, string> }

let currentLocale: Locale = 'en'

export function getLocale(): Locale {
  return currentLocale
}

export function setLocale(locale: Locale): void {
  currentLocale = locale
}

/**
 * Replace `{{name}}` placeholders with the matching variable. Unknown
 * placeholders are left untouched so a missing variable can never silently
 * hide a broken translation.
 */
export function interpolate(msg: string, vars: Record<string, string | number>): string {
  return msg.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = vars[key]
    return value === undefined ? match : String(value)
  })
}

/**
 * Resolve a translation for the active locale.
 *
 * - string entries are interpolated as-is
 * - plural entries pick the category via `Intl.PluralRules` for the active
 *   locale, using `vars.count` (defaults to 1)
 *
 * Both locales are mandatory at the type level, so there is deliberately no
 * fallback: a missing `fr` entry is a compile error, never a runtime gap.
 */
export function t(tx: Translation, vars?: Record<string, string | number>): string {
  const entry = tx[currentLocale]
  if (typeof entry === 'string') {
    return interpolate(entry, vars ?? {})
  }
  const count = typeof vars?.['count'] === 'number' ? vars['count'] : 1
  const form = new Intl.PluralRules(currentLocale).select(count) as PluralForm
  return interpolate(entry[form], { ...vars, count })
}
