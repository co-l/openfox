// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { getLocale, setLocale } from '@shared/i18n/index.js'
import { resolveLocale, useLocaleStore } from './locale'
import { useT } from '../hooks/useT'

beforeEach(() => {
  setLocale('en')
  useLocaleStore.setState({ locale: resolveLocale(undefined) })
  vi.restoreAllMocks()
})

describe('resolveLocale', () => {
  it('passes explicit locales through', () => {
    expect(resolveLocale('en')).toBe('en')
    expect(resolveLocale('fr')).toBe('fr')
  })

  it('resolves automatic from navigator.language', () => {
    const original = navigator.language
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'fr-FR' })
    expect(resolveLocale('automatic')).toBe('fr')
    expect(resolveLocale(undefined)).toBe('fr')
    Object.defineProperty(navigator, 'language', { configurable: true, value: original })
  })

  it('clamps unsupported navigator languages to en', () => {
    const original = navigator.language
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'de-DE' })
    expect(resolveLocale('automatic')).toBe('en')
    Object.defineProperty(navigator, 'language', { configurable: true, value: original })
  })

  it('defaults to en outside a browser', () => {
    const original = globalThis.navigator
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined })
    expect(resolveLocale(undefined)).toBe('en')
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: original })
  })
})

describe('useLocaleStore', () => {
  it('applies the shared locale when changed', () => {
    useLocaleStore.getState().applyLocale('fr')
    expect(getLocale()).toBe('fr')
    expect(useLocaleStore.getState().locale).toBe('fr')
    useLocaleStore.getState().applyLocale('en')
    expect(getLocale()).toBe('en')
  })

  it('applies automatic using the browser language', () => {
    const original = navigator.language
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'fr' })
    useLocaleStore.getState().applyLocale('automatic')
    expect(getLocale()).toBe('fr')
    Object.defineProperty(navigator, 'language', { configurable: true, value: original })
  })
})

describe('useT', () => {
  it('returns the shared t function', () => {
    const { result } = renderHook(() => useT())
    expect(result.current({ en: 'hello', fr: 'bonjour' })).toBe('hello')
  })

  it('re-renders and returns translations for the new locale', () => {
    useLocaleStore.getState().applyLocale('fr')
    const { result } = renderHook(() => useT())
    expect(result.current({ en: 'hello', fr: 'bonjour' })).toBe('bonjour')
  })
})
