import { useCallback } from 'react'
import { useLocaleStore } from '../stores/locale'
import type { LocalizedString } from '@shared/plugin.js'

/**
 * Resolve plugin-supplied localized strings ({ en, fr }) against the active
 * locale. Plugins ship both languages; the UI never falls back silently.
 */
export function useLocalizedString(): (value: LocalizedString) => string {
  const locale = useLocaleStore((state) => state.locale)
  return useCallback((value: LocalizedString) => (locale === 'fr' ? value.fr : value.en), [locale])
}
