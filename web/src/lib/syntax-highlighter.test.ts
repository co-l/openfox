// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'

const mockCreateHighlighter = vi.fn()
const mockLoadLanguage = vi.fn()
const mockDispose = vi.fn()

let resolveCreate: ((h: typeof mockHighlighter) => void) | null = null
const mockHighlighter = {
  loadLanguage: mockLoadLanguage,
  dispose: mockDispose,
  codeToHtml: vi.fn(() => '<pre>code</pre>'),
}

vi.mock('shiki', () => ({
  createHighlighter: (...args: unknown[]) => {
    mockCreateHighlighter(...args)
    return new Promise((resolve) => {
      resolveCreate = resolve
    })
  },
  bundledLanguages: {
    kotlin: 'kotlin-loader',
    swift: 'swift-loader',
  },
}))

describe('syntax-highlighter', () => {
  it('creates highlighter only once under concurrent calls', async () => {
    vi.clearAllMocks()
    resolveCreate = null

    const mod = await import('./syntax-highlighter')

    const promise1 = mod.getHighlighter()
    const promise2 = mod.getHighlighter()

    resolveCreate!(mockHighlighter)

    const [h1, h2] = await Promise.all([promise1, promise2])

    expect(mockCreateHighlighter).toHaveBeenCalledTimes(1)
    expect(h1).toBe(h2)
  })

  it('loads a language not in coreLangs from bundledLanguages', async () => {
    vi.clearAllMocks()
    resolveCreate = null

    const mod = await import('./syntax-highlighter')

    // Highlighter already created by previous test — getHighlighter returns instantly
    await mod.loadLanguage('kotlin')

    expect(mockLoadLanguage).toHaveBeenCalledWith('kotlin-loader')
  })

  it('does not reload an already loaded language', async () => {
    vi.clearAllMocks()

    const mod = await import('./syntax-highlighter')

    await mod.loadLanguage('kotlin')
    await mod.loadLanguage('kotlin')

    expect(mockLoadLanguage).toHaveBeenCalledTimes(0)
  })

  it('deduplicates concurrent loadLanguage calls for the same language', async () => {
    vi.clearAllMocks()

    const mod = await import('./syntax-highlighter')

    await Promise.all([mod.loadLanguage('swift'), mod.loadLanguage('swift')])

    expect(mockLoadLanguage).toHaveBeenCalledTimes(1)
  })

  describe('useShikiTheme', () => {
    it('maps custom theme with light basePreset to vitesse-light', async () => {
      const { useThemeStore } = await import('../stores/theme')
      useThemeStore.setState({ isCustom: true, basePreset: 'light', currentPreset: 'light' })

      const mod = await import('./syntax-highlighter')
      const theme = mod.getShikiTheme()
      expect(theme).toBe('vitesse-light')
    })

    it('maps custom theme with dark basePreset to github-dark-default', async () => {
      const { useThemeStore } = await import('../stores/theme')
      useThemeStore.setState({ isCustom: true, basePreset: 'dark', currentPreset: 'dark' })

      const mod = await import('./syntax-highlighter')
      const theme = mod.getShikiTheme()
      expect(theme).toBe('github-dark-default')
    })

    it('maps custom theme with dracula basePreset to dracula', async () => {
      const { useThemeStore } = await import('../stores/theme')
      useThemeStore.setState({ isCustom: true, basePreset: 'dracula', currentPreset: 'dracula' })

      const mod = await import('./syntax-highlighter')
      const theme = mod.getShikiTheme()
      expect(theme).toBe('dracula')
    })

    it('maps custom theme with monokai basePreset to monokai', async () => {
      const { useThemeStore } = await import('../stores/theme')
      useThemeStore.setState({ isCustom: true, basePreset: 'monokai', currentPreset: 'monokai' })

      const mod = await import('./syntax-highlighter')
      const theme = mod.getShikiTheme()
      expect(theme).toBe('monokai')
    })

    it('maps custom theme with nord basePreset to nord', async () => {
      const { useThemeStore } = await import('../stores/theme')
      useThemeStore.setState({ isCustom: true, basePreset: 'nord', currentPreset: 'nord' })

      const mod = await import('./syntax-highlighter')
      const theme = mod.getShikiTheme()
      expect(theme).toBe('nord')
    })

    it('falls back to github-dark-default for unknown basePreset', async () => {
      const { useThemeStore } = await import('../stores/theme')
      useThemeStore.setState({ isCustom: true, basePreset: '', currentPreset: 'dark' })

      const mod = await import('./syntax-highlighter')
      const theme = mod.getShikiTheme()
      expect(theme).toBe('github-dark-default')
    })

    it('uses THEME_MAP for non-custom preset', async () => {
      const { useThemeStore } = await import('../stores/theme')
      useThemeStore.setState({ isCustom: false, currentPreset: 'monokai' })

      const mod = await import('./syntax-highlighter')
      const theme = mod.getShikiTheme()
      expect(theme).toBe('monokai')
    })
  })
})
