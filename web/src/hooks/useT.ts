import { t } from '@shared/i18n/index.js'
import { useLocaleStore } from '../stores/locale'

/**
 * Returns the shared `t` bound to the active locale, subscribing to the
 * locale store so the component re-renders when the locale changes.
 *
 * Plain `t` (imported directly from the shared i18n module) works anywhere;
 * use this hook only where locale-change re-rendering matters.
 */
export function useT() {
  useLocaleStore((state) => state.locale)
  return t
}
