/**
 * UI (interface) font application.
 *
 * The UI font is a display setting persisted server-side (`display.uiFont`). It
 * also keeps a localStorage mirror so it can be applied synchronously before
 * auth, avoiding a flash of the default font — the same dual pattern as the
 * theme (`openfox:theme`). The server value is the source of truth; the mirror
 * only exists for the pre-auth window and is refreshed whenever the server
 * value changes.
 */

export const UI_FONT_STORAGE_KEY = 'openfox:uiFont'

/**
 * Set (or clear) the `--font-ui` CSS custom property on the root element.
 * An empty/whitespace value removes it, letting the `:root` default
 * (the monospace stack) apply.
 */
export function applyUiFont(fontFamily: string | null | undefined): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const trimmed = (fontFamily ?? '').trim()
  if (trimmed) {
    root.style.setProperty('--font-ui', trimmed)
  } else {
    root.style.removeProperty('--font-ui')
  }
}

/** Read and apply the localStorage-mirrored UI font. Call before the first paint. */
export function applyStoredUiFont(): void {
  if (typeof window === 'undefined') return
  try {
    applyUiFont(window.localStorage.getItem(UI_FONT_STORAGE_KEY) ?? '')
  } catch {
    applyUiFont('')
  }
}

/** Persist the UI font to the localStorage mirror. Empty clears the mirror. */
export function storeUiFont(fontFamily: string | null | undefined): void {
  if (typeof window === 'undefined') return
  try {
    const trimmed = (fontFamily ?? '').trim()
    if (trimmed) {
      window.localStorage.setItem(UI_FONT_STORAGE_KEY, trimmed)
    } else {
      window.localStorage.removeItem(UI_FONT_STORAGE_KEY)
    }
  } catch {
    // ignore
  }
}
