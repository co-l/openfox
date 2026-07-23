import { createHighlighter, type Highlighter, bundledLanguages } from 'shiki'
import type { ShikiTransformer } from 'shiki'
import { useThemeStore } from '../stores/theme'

let highlighter: Highlighter | null = null
let highlighterPromise: Promise<Highlighter> | null = null
const loadedLanguages = new Set<string>()
const loadingPromises = new Map<string, Promise<void>>()

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
    highlighterPromise = createHighlighter({ themes, langs: coreLangs }).then((h) => {
      highlighter = h
      coreLangs.forEach((lang) => loadedLanguages.add(lang))
      return h
    })
  }
  return highlighterPromise
}

export async function loadLanguage(lang: string): Promise<void> {
  if (loadedLanguages.has(lang)) return

  // Return existing promise if language is already being loaded
  if (loadingPromises.has(lang)) {
    return loadingPromises.get(lang)!
  }

  const loadPromise = (async () => {
    const h = await getHighlighter()

    // Try to load from bundledLanguages first
    const langDef = bundledLanguages[lang as keyof typeof bundledLanguages]
    if (langDef) {
      await h.loadLanguage(langDef)
      loadedLanguages.add(lang)
      return
    }

    // Fallback: try dynamic import for languages not in bundled set
    try {
      const langModule = await import(/* @vite-ignore */ `shiki/langs/${lang}.mjs`)
      if (langModule.default) {
        await h.loadLanguage(langModule.default)
        loadedLanguages.add(lang)
      }
    } catch (error) {
      console.warn(`Failed to load language ${lang}:`, error)
    }
  })()

  loadingPromises.set(lang, loadPromise)
  await loadPromise
  loadingPromises.delete(lang)
}

const highlightCache = new Map<string, string>()
const CACHE_MAX = 50

function cacheKey(code: string, language: string, theme: string): string {
  return `${code}|${language}|${theme}`
}

export async function highlightCode(code: string, language: string, theme = 'github-dark-default'): Promise<string> {
  if (language !== 'text' && !loadedLanguages.has(language)) {
    await loadLanguage(language)
  }

  const key = cacheKey(code, language, theme)
  const cached = highlightCache.get(key)
  if (cached) return cached

  const h = await getHighlighter()
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
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    highlighter?.dispose()
    highlighter = null
    loadedLanguages.clear()
    loadingPromises.clear()
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

  const fileName = filePath.split('/').pop() ?? ''

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
