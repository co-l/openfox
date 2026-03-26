import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Mode } from './main.js'
import { getGlobalConfigPath } from './paths.js'
import { detectBackend, detectModel } from '../server/llm/index.js'
import type { Provider, ProviderBackend } from '../shared/types.js'

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

// ============================================================================
// Schema Definitions
// ============================================================================

const backendSchema = z.enum(['auto', 'vllm', 'sglang', 'ollama', 'llamacpp', 'openai', 'anthropic', 'unknown'])

const providerSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  model: z.string(),
  backend: backendSchema,
  apiKey: z.string().optional(),
  maxContext: z.number().optional(),
  isActive: z.boolean(),
  createdAt: z.string(),
})

const serverSchema = z.object({
  port: z.number().default(10369),
  host: z.string().default('127.0.0.1'),
  openBrowser: z.boolean().default(true),
})

const loggingSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})

const databaseSchema = z.object({
  path: z.string().default(''),
})

const workspaceSchema = z.object({
  workdir: z.string().default(process.cwd()),
})

// New config schema with providers array
const configSchema = z.object({
  providers: z.array(providerSchema).default([]),
  activeProviderId: z.string().optional(),
  activePipelineId: z.string().optional(),
  server: serverSchema.default({}),
  logging: loggingSchema.default({}),
  database: databaseSchema.default({}),
  workspace: workspaceSchema.default({}),
})

// Old config schema (for migration detection)
const oldLlmSchema = z.object({
  url: z.string().url().default('http://localhost:8000/v1'),
  model: z.string().default('auto'),
  backend: z.enum(['auto', 'vllm', 'sglang', 'ollama', 'llamacpp']).default('auto'),
  maxContext: z.number().default(200000),
  disableThinking: z.boolean().default(false),
  apiKey: z.string().optional(),
})

const oldConfigSchema = z.object({
  llm: oldLlmSchema,
  server: serverSchema.default({}),
  logging: loggingSchema.default({}),
  database: databaseSchema.default({}),
})

// ============================================================================
// Types
// ============================================================================

export type GlobalConfig = z.infer<typeof configSchema>
export type OldGlobalConfig = z.infer<typeof oldConfigSchema>

// ============================================================================
// Migration
// ============================================================================

/**
 * Migrate old config format (single llm object) to new format (providers array).
 * If already in new format, returns as-is.
 */
export function migrateConfig(raw: unknown): GlobalConfig {
  // Check if it's already the new format (has providers array)
  if (typeof raw === 'object' && raw !== null && 'providers' in raw) {
    return configSchema.parse(raw)
  }
  
  // Check if it's the old format (has llm object)
  if (typeof raw === 'object' && raw !== null && 'llm' in raw) {
    const oldConfig = oldConfigSchema.parse(raw)
    const providerId = randomUUID()
    
    const provider: Provider = {
      id: providerId,
      name: 'Default',
      url: oldConfig.llm.url,
      model: oldConfig.llm.model,
      backend: oldConfig.llm.backend as ProviderBackend,
      apiKey: oldConfig.llm.apiKey,
      maxContext: oldConfig.llm.maxContext,
      isActive: true,
      createdAt: new Date().toISOString(),
    }
    
    return {
      providers: [provider],
      activeProviderId: providerId,
      server: oldConfig.server,
      logging: oldConfig.logging,
      database: oldConfig.database,
      workspace: { workdir: process.cwd() },
    }
  }
  
  // Empty or minimal config - return defaults
  return configSchema.parse(raw)
}

// ============================================================================
// Load / Save
// ============================================================================

export async function loadGlobalConfig(mode: Mode): Promise<GlobalConfig> {
  const configPath = getGlobalConfigPath(mode)
  
  try {
    const content = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(content)
    return migrateConfig(parsed)
  } catch {
    return configSchema.parse({})
  }
}

export async function saveGlobalConfig(mode: Mode, config: GlobalConfig): Promise<void> {
  const configPath = getGlobalConfigPath(mode)
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, JSON.stringify(config, null, 2))
}

// ============================================================================
// Provider Helpers
// ============================================================================

export function getActiveProvider(config: GlobalConfig): Provider | undefined {
  if (!config.activeProviderId) return undefined
  return config.providers.find(p => p.id === config.activeProviderId)
}

export function addProvider(config: GlobalConfig, provider: Omit<Provider, 'id' | 'createdAt'>): GlobalConfig {
  const newProvider: Provider = {
    ...provider,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  }
  
  // If this is the first provider or marked active, update activeProviderId
  const shouldActivate = provider.isActive || config.providers.length === 0
  
  return {
    ...config,
    providers: [
      ...config.providers.map(p => shouldActivate ? { ...p, isActive: false } : p),
      { ...newProvider, isActive: shouldActivate },
    ],
    activeProviderId: shouldActivate ? newProvider.id : config.activeProviderId,
    workspace: config.workspace ?? { workdir: process.cwd() },
  }
}

export function removeProvider(config: GlobalConfig, providerId: string): GlobalConfig {
  const filtered = config.providers.filter(p => p.id !== providerId)
  const wasActive = config.activeProviderId === providerId
  
  // If we removed the active provider, activate the first remaining one
  const newActiveId = wasActive && filtered.length > 0 
    ? filtered[0]!.id 
    : (wasActive ? undefined : config.activeProviderId)
  
  return {
    ...config,
    providers: filtered.map(p => ({ ...p, isActive: p.id === newActiveId })),
    activeProviderId: newActiveId,
  }
}

export function activateProvider(config: GlobalConfig, providerId: string): GlobalConfig {
  const provider = config.providers.find(p => p.id === providerId)
  if (!provider) return config
  
  return {
    ...config,
    providers: config.providers.map(p => ({ ...p, isActive: p.id === providerId })),
    activeProviderId: providerId,
  }
}

// ============================================================================
// Legacy mergeConfigs (for backwards compatibility during transition)
// ============================================================================

/**
 * @deprecated Use provider-based config instead
 */
export function mergeConfigs(...configs: Array<Partial<OldGlobalConfig>>): OldGlobalConfig {
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
    server: { port: 10369, host: '127.0.0.1', openBrowser: true },
    logging: { level: 'info' as const },
  })
  return oldConfigSchema.parse(result)
}
