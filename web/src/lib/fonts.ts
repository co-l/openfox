export const GENERIC_FONT_FAMILIES = ['monospace', 'serif', 'sans-serif'] as const

/**
 * Ordered fallback stack used as the terminal default.
 *
 * No font is bundled with OpenFox, so the default must only reference families
 * that ship with an OS: Menlo/Monaco (macOS), Consolas/Cascadia Mono (Windows),
 * DejaVu/Liberation/Ubuntu Mono (Linux). Nicer fonts come first and are used
 * when the user happens to have them installed.
 */
export const DEFAULT_TERMINAL_FONT_STACK: string[] = [
  'JetBrains Mono',
  'Cascadia Mono',
  'Menlo',
  'Consolas',
  'DejaVu Sans Mono',
  'Liberation Mono',
]

export const DEFAULT_TERMINAL_FONT = `${DEFAULT_TERMINAL_FONT_STACK.map((f) => `"${f}"`).join(', ')}, monospace`

export const MONOSPACE_FONT_CANDIDATES: string[] = [
  'Andale Mono',
  'Anonymous Pro',
  'Cascadia Code',
  'Cascadia Mono',
  'Consolas',
  'Courier New',
  'DejaVu Sans Mono',
  'Fira Code',
  'Fira Mono',
  'Geist Mono',
  'Hack',
  'IBM Plex Mono',
  'Inconsolata',
  'Iosevka',
  'JetBrains Mono',
  'Liberation Mono',
  'Menlo',
  'Monaco',
  'Noto Sans Mono',
  'Roboto Mono',
  'SF Mono',
  'Source Code Pro',
  'Space Mono',
  'Ubuntu Mono',
  'Victor Mono',
  'CaskaydiaCove Nerd Font',
  'CaskaydiaCove Nerd Font Mono',
  'DejaVuSansMono Nerd Font',
  'FiraCode Nerd Font',
  'FiraCode Nerd Font Mono',
  'Hack Nerd Font',
  'Hack Nerd Font Mono',
  'Iosevka Nerd Font',
  'JetBrainsMono Nerd Font',
  'JetBrainsMono Nerd Font Mono',
  'MesloLGS NF',
  'MesloLGS Nerd Font',
  'SauceCodePro Nerd Font',
  'SauceCodePro Nerd Font Mono',
  'UbuntuMono Nerd Font',
]

const TEST_STRING = 'mmmmmmmmmmlliWWWW@0Oo'
const TEST_SIZE = '72px'

export type MeasureFont = (fontFamily: string) => number

let cachedContext: CanvasRenderingContext2D | null | undefined

function getContext(): CanvasRenderingContext2D | null {
  if (cachedContext !== undefined) return cachedContext
  try {
    cachedContext = document.createElement('canvas').getContext('2d')
  } catch {
    cachedContext = null
  }
  return cachedContext
}

export function measureWithCanvas(fontFamily: string): number {
  const ctx = getContext()
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.font = `${TEST_SIZE} ${fontFamily}`
  return ctx.measureText(TEST_STRING).width
}

export function isFontAvailable(family: string, measure: MeasureFont = measureWithCanvas): boolean {
  const trimmed = family.trim()
  if (!trimmed) return false

  try {
    return GENERIC_FONT_FAMILIES.some((generic) => {
      const baseline = measure(generic)
      const candidate = measure(`"${trimmed}", ${generic}`)
      return candidate !== baseline
    })
  } catch {
    return false
  }
}

export function detectAvailableFonts(
  candidates: string[] = MONOSPACE_FONT_CANDIDATES,
  measure: MeasureFont = measureWithCanvas,
): string[] {
  const found = new Set<string>()
  for (const candidate of candidates) {
    if (isFontAvailable(candidate, measure)) {
      found.add(candidate)
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b))
}

export function resolveDefaultFamily(
  stack: string[] = DEFAULT_TERMINAL_FONT_STACK,
  measure: MeasureFont = measureWithCanvas,
): string {
  return stack.find((family) => isFontAvailable(family, measure)) ?? ''
}

export function toFontFamilyValue(family: string): string {
  const trimmed = family.trim()
  if (!trimmed) return ''
  return `"${trimmed}", monospace`
}

export function extractPrimaryFamily(fontFamilyValue: string): string {
  const first = fontFamilyValue.split(',')[0]?.trim() ?? ''
  return first.replace(/^['"]|['"]$/g, '')
}
