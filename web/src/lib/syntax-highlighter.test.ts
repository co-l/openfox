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
  codeToTokensBase: vi.fn(() => []),
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

  describe('warmUpHighlighter', () => {
    it('tokenizes one common language per idle slot, once', async () => {
      // shiki compiles a language's rules the first time it tokenizes it
      // (~0.5 s for a few languages on a slow phone): doing it while the page
      // is idle keeps that cost off the first code block shown, e.g. a whole
      // answer rendered at once when the user comes back to the tab.
      vi.clearAllMocks()
      const idle: Array<() => void> = []
      vi.stubGlobal('requestIdleCallback', (callback: () => void) => {
        idle.push(callback)
        return idle.length
      })
      try {
        const mod = await import('./syntax-highlighter')
        mod.warmUpHighlighter()
        mod.warmUpHighlighter()

        const languages: string[] = []
        while (languages.length < mod.WARM_UP_LANGUAGES.length) {
          // One idle slot runs one language, then queues the next slot.
          expect(idle).toHaveLength(1)
          idle.shift()!()
          await vi.waitFor(() => {
            expect(mockHighlighter.codeToTokensBase.mock.calls.length).toBe(languages.length + 1)
          })
          const call = mockHighlighter.codeToTokensBase.mock.calls.at(-1) as unknown as [string, { lang: string }]
          languages.push(call[1].lang)
          await vi.waitFor(() => expect(idle).toHaveLength(1))
        }
        idle.shift()!()

        expect(languages).toEqual([...mod.WARM_UP_LANGUAGES])
        expect(mockHighlighter.codeToTokensBase).toHaveBeenCalledTimes(languages.length)
        expect(idle).toHaveLength(0)
      } finally {
        vi.unstubAllGlobals()
      }
    })
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

  describe('getLanguageFromPath', () => {
    it('detects extension-less names on Unix and Windows paths', async () => {
      const mod = await import('./syntax-highlighter')

      expect(mod.getLanguageFromPath('/home/me/app/Dockerfile')).toBe('docker')
      expect(mod.getLanguageFromPath('C:\\Users\\me\\app\\Dockerfile')).toBe('docker')
      expect(mod.getLanguageFromPath('C:\\Users\\me\\app\\CMakeLists.txt')).toBe('cmake')
      expect(mod.getLanguageFromPath('C:\\Users\\me\\app\\main.rs')).toBe('rust')
    })
  })
})
