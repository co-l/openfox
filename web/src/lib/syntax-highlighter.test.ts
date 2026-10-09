// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'

const mockCreateHighlighter = vi.fn()
const mockLoadLanguage = vi.fn()
const mockDispose = vi.fn()
const mockLoadTheme = vi.fn()

let resolveCreate: ((h: typeof mockHighlighter) => void) | null = null
const mockHighlighter = {
  loadLanguage: mockLoadLanguage,
  loadTheme: mockLoadTheme,
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
  // Any requested language resolves to a fake loader, so tests never hit the
  // real dynamic import fallback.
  bundledLanguages: new Proxy(
    {},
    {
      get: (_target, prop) => (typeof prop === 'string' ? `${prop}-loader` : undefined),
    },
  ),
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

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

describe('syntax-highlighter idle chunking', () => {
  function freshHighlighter() {
    return {
      loadLanguage: vi.fn(),
      loadTheme: vi.fn(),
      dispose: vi.fn(),
      codeToHtml: vi.fn(() => '<pre>x</pre>'),
    }
  }

  // Drive the next scheduled slice, then let the job's async continuation
  // (a several-hop microtask chain) settle completely.
  async function drive(slices: Array<() => void>) {
    const slice = slices.shift()
    expect(slice).toBeDefined()
    slice!()
    await new Promise((r) => setTimeout(r, 0))
  }

  it('never runs shiki work synchronously and spreads jobs across idle slices', async () => {
    vi.resetModules()
    vi.clearAllMocks()
    resolveCreate = null
    const h = freshHighlighter()
    const mod = await import('./syntax-highlighter')
    const slices: Array<() => void> = []
    mod.setIdleSchedulerForTest((run) => slices.push(run))
    mod.setIdleBudgetMsForTest(0)
    try {
      const p1 = mod.highlightCode('alpha', 'text', 'theme-a')
      const p2 = mod.highlightCode('beta', 'text', 'theme-a')
      const p3 = mod.highlightCode('gamma', 'text', 'theme-a')
      resolveCreate!(h)
      // Drain every microtask so all pending IIFEs enqueue their jobs.
      await new Promise((r) => setTimeout(r, 0))

      expect(h.codeToHtml).not.toHaveBeenCalled()
      expect(h.loadTheme).not.toHaveBeenCalled()

      await drive(slices)
      expect(h.loadTheme).toHaveBeenCalledTimes(1)
      expect(h.loadTheme).toHaveBeenCalledWith('theme-a')
      expect(h.codeToHtml).not.toHaveBeenCalled()

      await drive(slices)
      expect(h.codeToHtml).toHaveBeenCalledTimes(1)
      expect(h.codeToHtml).toHaveBeenCalledWith('alpha', expect.objectContaining({ lang: 'text', theme: 'theme-a' }))

      await drive(slices)
      expect(h.codeToHtml).toHaveBeenCalledTimes(2)

      await drive(slices)
      expect(h.codeToHtml).toHaveBeenCalledTimes(3)

      const [r1, , r3] = await Promise.all([p1, p2, p3])
      expect(r1).toBe('<pre>x</pre>')
      expect(r3).toBe('<pre>x</pre>')
    } finally {
      mod.setIdleSchedulerForTest(null)
      mod.setIdleBudgetMsForTest()
    }
  })

  it('runs several jobs per slice within the budget', async () => {
    vi.resetModules()
    vi.clearAllMocks()
    resolveCreate = null
    const h = freshHighlighter()
    const mod = await import('./syntax-highlighter')
    const slices: Array<() => void> = []
    mod.setIdleSchedulerForTest((run) => slices.push(run))
    try {
      const p1 = mod.highlightCode('alpha', 'text', 'theme-a')
      const p2 = mod.highlightCode('beta', 'text', 'theme-a')
      resolveCreate!(h)
      // Drain every microtask so all pending IIFEs enqueue their jobs.
      await new Promise((r) => setTimeout(r, 0))

      await drive(slices)
      expect(h.loadTheme).toHaveBeenCalledTimes(1)
      expect(h.codeToHtml).not.toHaveBeenCalled()

      // Both ~0ms jobs fit within one slice's total time budget.
      await drive(slices)
      expect(h.codeToHtml).toHaveBeenCalledTimes(2)
      expect(slices).toHaveLength(0)

      await Promise.all([p1, p2])
    } finally {
      mod.setIdleSchedulerForTest(null)
    }
  })

  it('caps a slice at the total budget even when each job alone fits', async () => {
    vi.resetModules()
    vi.clearAllMocks()
    resolveCreate = null
    const h = freshHighlighter()
    // Each job busy-waits ~12ms: individually under the 20ms slice budget,
    // but two of them exceed it, so one slice may not hold all three.
    h.codeToHtml.mockImplementation(() => {
      const t = performance.now()
      while (performance.now() - t < 12) {
        // spin: make each job consume real time
      }
      return '<pre>x</pre>'
    })
    const mod = await import('./syntax-highlighter')
    const slices: Array<() => void> = []
    mod.setIdleSchedulerForTest((run) => slices.push(run))
    mod.setIdleBudgetMsForTest(20)
    try {
      const p1 = mod.highlightCode('alpha', 'text', 'theme-a')
      const p2 = mod.highlightCode('beta', 'text', 'theme-a')
      const p3 = mod.highlightCode('gamma', 'text', 'theme-a')
      resolveCreate!(h)
      await new Promise((r) => setTimeout(r, 0))

      await drive(slices)
      expect(h.loadTheme).toHaveBeenCalledTimes(1)

      // Slice 1 runs alpha + beta, then the slice budget is spent.
      await drive(slices)
      expect(h.codeToHtml).toHaveBeenCalledTimes(2)

      // The leftover job gets its own slice.
      await drive(slices)
      expect(h.codeToHtml).toHaveBeenCalledTimes(3)
      expect(slices).toHaveLength(0)

      await Promise.all([p1, p2, p3])
    } finally {
      mod.setIdleSchedulerForTest(null)
      mod.setIdleBudgetMsForTest()
    }
  })

  it('warmupHighlighter loads core languages and themes on idle frames', async () => {
    vi.resetModules()
    vi.clearAllMocks()
    resolveCreate = null
    const h = freshHighlighter()
    const mod = await import('./syntax-highlighter')
    const slices: Array<() => void> = []
    mod.setIdleSchedulerForTest((run) => slices.push(run))
    mod.setIdleBudgetMsForTest(0)
    try {
      mod.warmupHighlighter()
      resolveCreate!(h)
      // Drain every microtask so all pending IIFEs enqueue their jobs.
      await new Promise((r) => setTimeout(r, 0))

      let guard = 0
      while (slices.length > 0 && guard++ < 200) {
        await drive(slices)
      }

      expect(h.loadLanguage).toHaveBeenCalledWith('typescript-loader')
      expect(h.loadLanguage).toHaveBeenCalledWith('python-loader')
      expect(h.loadTheme).toHaveBeenCalledWith('github-dark-default')
      expect(h.loadTheme).toHaveBeenCalledWith('monokai')
      expect(h.loadLanguage.mock.calls.length).toBeGreaterThanOrEqual(20)
      expect(h.loadTheme.mock.calls.length).toBeGreaterThanOrEqual(10)
    } finally {
      mod.setIdleSchedulerForTest(null)
      mod.setIdleBudgetMsForTest()
    }
  })
})
