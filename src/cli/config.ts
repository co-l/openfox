import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Mode } from './main.js'
import { getGlobalConfigPath } from './paths.js'
import { detectBackend, detectModel } from '../server/llm/index.js'
import type { Provider, ProviderBackend, ModelConfig } from '../shared/types.js'

const SMART_DEFAULTS = ['http://localhost:8000', 'http://localhost:11434', 'http://localhost:8080']

export async function trySmartDefaults(_mode: Mode): Promise<{ url: string; backend: string; model: string } | null> {
  // Try all URLs in parallel, no retries
  const results = await Promise.all(
    SMART_DEFAULTS.map(async (url) => {
      try {
        const [backend, model] = await Promise.all([
          detectBackend(url, undefined, true),
          detectModel(url, 1, true), // Only 1 retry attempt
        ])
        if (backend !== 'unknown' && model) {
          return { url, backend, model }
        }
      } catch {
        // Silent fail
      }
      return null
    }),
  )

  // Return first successful detection
  return results.find((r) => r !== null) || null
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

const backendSchema = z.enum([
  'auto',
  'vllm',
  'sglang',
  'ollama',
  'llamacpp',
  'openai',
  'anthropic',
  'opencode-go',
  'unknown',
])

const modelConfigSchema = z
  .object({
    id: z.string(),
    contextWindow: z.number(),
    source: z.enum(['backend', 'user', 'default']),
    temperature: z.number().optional(),
    topP: z.number().optional(),
    topK: z.number().optional(),
    maxTokens: z.number().optional(),
  })
  .passthrough() as z.ZodType<ModelConfig>

const providerSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  backend: backendSchema,
  apiKey: z.string().optional(),
  models: z.array(modelConfigSchema).default([]),
  isActive: z.boolean(),
  createdAt: z.string(),
  // Deprecated: model field kept for migration, will be removed after migration
  model: z.string().optional(),
  // Deprecated: maxContext kept for migration
  maxContext: z.number().optional(),
})

const serverSchema = z.object({
  port: z.number().default(10369),
  host: z.string().default('127.0.0.1'),
  openBrowser: z.boolean().default(true),
})

const loggingSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']).default('error'),
})

const databaseSchema = z.object({
  path: z.string().default(''),
})

const workspaceSchema = z.object({
  workdir: z.string().default(process.cwd()),
})

const visionFallbackSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().default('http://localhost:11434'),
  model: z.string().default('qwen3-vl:2b'),
  timeout: z.number().default(120),
})

const defaultVisionFallback = { enabled: false, url: 'http://localhost:11434', model: 'qwen3-vl:2b', timeout: 120 }

// New config schema with providers array
const configSchema = z
  .object({
    providers: z.array(providerSchema).default([]),
    defaultModelSelection: z.string().optional(),
    activeProviderId: z.string().optional(),
    activeWorkflowId: z.string().optional(),
    server: serverSchema.default({ port: 10369, host: '127.0.0.1', openBrowser: true }),
    logging: loggingSchema.default({ level: 'error' as const }),
    database: databaseSchema.default({ path: '' }),
    workspace: workspaceSchema.default(() => ({ workdir: process.cwd() })),
    visionFallback: visionFallbackSchema.optional(),
  })
  .transform((data) => ({
    providers: data.providers ?? [],
    defaultModelSelection: data.defaultModelSelection,
    activeProviderId: data.activeProviderId,
    activeWorkflowId: data.activeWorkflowId,
    server: data.server ?? { port: 10369, host: '127.0.0.1', openBrowser: true },
    logging: data.logging ?? { level: 'error' },
    database: data.database ?? { path: '' },
    workspace: data.workspace ?? { workdir: process.cwd() },
    visionFallback: data.visionFallback ?? defaultVisionFallback,
  }))

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
  server: serverSchema.default({ port: 10369, host: '127.0.0.1', openBrowser: true }),
  logging: loggingSchema.default({ level: 'error' as const }),
  database: databaseSchema.default({ path: '' }),
})

// ============================================================================
// Types
// ============================================================================

export function getVisionFallback(config: GlobalConfig) {
  return config.visionFallback ?? getDefaultVisionFallback()
}

export type GlobalConfig = z.infer<typeof configSchema>
export type OldGlobalConfig = z.infer<typeof oldConfigSchema>

// ============================================================================
// Migration
// ============================================================================

/**
 * Migrate old config format (single llm object) to new format (providers array).
 * Also migrates provider.model to global defaultModelSelection.
 * If already in new format with defaultModelSelection, returns as-is.
 */
export function migrateConfig(raw: unknown): { config: GlobalConfig; migrated: boolean } {
  type RawProvider = {
    id: string
    name: string
    url: string
    model?: string
    backend: string
    apiKey?: string
    maxContext?: number
    isActive: boolean
    createdAt: string
    models?: Array<{ id: string; contextWindow: number; source: 'backend' | 'user' | 'default' }>
  }
  type RawConfig = {
    providers: RawProvider[]
    activeProviderId?: string
    defaultModelSelection?: string
    [key: string]: unknown
  }

  // Check if it's already the new format (has providers array)
  if (typeof raw === 'object' && raw !== null && 'providers' in raw) {
    const obj = raw as RawConfig

    // Migrate legacy maxContext to models array
    let migrationOccurred = false
    const providers = obj.providers.map((p) => {
      const { model, maxContext, models: existingModels, ...rest } = p

      // If provider has legacy maxContext but no existing models array, migrate to models array
      let models: Array<{ id: string; contextWindow: number; source: 'backend' | 'user' | 'default' }> =
        existingModels ?? []
      if (maxContext !== undefined && (existingModels === undefined || existingModels.length === 0)) {
        migrationOccurred = true
        // Use the model field value if available, otherwise default to 'auto'
        models = [
          {
            id: model ?? 'auto',
            contextWindow: maxContext,
            source: 'user' as const,
          },
        ]
      }

      return {
        ...rest,
        models,
      }
    })

    if (migrationOccurred) {
      console.warn('Migrating legacy maxContext to model-specific config')
    }

    // If already has defaultModelSelection, just parse and return
    if (obj.defaultModelSelection) {
      return {
        config: configSchema.parse({
          ...obj,
          providers,
        }),
        migrated: migrationOccurred,
      }
    }

    // Migrate from activeProviderId + provider.model to defaultModelSelection
    let defaultModelSelection: string | undefined
    if (obj.activeProviderId) {
      const activeProvider = obj.providers.find((p) => p.id === obj.activeProviderId)
      if (activeProvider?.model) {
        defaultModelSelection = `${obj.activeProviderId}/${activeProvider.model}`
      } else {
        defaultModelSelection = `${obj.activeProviderId}/auto`
      }
    }

    return {
      config: configSchema.parse({
        ...obj,
        providers,
        defaultModelSelection,
      }),
      migrated: migrationOccurred,
    }
  }

  // Check if it's the old format (has llm object)
  if (typeof raw === 'object' && raw !== null && 'llm' in raw) {
    const oldConfig = oldConfigSchema.parse(raw)
    const providerId = randomUUID()

    // Migrate legacy maxContext to models array
    const models: ModelConfig[] = [
      {
        id: oldConfig.llm.model || 'auto',
        contextWindow: oldConfig.llm.maxContext,
        source: 'user',
      },
    ]

    const provider: Provider = {
      id: providerId,
      name: 'Default',
      url: oldConfig.llm.url,
      backend: oldConfig.llm.backend as ProviderBackend,
      apiKey: oldConfig.llm.apiKey,
      models,
      isActive: true,
      createdAt: new Date().toISOString(),
    }

    const model = oldConfig.llm.model || 'auto'

    return {
      config: configSchema.parse({
        providers: [provider],
        defaultModelSelection: `${providerId}/${model}`,
        server: oldConfig.server,
        logging: oldConfig.logging,
        database: oldConfig.database,
        workspace: { workdir: process.cwd() },
      }),
      migrated: true,
    }
  }

  // Empty or minimal config - return defaults
  return {
    config: configSchema.parse(raw),
    migrated: false,
  }
}

// ============================================================================
// Load / Save
// ============================================================================

export async function loadGlobalConfig(mode: Mode): Promise<GlobalConfig> {
  const configPath = getGlobalConfigPath(mode)

  try {
    const content = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(content)
    const { config, migrated } = migrateConfig(parsed)
    if (migrated) {
      await saveGlobalConfig(mode, config)
    }
    return config
  } catch {
    return configSchema.parse({})
  }
}

export function getDefaultVisionFallback() {
  return { enabled: false, url: 'http://localhost:11434', model: 'qwen3-vl:2b', timeout: 120 }
}

export async function saveGlobalConfig(mode: Mode, config: Partial<GlobalConfig>): Promise<void> {
  const configPath = getGlobalConfigPath(mode)
  const fullConfig: GlobalConfig = {
    providers: config.providers ?? [],
    defaultModelSelection: config.defaultModelSelection,
    activeProviderId: config.activeProviderId,
    activeWorkflowId: config.activeWorkflowId,
    server: config.server ?? { port: 10369, host: '127.0.0.1', openBrowser: true },
    logging: config.logging ?? { level: 'error' },
    database: config.database ?? { path: '' },
    workspace: config.workspace ?? { workdir: process.cwd() },
    visionFallback: config.visionFallback ?? {
      enabled: false,
      url: 'http://localhost:11434',
      model: 'qwen3-vl:2b',
      timeout: 120,
    },
  }
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, JSON.stringify(fullConfig, null, 2))
}

// ============================================================================
// Provider Helpers
// ============================================================================

export function getActiveProvider(config: Partial<GlobalConfig>): Provider | undefined {
  // Use defaultModelSelection if available
  if (config.defaultModelSelection) {
    const slashIndex = config.defaultModelSelection.indexOf('/')
    const providerId =
      slashIndex === -1 ? config.defaultModelSelection : config.defaultModelSelection.substring(0, slashIndex)
    return config.providers?.find((p) => p.id === providerId)
  }
  // Fallback to activeProviderId for backwards compatibility
  if (!config.activeProviderId) return undefined
  return config.providers?.find((p) => p.id === config.activeProviderId)
}

export function getDefaultModel(config: Partial<GlobalConfig>): string | undefined {
  if (!config.defaultModelSelection) return undefined
  const slashIndex = config.defaultModelSelection.indexOf('/')
  return slashIndex === -1 ? 'auto' : config.defaultModelSelection.substring(slashIndex + 1)
}

export function setDefaultModelSelection(
  config: Partial<GlobalConfig>,
  providerId: string,
  model: string,
): GlobalConfig {
  const defaultModelSelection = `${providerId}/${model}`
  return {
    providers: config.providers?.map((p) => ({ ...p, isActive: p.id === providerId })) ?? [],
    defaultModelSelection,
    activeProviderId: providerId,
    activeWorkflowId: config.activeWorkflowId,
    server: config.server ?? { port: 10369, host: '127.0.0.1', openBrowser: true },
    logging: config.logging ?? { level: 'error' },
    database: config.database ?? { path: '' },
    workspace: config.workspace ?? { workdir: process.cwd() },
    visionFallback: config.visionFallback ?? {
      enabled: false,
      url: 'http://localhost:11434',
      model: 'qwen3-vl:2b',
      timeout: 120,
    },
  }
}

export function addProvider(config: Partial<GlobalConfig>, provider: Omit<Provider, 'id' | 'createdAt'>): GlobalConfig {
  const newProvider: Provider = {
    ...provider,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  }

  // If this is the first provider or marked active, update defaultModelSelection
  const shouldActivate = provider.isActive || (config.providers?.length ?? 0) === 0

  return {
    providers: [
      ...(config.providers ?? []).map((p) => (shouldActivate ? { ...p, isActive: false } : p)),
      { ...newProvider, isActive: shouldActivate },
    ],
    defaultModelSelection: shouldActivate ? `${newProvider.id}/auto` : config.defaultModelSelection,
    activeProviderId: shouldActivate ? newProvider.id : config.activeProviderId,
    activeWorkflowId: config.activeWorkflowId,
    server: config.server ?? { port: 10369, host: '127.0.0.1', openBrowser: true },
    logging: config.logging ?? { level: 'error' },
    database: config.database ?? { path: '' },
    workspace: config.workspace ?? { workdir: process.cwd() },
    visionFallback: config.visionFallback ?? {
      enabled: false,
      url: 'http://localhost:11434',
      model: 'qwen3-vl:2b',
      timeout: 120,
    },
  }
}

export function removeProvider(config: Partial<GlobalConfig>, providerId: string): GlobalConfig {
  const currentProviders = config.providers ?? []
  const filtered = currentProviders.filter((p) => p.id !== providerId)

  // Check if we're removing the default model selection's provider
  let newDefaultModelSelection = config.defaultModelSelection
  if (config.defaultModelSelection) {
    const slashIndex = config.defaultModelSelection.indexOf('/')
    const selectedProviderId =
      slashIndex === -1 ? config.defaultModelSelection : config.defaultModelSelection.substring(0, slashIndex)
    if (selectedProviderId === providerId) {
      // Reset to first available provider with auto
      newDefaultModelSelection = filtered.length > 0 ? `${filtered[0]!.id}/auto` : undefined
    }
  }

  const wasActive = config.activeProviderId === providerId

  // If we removed the active provider, activate the first remaining one
  const newActiveId =
    wasActive && filtered.length > 0 ? filtered[0]!.id : wasActive ? undefined : config.activeProviderId

  return {
    providers: filtered.map((p) => ({ ...p, isActive: p.id === newActiveId })),
    activeProviderId: newActiveId,
    defaultModelSelection: newDefaultModelSelection,
    activeWorkflowId: config.activeWorkflowId,
    server: config.server ?? { port: 10369, host: '127.0.0.1', openBrowser: true },
    logging: config.logging ?? { level: 'error' },
    database: config.database ?? { path: '' },
    workspace: config.workspace ?? { workdir: process.cwd() },
    visionFallback: config.visionFallback ?? {
      enabled: false,
      url: 'http://localhost:11434',
      model: 'qwen3-vl:2b',
      timeout: 120,
    },
  }
}

export function activateProvider(config: Partial<GlobalConfig>, providerId: string): GlobalConfig {
  const provider = config.providers?.find((p) => p.id === providerId)
  if (!provider) {
    return {
      providers: config.providers ?? [],
      defaultModelSelection: config.defaultModelSelection,
      activeProviderId: config.activeProviderId,
      activeWorkflowId: config.activeWorkflowId,
      server: config.server ?? { port: 10369, host: '127.0.0.1', openBrowser: true },
      logging: config.logging ?? { level: 'error' },
      database: config.database ?? { path: '' },
      workspace: config.workspace ?? { workdir: process.cwd() },
      visionFallback: config.visionFallback ?? {
        enabled: false,
        url: 'http://localhost:11434',
        model: 'qwen3-vl:2b',
        timeout: 120,
      },
    }
  }

  return {
    providers: (config.providers ?? []).map((p) => ({ ...p, isActive: p.id === providerId })),
    defaultModelSelection: config.defaultModelSelection,
    activeProviderId: providerId,
    activeWorkflowId: config.activeWorkflowId,
    server: config.server ?? { port: 10369, host: '127.0.0.1', openBrowser: true },
    logging: config.logging ?? { level: 'error' },
    database: config.database ?? { path: '' },
    workspace: config.workspace ?? { workdir: process.cwd() },
    visionFallback: config.visionFallback ?? {
      enabled: false,
      url: 'http://localhost:11434',
      model: 'qwen3-vl:2b',
      timeout: 120,
    },
  }
}

// ============================================================================
// Legacy mergeConfigs (for backwards compatibility during transition)
// ============================================================================

/**
 * @deprecated Use provider-based config instead
 */
export function mergeConfigs(...configs: Array<Partial<OldGlobalConfig>>): OldGlobalConfig {
  const result = configs.reduce(
    (acc, curr) => {
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
    },
    {
      llm: {
        url: 'http://localhost:8000/v1',
        model: 'auto',
        backend: 'auto' as const,
        maxContext: 200000,
        disableThinking: false,
      },
      server: { port: 10369, host: '127.0.0.1', openBrowser: true },
      logging: { level: 'error' as const },
    },
  )
  return oldConfigSchema.parse(result)
}
