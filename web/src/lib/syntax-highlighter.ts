import { createHighlighter, type Highlighter, type BundledTheme, bundledLanguages } from 'shiki'
import type { ShikiTransformer } from 'shiki'
import { useThemeStore } from '../stores/theme'
import { pathBasename } from './path'

let highlighter: Highlighter | null = null
let highlighterPromise: Promise<Highlighter> | null = null
const loadedLanguages = new Set<string>()
const loadedThemes = new Set<string>()
const loadingPromises = new Map<string, Promise<void>>()
const themeLoadingPromises = new Map<string, Promise<void>>()

const coreLangs: Array<string> = [
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'python',
  'bash',
  'json',
  'css',
  'html',
  'sql',
  'yaml',
  'markdown',
  'diff',
  'rust',
  'go',
  'java',
  'c',
  'cpp',
  'ruby',
  'toml',
  'scss',
  'graphql',
  'docker',
  'powershell',
]

const themes = [
  'github-dark-default',
  'vitesse-light',
  'monokai',
  'dracula',
  'nord',
  'everforest-light',
  'rose-pine-dawn',
  'synthwave-84',
  'one-dark-pro',
  'night-owl',
  'catppuccin-mocha',
  'rose-pine',
  'kanagawa-wave',
  'light-plus',
]

export const THEME_MAP: Record<string, string> = {
  dark: 'github-dark-default',
  light: 'vitesse-light',
  monokai: 'monokai',
  dracula: 'dracula',
  nord: 'nord',
  'rose-pine-dawn': 'rose-pine-dawn',
  'everforest-light': 'everforest-light',
  'synthwave-84': 'synthwave-84',
  'one-dark-pro': 'one-dark-pro',
  'night-owl': 'night-owl',
  'catppuccin-mocha': 'catppuccin-mocha',
  'rose-pine': 'rose-pine',
  'kanagawa-wave': 'kanagawa-wave',
  'light-plus': 'light-plus',
}

export function lineNumbersTransformer(): ShikiTransformer {
  return {
    name: 'line-numbers',
    line(node, line) {
      node.properties['data-line'] = String(line + 1)
    },
  }
}

export async function getHighlighter() {
  if (!highlighterPromise) {
    // Deliberately created bare (no grammars, no themes): loading 20+
    // grammars and 14 themes eagerly in one call is the multi-second
    // main-thread burst that froze big sessions. Everything is loaded
    // lazily through the idle queue below instead.
    highlighterPromise = createHighlighter({ themes: [], langs: [] }).then((h) => {
      highlighter = h
      return h
    })
  }
  return highlighterPromise
}

// ---------------------------------------------------------------------------
// Idle-time job queue
//
// Shiki work is synchronous and heavy: one codeToHtml call on a large block
// costs tens of ms, and a big session mounts dozens of code blocks at once.
// Running that burst synchronously froze the main thread for seconds.
//
// Every unit of shiki work (language load, theme load, codeToHtml) is a job
// in a single FIFO queue pumped on idle frames with a time budget: a slice
// runs jobs until its total time exceeds the budget, so even a burst of tiny
// jobs can never accumulate into one long main-thread task, and the feed
// fills top-down in visual order.
// ---------------------------------------------------------------------------
type IdleJob = () => void | Promise<void>

const idleQueue: IdleJob[] = []
let idlePumping = false
let idleBudgetMs = 8

// Test hook: the budget controls how many jobs a slice may run. Zero means
// exactly one job per slice, which makes the chunking deterministic.
export function setIdleBudgetMsForTest(ms = 8): void {
  idleBudgetMs = ms
}

type IdleScheduler = (run: () => void) => void

const defaultIdleScheduler: IdleScheduler = (run) => {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => run(), { timeout: 50 })
  } else {
    setTimeout(run, 0)
  }
}
let idleScheduler = defaultIdleScheduler

// Test hook: replaces the idle-frame scheduler so tests can drive slices
// manually. Pass null to restore the production scheduler.
export function setIdleSchedulerForTest(scheduler: IdleScheduler | null): void {
  idleScheduler = scheduler ?? defaultIdleScheduler
}

function scheduleIdleSlice(run: () => void): void {
  idleScheduler(run)
}

function pumpIdle(): void {
  if (idlePumping) return
  idlePumping = true
  const runSlice = () => {
    let asyncPending = false
    const sliceStart = performance.now()
    for (;;) {
      const job = idleQueue.shift()
      if (!job) break
      let result: unknown
      try {
        result = job()
      } catch (error) {
        console.warn('Syntax highlighting job failed:', error)
      }
      if (result instanceof Promise) {
        // Async jobs (dynamic language import) settle off-band; resume the
        // pump when they are done.
        asyncPending = true
        void result.then(
          () => {
            if (idleQueue.length > 0) scheduleIdleSlice(runSlice)
            else idlePumping = false
          },
          (error) => {
            console.warn('Syntax highlighting job failed:', error)
            if (idleQueue.length > 0) scheduleIdleSlice(runSlice)
            else idlePumping = false
          },
        )
        break
      }
      if (idleQueue.length === 0 || performance.now() - sliceStart >= idleBudgetMs) break
    }
    if (idleQueue.length > 0 && !asyncPending) {
      scheduleIdleSlice(runSlice)
    } else if (idleQueue.length === 0) {
      idlePumping = false
    }
  }
  scheduleIdleSlice(runSlice)
}

// Test hook: run every queued job synchronously.
export function flushIdleJobsForTest(): void {
  idlePumping = false
  for (;;) {
    const job = idleQueue.shift()
    if (!job) break
    const result = job()
    if (result instanceof Promise) {
      void result.catch(() => undefined)
    }
  }
}

function enqueueIdleJob<T>(job: () => T | Promise<T>): Promise<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const done = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  idleQueue.push(() => {
    try {
      const result = job()
      if (result instanceof Promise) {
        void result.then(resolve, reject)
        return
      }
      resolve(result)
    } catch (error) {
      reject(error)
    }
  })
  pumpIdle()
  return done
}

async function ensureLanguage(lang: string): Promise<void> {
  if (loadedLanguages.has(lang)) return
  let promise = loadingPromises.get(lang)
  if (promise) {
    await promise
    return
  }

  // Registered before awaiting the highlighter so concurrent callers for the
  // same language dedupe even during the creation window.
  promise = (async () => {
    const h = await getHighlighter()
    await enqueueIdleJob<void>(async () => {
      const langDef = bundledLanguages[lang as keyof typeof bundledLanguages]
      if (langDef) {
        await h.loadLanguage(langDef)
        loadedLanguages.add(lang)
        return
      }

      try {
        const langModule = await import(/* @vite-ignore */ `shiki/langs/${lang}.mjs`)
        if (langModule.default) {
          await h.loadLanguage(langModule.default)
          loadedLanguages.add(lang)
        }
      } catch (error) {
        console.warn(`Failed to load language ${lang}:`, error)
      }
    })
  })()

  loadingPromises.set(lang, promise)
  try {
    await promise
  } finally {
    loadingPromises.delete(lang)
  }
}

async function ensureTheme(theme: string): Promise<void> {
  if (loadedThemes.has(theme)) return
  let promise = themeLoadingPromises.get(theme)
  if (promise) {
    await promise
    return
  }

  promise = (async () => {
    const h = await getHighlighter()
    await enqueueIdleJob<void>(() => {
      h.loadTheme(theme as BundledTheme)
      loadedThemes.add(theme)
    })
  })()

  themeLoadingPromises.set(theme, promise)
  try {
    await promise
  } finally {
    themeLoadingPromises.delete(theme)
  }
}

export async function loadLanguage(lang: string): Promise<void> {
  await ensureLanguage(lang)
}

/**
 * Kick off loading of every core language and theme as idle jobs. Called once
 * on app mount so a big session opening later finds a fully warmed
 * highlighter instead of paying the load cost during its own load burst.
 */
export function warmupHighlighter(): void {
  for (const lang of coreLangs) {
    void ensureLanguage(lang)
  }
  for (const theme of themes) {
    void ensureTheme(theme)
  }
}

const highlightCache = new Map<string, string>()
const CACHE_MAX = 50

function cacheKey(code: string, language: string, theme: string): string {
  return `${code}|${language}|${theme}`
}

export async function highlightCode(code: string, language: string, theme = 'github-dark-default'): Promise<string> {
  const key = cacheKey(code, language, theme)
  const cached = highlightCache.get(key)
  if (cached) return cached

  if (language !== 'text') {
    await ensureLanguage(language)
  }
  await ensureTheme(theme)

  return enqueueIdleJob<string>(() => {
    const h = highlighter
    if (!h) throw new Error('Highlighter is not ready')
    const result = h.codeToHtml(code, {
      lang: language,
      theme,
      transformers: [lineNumbersTransformer()],
    })

    if (highlightCache.size >= CACHE_MAX) {
      const firstKey = highlightCache.keys().next().value
      if (firstKey) highlightCache.delete(firstKey)
    }
    highlightCache.set(key, result)
    return result
  })
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    highlighter?.dispose()
    highlighter = null
    highlighterPromise = null
    loadedLanguages.clear()
    loadedThemes.clear()
    loadingPromises.clear()
    themeLoadingPromises.clear()
    idleQueue.length = 0
    idlePumping = false
  })
}

const extensionToLanguage: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  scala: 'scala',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  ps1: 'powershell',
  sql: 'sql',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  xml: 'xml',
  md: 'markdown',
  markdown: 'markdown',
  toml: 'toml',
  ini: 'ini',
  conf: 'ini',
  dockerfile: 'docker',
  makefile: 'makefile',
  cmake: 'cmake',
  graphql: 'graphql',
  gql: 'graphql',
  vue: 'vue',
  svelte: 'svelte',
}

export function getLanguageFromPath(filePath?: string): string {
  if (!filePath) return 'text'

  const fileName = pathBasename(filePath)

  const lowerName = fileName.toLowerCase()
  if (lowerName === 'dockerfile') return 'docker'
  if (lowerName === 'makefile') return 'makefile'
  if (lowerName === 'cmakelists.txt') return 'cmake'

  const ext = fileName.split('.').pop()?.toLowerCase()
  if (!ext) return 'text'

  return extensionToLanguage[ext] ?? 'text'
}

export const wrappedCodeStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  borderRadius: 0,
  fontSize: '0.875rem',
  lineHeight: '1.5rem',
  background: 'transparent',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
}

export function useShikiTheme(): string {
  const currentPreset = useThemeStore((s) => s.currentPreset)
  const isCustom = useThemeStore((s) => s.isCustom)
  const basePreset = useThemeStore((s) => s.basePreset)
  return resolveShikiTheme(currentPreset, isCustom, basePreset)
}

export function getShikiTheme(): string {
  const { currentPreset, isCustom, basePreset } = useThemeStore.getState()
  return resolveShikiTheme(currentPreset, isCustom, basePreset)
}

function resolveShikiTheme(currentPreset: string, isCustom: boolean, basePreset: string): string {
  if (isCustom) {
    if (basePreset && basePreset !== 'system' && THEME_MAP[basePreset]) {
      return THEME_MAP[basePreset] ?? 'github-dark-default'
    }
    return 'github-dark-default'
  }
  return THEME_MAP[currentPreset] ?? 'github-dark-default'
}
