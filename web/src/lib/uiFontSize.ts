/**
 * UI (interface) font-size application.
 *
 * The font size is a display setting persisted server-side
 * (`display.uiFontSize`, the root element font size in px). It also keeps a
 * localStorage mirror so it can be applied synchronously before auth,
 * avoiding a flash of the default size — the same dual pattern as the theme
 * (`openfox:theme`) and the UI font (`openfox:uiFont`). The server value is
 * the source of truth; the mirror only exists for the pre-auth window and is
 * refreshed whenever the server value changes.
 */

export const UI_FONT_SIZE_STORAGE_KEY = 'openfox:uiFontSize'

/** Browser default root font size — the "Default" option restores it. */
export const UI_FONT_SIZE_DEFAULT_PX = 16

/** Slider bounds: 87.5%–125% of the default, in 1px steps (6.25%). */
export const UI_FONT_SIZE_MIN_PX = 14
export const UI_FONT_SIZE_MAX_PX = 20

/** Parse a stored size (px string). Returns null when empty or invalid. */
export function parseUiFontSize(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const px = Number(trimmed)
  if (!Number.isFinite(px) || px <= 0) return null
  return px
}

/**
 * Set (or clear) the root element font-size. A non-default px value scales all
 * rem-based surfaces (text, code blocks, diffs, terminal); an empty/invalid
 * value removes the override, letting the browser default (16px) apply.
 */
export function applyUiFontSize(value: string | null | undefined): void {
  if (typeof document === 'undefined') return
  const px = parseUiFontSize(value)
  const root = document.documentElement
  if (px === null) {
    root.style.removeProperty('font-size')
  } else {
    root.style.setProperty('font-size', `${px}px`)
  }
}

/** Read and apply the localStorage-mirrored size. Call before the first paint. */
export function applyStoredUiFontSize(): void {
  if (typeof window === 'undefined') return
  try {
    applyUiFontSize(window.localStorage.getItem(UI_FONT_SIZE_STORAGE_KEY))
  } catch {
    applyUiFontSize(null)
  }
}

/** Persist the size to the localStorage mirror. Empty clears the mirror. */
export function storeUiFontSize(value: string | null | undefined): void {
  if (typeof window === 'undefined') return
  try {
    const trimmed = (value ?? '').trim()
    if (trimmed === '') {
      window.localStorage.removeItem(UI_FONT_SIZE_STORAGE_KEY)
    } else {
      window.localStorage.setItem(UI_FONT_SIZE_STORAGE_KEY, trimmed)
    }
  } catch {
    // ignore
  }
}
