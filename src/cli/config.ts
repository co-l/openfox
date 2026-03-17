import { z } from 'zod'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Mode } from './main.js'
import { getGlobalConfigPath } from './paths.js'

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
