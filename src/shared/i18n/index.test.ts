import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { t, interpolate, getLocale, setLocale, locales } from './index.js'
import type { Translation } from './index.js'

const originalLocale = getLocale()

beforeEach(() => {
  setLocale('en')
})

afterEach(() => {
  setLocale(originalLocale)
})

describe('locales', () => {
  it('supports exactly en and fr', () => {
    expect(locales).toEqual(['en', 'fr'])
  })

  it('defaults to en', () => {
    expect(getLocale()).toBe('en')
  })

  it('setLocale/getLocale round-trip', () => {
    setLocale('fr')
    expect(getLocale()).toBe('fr')
    setLocale('en')
    expect(getLocale()).toBe('en')
  })
})

describe('t with string entries', () => {
  const greeting = { en: 'Hello', fr: 'Bonjour' } as const satisfies Translation

  it('returns the en entry by default', () => {
    expect(t(greeting)).toBe('Hello')
  })

  it('returns the fr entry when the locale is fr', () => {
    setLocale('fr')
    expect(t(greeting)).toBe('Bonjour')
  })

  it('interpolates named variables', () => {
    const msg = { en: 'Hello {{name}}', fr: 'Bonjour {{name}}' } as const satisfies Translation
    expect(t(msg, { name: 'Conrad' })).toBe('Hello Conrad')
  })

  it('interpolates numeric variables', () => {
    const msg = { en: '{{count}} files', fr: '{{count}} fichiers' } as const satisfies Translation
    expect(t(msg, { count: 3 })).toBe('3 files')
  })

  it('never leaves {{...}} unresolved', () => {
    const msg = { en: 'Found {{count}} results', fr: '{{count}} résultats trouvés' } as const satisfies Translation
    expect(t(msg, { count: 2 })).not.toMatch(/\{\{.*\}\}/)
    expect(t(msg, { count: 2 })).toBe('Found 2 results')
  })
})

describe('t with plural entries', () => {
  const files = {
    en: { one: '{{count}} file', other: '{{count}} files' },
    fr: { one: '{{count}} fichier', other: '{{count}} fichiers' },
  } as const satisfies Translation

  it('picks "one" for count 1 in en', () => {
    expect(t(files, { count: 1 })).toBe('1 file')
  })

  it('picks "other" for count 0 and 2 in en', () => {
    expect(t(files, { count: 0 })).toBe('0 files')
    expect(t(files, { count: 2 })).toBe('2 files')
  })

  it('uses French plural rules in fr', () => {
    setLocale('fr')
    // French CLDR: i = 0,1 → "one" (0 fichier, 1 fichier, 2 fichiers)
    expect(t(files, { count: 0 })).toBe('0 fichier')
    expect(t(files, { count: 1 })).toBe('1 fichier')
    expect(t(files, { count: 2 })).toBe('2 fichiers')
  })

  it('defaults to count 1 when no count is provided', () => {
    expect(t(files)).toBe('1 file')
  })

  it('uses the right plural category for decimals in fr', () => {
    setLocale('fr')
    // 1.5 → integer part 1 → "one" in French
    expect(t(files, { count: 1.5 })).toBe('1.5 fichier')
  })
})

describe('interpolate', () => {
  it('replaces all occurrences of a variable', () => {
    expect(interpolate('{{a}} and {{a}}', { a: 'x' })).toBe('x and x')
  })

  it('leaves messages without variables untouched', () => {
    expect(interpolate('plain', {})).toBe('plain')
  })
})

describe('type safety', () => {
  it('compiles with both locales present', () => {
    const ok = { en: 'yes', fr: 'oui' } as const satisfies Translation
    expect(t(ok)).toBe('yes')
  })

  it('is a compile error to omit fr', () => {
    // @ts-expect-error Translation requires both en and fr
    const missing: Translation = { en: 'only english' }
    expect(missing).toBeDefined()
  })

  it('is a compile error to omit en', () => {
    // @ts-expect-error Translation requires both en and fr
    const missing: Translation = { fr: 'seulement français' }
    expect(missing).toBeDefined()
  })
})
