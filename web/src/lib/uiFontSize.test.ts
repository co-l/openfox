/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  UI_FONT_SIZE_STORAGE_KEY,
  UI_FONT_SIZE_DEFAULT_PX,
  parseUiFontSize,
  applyUiFontSize,
  applyStoredUiFontSize,
  storeUiFontSize,
} from './uiFontSize'

describe('uiFontSize constants', () => {
  it('the default root size is the browser default of 16px', () => {
    expect(UI_FONT_SIZE_DEFAULT_PX).toBe(16)
  })
})

describe('parseUiFontSize', () => {
  it('parses a px value, including surrounding whitespace', () => {
    expect(parseUiFontSize('18')).toBe(18)
    expect(parseUiFontSize(' 18 ')).toBe(18)
  })

  it('returns null for empty or invalid values', () => {
    expect(parseUiFontSize('')).toBeNull()
    expect(parseUiFontSize('   ')).toBeNull()
    expect(parseUiFontSize(null)).toBeNull()
    expect(parseUiFontSize(undefined)).toBeNull()
    expect(parseUiFontSize('abc')).toBeNull()
    expect(parseUiFontSize('-1')).toBeNull()
    expect(parseUiFontSize('0')).toBeNull()
  })
})

describe('applyUiFontSize', () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty('font-size')
  })

  it('sets the root font-size in px', () => {
    applyUiFontSize('18')
    expect(document.documentElement.style.fontSize).toBe('18px')
  })

  it('removes the override for empty or invalid values', () => {
    applyUiFontSize('18')
    applyUiFontSize('')
    expect(document.documentElement.style.fontSize).toBe('')
    applyUiFontSize('abc')
    expect(document.documentElement.style.fontSize).toBe('')
  })
})

describe('storeUiFontSize', () => {
  beforeEach(() => {
    window.localStorage.removeItem(UI_FONT_SIZE_STORAGE_KEY)
  })

  it('persists non-empty values to the mirror', () => {
    storeUiFontSize('18')
    expect(window.localStorage.getItem(UI_FONT_SIZE_STORAGE_KEY)).toBe('18')
  })

  it('clears the mirror for empty values', () => {
    storeUiFontSize('18')
    storeUiFontSize('')
    expect(window.localStorage.getItem(UI_FONT_SIZE_STORAGE_KEY)).toBeNull()
  })
})

describe('applyStoredUiFontSize', () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty('font-size')
    window.localStorage.removeItem(UI_FONT_SIZE_STORAGE_KEY)
  })

  it('applies the mirrored size', () => {
    window.localStorage.setItem(UI_FONT_SIZE_STORAGE_KEY, '18')
    applyStoredUiFontSize()
    expect(document.documentElement.style.fontSize).toBe('18px')
  })

  it('leaves the default when the mirror is absent', () => {
    applyStoredUiFontSize()
    expect(document.documentElement.style.fontSize).toBe('')
  })
})
