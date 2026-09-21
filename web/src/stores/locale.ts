import { create } from 'zustand'
import { setLocale, locales } from '@shared/i18n/index.js'
import type { Locale } from '@shared/i18n/index.js'

/**
 * Resolve the stored locale setting to a concrete `Locale`.
 *
 * - explicit 'en' | 'fr' → used as-is
 * - 'automatic' (or anything unknown) → the browser's `navigator.language`
 *   primary tag, clamped to the supported locales, falling back to 'en'
 */
export function resolveLocale(setting: string | undefined): Locale {
  if (setting === 'en' || setting === 'fr') return setting
  if (typeof navigator === 'undefined') return 'en'
  const primary = navigator.language.split('-')[0]?.toLowerCase() ?? ''
  return (locales as readonly string[]).includes(primary) ? (primary as Locale) : 'en'
}

interface LocaleState {
  locale: Locale
  applyLocale: (setting: string | undefined) => void
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: resolveLocale(undefined),
  applyLocale: (setting) => {
    const locale = resolveLocale(setting)
    setLocale(locale)
    set({ locale })
  },
}))
