import { createHighlighter, type BundledTheme, type Highlighter, bundledLanguages } from 'shiki'
import type { ShikiTransformer } from 'shiki'
import { useThemeStore } from '../stores/theme'
import { pathBasename } from './path'

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

/**
 * Representative snippets of the languages agents write most. shiki compiles a
 * language's rules the first time it tokenizes text in it, so a richer snippet
 * leaves less to compile later.
 */
const WARM_UP_SNIPPETS = {
  typescript: `import { a } from './a'\nexport interface P { id: string; n?: number }\nexport async function f(p: P): Promise<string[]> {\n  // comment\n  const s = \`v=\${p.id}\`\n  return [s, "x", String(1.5)].filter((x) => x !== '')\n}\nclass C<T> extends B implements I { private x = /re+/g }`,
  javascript: `const { a } = require('a')\nexport default async function f(x = 1) {\n  // comment\n  return [\`t\${x}\`, "s", 0x1f].map((v) => v ?? null)\n}`,
  python: `import os\nfrom typing import Optional\n\nclass A(B):\n    """doc"""\n    def f(self, x: int = 1) -> Optional[str]:\n        # comment\n        return f"v={x}" if x > 0 else None\n\n@decorator\ndef g(*args, **kw):\n    return [i for i in range(3)]`,
  bash: `#!/usr/bin/env bash\nset -euo pipefail\n# comment\nfor f in "$@"; do\n  echo "file: \${f}" | grep -E 'x' > /dev/null && npm run test -- --flag=1\ndone`,
  json: `{"name": "x", "n": 1.5, "ok": true, "list": [null, {"a": "b"}]}`,
  diff: `--- a/f.ts\n+++ b/f.ts\n@@ -1,2 +1,2 @@\n-const a = 1\n+const a = 2\n context`,
} as const

export const WARM_UP_LANGUAGES = Object.keys(WARM_UP_SNIPPETS) as Array<keyof typeof WARM_UP_SNIPPETS>

let warmUpStarted = false

function whenIdle(callback: () => void): void {
  // Safari has no requestIdleCallback: a short delay keeps the work off the
  // current task at least.
  if (typeof requestIdleCallback === 'function') requestIdleCallback(callback, { timeout: 5000 })
  else setTimeout(callback, 200)
}

/**
 * Create the highlighter and compile the common languages' rules while the
 * page is idle, one language per idle slot (each costs up to ~150 ms on a slow
 * phone). Otherwise the first code block shown pays for it: the first answer
 * of a session, or a whole answer rendered at once when the user comes back to
 * a tab that was in the background. Runs once per page.
 */
export function warmUpHighlighter(): void {
  if (warmUpStarted) return
  warmUpStarted = true
  const pending = [...WARM_UP_LANGUAGES]
  const next = () => {
    const lang = pending.shift()
    if (!lang) return
    getHighlighter()
      .then((h) => {
        h.codeToTokensBase(WARM_UP_SNIPPETS[lang], { lang, theme: getShikiTheme() as BundledTheme })
      })
      .catch(() => {
        // Warm-up only: a failure here just leaves the cost to the first block.
      })
      .finally(() => whenIdle(next))
  }
  whenIdle(next)
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
