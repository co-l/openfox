import { describe, it, expect } from 'vitest'
import {
  MONOSPACE_FONT_CANDIDATES,
  GENERIC_FONT_FAMILIES,
  DEFAULT_TERMINAL_FONT,
  DEFAULT_TERMINAL_FONT_STACK,
  isFontAvailable,
  detectAvailableFonts,
  resolveDefaultFamily,
  toFontFamilyValue,
  extractPrimaryFamily,
} from './fonts'

function fakeMeasure(installed: string[]) {
  return (family: string) => {
    const primary = family.split(',')[0]?.trim().replace(/^"|"$/g, '') ?? ''
    if (GENERIC_FONT_FAMILIES.includes(primary as (typeof GENERIC_FONT_FAMILIES)[number])) {
      return 100
    }
    return installed.includes(primary) ? 137 : 100
  }
}

describe('isFontAvailable', () => {
  it('returns true when the measured width differs from the generic fallback', () => {
    expect(isFontAvailable('Hack', fakeMeasure(['Hack']))).toBe(true)
  })

  it('returns false when the width matches the generic fallback (font substituted)', () => {
    expect(isFontAvailable('Nonexistent Font', fakeMeasure(['Hack']))).toBe(false)
  })

  it('returns false for an empty family name', () => {
    expect(isFontAvailable('', fakeMeasure(['Hack']))).toBe(false)
  })

  it('returns false when the measure function throws', () => {
    const throwing = () => {
      throw new Error('no canvas')
    }
    expect(isFontAvailable('Hack', throwing)).toBe(false)
  })
})

describe('detectAvailableFonts', () => {
  it('keeps only the installed candidates', () => {
    const result = detectAvailableFonts(['Hack', 'Fira Code', 'Ghost Font'], fakeMeasure(['Hack', 'Fira Code']))
    expect(result).toEqual(['Fira Code', 'Hack'])
  })

  it('deduplicates repeated candidates', () => {
    const result = detectAvailableFonts(['Hack', 'Hack'], fakeMeasure(['Hack']))
    expect(result).toEqual(['Hack'])
  })

  it('returns results sorted alphabetically', () => {
    const result = detectAvailableFonts(['Zed Mono', 'Alpha Mono'], fakeMeasure(['Zed Mono', 'Alpha Mono']))
    expect(result).toEqual(['Alpha Mono', 'Zed Mono'])
  })

  it('returns an empty array when nothing is installed', () => {
    expect(detectAvailableFonts(['Ghost Font'], fakeMeasure([]))).toEqual([])
  })

  it('returns an empty array instead of throwing when measuring is unavailable', () => {
    const throwing = () => {
      throw new Error('no canvas')
    }
    expect(detectAvailableFonts(['Hack'], throwing)).toEqual([])
  })

  it('defaults to the curated candidate list', () => {
    const result = detectAvailableFonts(undefined, fakeMeasure(['Menlo']))
    expect(result).toEqual(['Menlo'])
  })
})

describe('MONOSPACE_FONT_CANDIDATES', () => {
  it('contains no duplicates', () => {
    expect(new Set(MONOSPACE_FONT_CANDIDATES).size).toBe(MONOSPACE_FONT_CANDIDATES.length)
  })

  it('includes common Nerd Font variants', () => {
    expect(MONOSPACE_FONT_CANDIDATES).toContain('MesloLGS NF')
    expect(MONOSPACE_FONT_CANDIDATES).toContain('JetBrainsMono Nerd Font')
  })
})

describe('toFontFamilyValue', () => {
  it('quotes the family and appends the monospace fallback', () => {
    expect(toFontFamilyValue('Fira Code')).toBe('"Fira Code", monospace')
  })

  it('trims surrounding whitespace', () => {
    expect(toFontFamilyValue('  Hack  ')).toBe('"Hack", monospace')
  })

  it('returns an empty string for a blank family', () => {
    expect(toFontFamilyValue('   ')).toBe('')
  })
})

describe('DEFAULT_TERMINAL_FONT', () => {
  it('ends with the generic monospace fallback so it always resolves to something', () => {
    expect(DEFAULT_TERMINAL_FONT.endsWith('monospace')).toBe(true)
  })

  it('lists several families to cover macOS, Windows and Linux', () => {
    expect(DEFAULT_TERMINAL_FONT_STACK.length).toBeGreaterThan(1)
  })

  it('covers each major platform with at least one preinstalled font', () => {
    const macOS = ['Menlo', 'Monaco', 'SF Mono']
    const windows = ['Consolas', 'Cascadia Mono', 'Cascadia Code']
    const linux = ['DejaVu Sans Mono', 'Liberation Mono', 'Ubuntu Mono', 'Noto Sans Mono']

    for (const platform of [macOS, windows, linux]) {
      expect(platform.some((font) => DEFAULT_TERMINAL_FONT_STACK.includes(font))).toBe(true)
    }
  })

  it('only references families present in the candidate list', () => {
    for (const family of DEFAULT_TERMINAL_FONT_STACK) {
      expect(MONOSPACE_FONT_CANDIDATES).toContain(family)
    }
  })
})

describe('resolveDefaultFamily', () => {
  it('returns the first installed family of the default stack', () => {
    const measure = fakeMeasure(['Consolas', 'DejaVu Sans Mono'])
    const resolved = resolveDefaultFamily(['Menlo', 'Consolas', 'DejaVu Sans Mono'], measure)
    expect(resolved).toBe('Consolas')
  })

  it('respects the declared order of preference', () => {
    const measure = fakeMeasure(['Menlo', 'Consolas'])
    expect(resolveDefaultFamily(['Menlo', 'Consolas'], measure)).toBe('Menlo')
  })

  it('returns an empty string when no family of the stack is installed', () => {
    expect(resolveDefaultFamily(['Menlo', 'Consolas'], fakeMeasure([]))).toBe('')
  })

  it('returns an empty string when measuring is unavailable', () => {
    const throwing = () => {
      throw new Error('no canvas')
    }
    expect(resolveDefaultFamily(['Menlo'], throwing)).toBe('')
  })
})

describe('extractPrimaryFamily', () => {
  it('extracts the first family from a CSS font stack', () => {
    expect(extractPrimaryFamily('"JetBrains Mono", monospace')).toBe('JetBrains Mono')
  })

  it('handles unquoted families', () => {
    expect(extractPrimaryFamily('Menlo, monospace')).toBe('Menlo')
  })

  it('handles single quotes', () => {
    expect(extractPrimaryFamily("'Fira Code', monospace")).toBe('Fira Code')
  })

  it('returns an empty string for empty input', () => {
    expect(extractPrimaryFamily('')).toBe('')
  })
})
