import { z } from 'zod'
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Mode } from './main.js'
import { getGlobalConfigPath } from './paths.js'
import { detectBackend, detectModel } from '../server/llm/index.js'

const SMART_DEFAULTS = [
  'http://localhost:8000',
  'http://localhost:11434',
  'http://localhost:8080',
]

export async function trySmartDefaults(mode: Mode): Promise<{ url: string; backend: string; model: string } | null> {
  // Try all URLs in parallel, no retries
  const results = await Promise.all(
    SMART_DEFAULTS.map(async (url) => {
      try {
        const [backend, model] = await Promise.all([
          detectBackend(url, undefined, true),
          detectModel(url, 1, true),  // Only 1 retry attempt
        ])
        if (backend !== 'unknown' && model) {
          return { url, backend, model }
        }
      } catch {
        // Silent fail
      }
      return null
    })
  )
  
  // Return first successful detection
  return results.find(r => r !== null) || null
}

export async function configFileExists(mode: Mode): Promise<boolean> {
  const configPath = getGlobalConfigPath(mode)
  try {
    await access(configPath)
    return true
  } catch {
    return false
  }
}

const configSchema = z.object({
  llm: z.object({
    url: z.string().url().default('http://localhost:8000/v1'),
    model: z.string().default('auto'),
    backend: z.enum(['auto', 'vllm', 'sglang', 'ollama', 'llamacpp']).default('auto'),
    maxContext: z.number().default(200000),
    disableThinking: z.boolean().default(false),
  }).default({}),
  server: z.object({
    port: z.number().default(3000),
    host: z.string().default('127.0.0.1'),
    openBrowser: z.boolean().default(true),
  }).default({}),
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  }).default({}),
  database: z.object({
    path: z.string().default(''),
  }).default({}),
})

export async function loadGlobalConfig(mode: Mode): Promise<z.infer<typeof configSchema>> {
  const configPath = getGlobalConfigPath(mode)
  
  try {
    const content = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(content)
    return configSchema.parse(parsed)
  } catch {
    return configSchema.parse({})
  }
}

export async function saveGlobalConfig(mode: Mode, config: z.infer<typeof configSchema>): Promise<void> {
  const configPath = getGlobalConfigPath(mode)
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, JSON.stringify(config, null, 2))
}

export function mergeConfigs(...configs: Array<Partial<z.infer<typeof configSchema>>>): z.infer<typeof configSchema> {
  const result = configs.reduce((acc, curr) => {
    if (curr.llm) {
      acc.llm = { ...acc.llm, ...curr.llm }
    }
    if (curr.server) {
      acc.server = { ...acc.server, ...curr.server }
    }
    if (curr.logging) {
      acc.logging = { ...acc.logging, ...curr.logging }
    }
    return acc
  }, {
    llm: { url: 'http://localhost:8000/v1', model: 'auto', backend: 'auto' as const, maxContext: 200000, disableThinking: false },
    server: { port: 3000, host: '127.0.0.1', openBrowser: true },
    logging: { level: 'info' as const },
  })
  return configSchema.parse(result)
}
