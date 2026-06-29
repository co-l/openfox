import { extname, basename } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import type { LanguageConfig } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const languagesJson = JSON.parse(readFileSync(resolve(__dirname, 'languages.json'), 'utf-8')) as LanguageConfig[]

export const LANGUAGES: LanguageConfig[] = languagesJson

const extensionToLanguage = new Map<string, LanguageConfig>()
for (const lang of LANGUAGES) {
  for (const ext of lang.extensions) {
    extensionToLanguage.set(ext, lang)
  }
}

const specialFilenames: Record<string, LanguageConfig> = {}
const dockerLang = LANGUAGES.find((l) => l.id === 'dockerfile')
if (dockerLang) {
  specialFilenames['dockerfile'] = dockerLang
  specialFilenames['containerfile'] = dockerLang
}

export function detectLanguage(filePath: string): LanguageConfig | null {
  const filename = basename(filePath).toLowerCase()
  const special = specialFilenames[filename]
  if (special) {
    return special
  }

  const ext = extname(filePath).toLowerCase()
  if (!ext) {
    return null
  }

  return extensionToLanguage.get(ext) ?? null
}

export function getSupportedLanguages(): LanguageConfig[] {
  return [...LANGUAGES]
}

export function getLanguageById(id: string): LanguageConfig | null {
  return LANGUAGES.find((l) => l.id === id) ?? null
}
