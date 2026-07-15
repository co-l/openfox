import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Mode } from './main.js'
import { getGlobalConfigPath } from './paths.js'
import type { Provider, ModelConfig } from '../shared/types.js'

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
  'vllm',
  'sglang',
  'ollama',
  'llamacpp',
  'lmstudio',
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

const providerSchema = z
  .object({
    id: z.string(),
    preset: z.string().optional(),
    name: z.string().optional(),
    url: z.string().optional(),
    backend: backendSchema.optional(),
    apiKey: z.string().optional(),
    models: z.array(modelConfigSchema).optional(),
    isActive: z.boolean().optional(),
    createdAt: z.string().optional(),
    isLocal: z.boolean().optional(),
    thinkingField: z.string().optional(),
    authAdapter: z.string().optional(),
    transportAdapter: z.string().optional(),
    credentialRef: z.string().optional(),
  })
  .transform(
    (provider): Provider => ({
      id: provider.id,
      ...(provider.preset ? { preset: provider.preset } : {}),
      name: provider.name ?? provider.id,
      url: provider.url ?? '',
      backend: provider.backend ?? 'unknown',
      ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
      models: provider.models ?? [],
      isActive: provider.isActive ?? false,
      createdAt: provider.createdAt ?? new Date().toISOString(),
      ...(provider.isLocal !== undefined ? { isLocal: provider.isLocal } : {}),
      ...(provider.thinkingField ? { thinkingField: provider.thinkingField } : {}),
      ...(provider.authAdapter ? { authAdapter: provider.authAdapter } : {}),
      ...(provider.transportAdapter ? { transportAdapter: provider.transportAdapter } : {}),
      ...(provider.credentialRef ? { credentialRef: provider.credentialRef } : {}),
    }),
  )

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
  model: z.string().default('qwen3.5:0.8b'),
  timeout: z.number().default(120),
  backend: z.enum(['ollama', 'openai']).default('ollama'),
})

const cachedToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()),
  estimatedTokens: z.number(),
})

const mcpServerSchema = z.object({
  transport: z.enum(['stdio', 'http']).default('stdio'),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  disabledTools: z.array(z.string()).optional(),
  cachedTools: z.array(cachedToolSchema).optional(),
})

const llmConfigSchema = z.object({
  timeout: z.number().optional(),
  idleTimeout: z.number().optional(),
})

const defaultVisionFallback = {
  enabled: false,
  url: 'http://localhost:11434',
  model: 'qwen3.5:0.8b',
  timeout: 120,
  backend: 'ollama' as const,
}

// New config schema with providers array
const configSchema = z
  .object({
    providers: z.array(providerSchema).default([]),
    mcpServers: z.record(z.string(), mcpServerSchema).optional(),
    defaultModelSelection: z.string().optional(),
    activeProviderId: z.string().optional(),
    activeWorkflowId: z.string().optional(),
    server: serverSchema.default({ port: 10369, host: '127.0.0.1', openBrowser: true }),
    logging: loggingSchema.default({ level: 'error' as const }),
    database: databaseSchema.default({ path: '' }),
    workspace: workspaceSchema.default(() => ({ workdir: process.cwd() })),
    llm: llmConfigSchema.optional(),
    visionFallback: visionFallbackSchema.optional(),
    disableAutoSessionTitle: z.boolean().optional(),
  })
  .transform((data) => ({
    providers: data.providers ?? [],
    mcpServers: data.mcpServers,
    defaultModelSelection: data.defaultModelSelection,
    activeProviderId: data.activeProviderId,
    activeWorkflowId: data.activeWorkflowId,
    server: data.server ?? { port: 10369, host: '127.0.0.1', openBrowser: true },
    logging: data.logging ?? { level: 'error' },
    database: data.database ?? { path: '' },
    workspace: data.workspace ?? { workdir: process.cwd() },
    llm: data.llm,
    visionFallback: data.visionFallback ?? defaultVisionFallback,
    ...(data.disableAutoSessionTitle !== undefined ? { disableAutoSessionTitle: data.disableAutoSessionTitle } : {}),
  }))

// ============================================================================
// Types
// ============================================================================

export function getVisionFallback(config: GlobalConfig) {
  return config.visionFallback ?? getDefaultVisionFallback()
}

export type GlobalConfig = z.infer<typeof configSchema>

// ============================================================================
// Load / Save
// ============================================================================

export async function loadGlobalConfig(mode: Mode, configPathOverride?: string): Promise<GlobalConfig> {
  const configPath = configPathOverride ?? getGlobalConfigPath(mode)

  try {
    const content = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(content)
    return configSchema.parse(parsed)
  } catch {
    return configSchema.parse({})
  }
}

export function getDefaultVisionFallback() {
  return { enabled: false, url: 'http://localhost:11434', model: 'qwen3.5:0.8b', timeout: 120 }
}

export async function saveGlobalConfig(
  mode: Mode,
  config: Partial<GlobalConfig>,
  configPathOverride?: string,
): Promise<void> {
  const configPath = configPathOverride ?? getGlobalConfigPath(mode)
  const fullConfig: GlobalConfig = {
    providers: config.providers ?? [],
    mcpServers: config.mcpServers,
    defaultModelSelection: config.defaultModelSelection,
    activeProviderId: config.activeProviderId,
    activeWorkflowId: config.activeWorkflowId,
    server: config.server ?? { port: 10369, host: '127.0.0.1', openBrowser: true },
    logging: config.logging ?? { level: 'error' },
    database: config.database ?? { path: '' },
    workspace: config.workspace ?? { workdir: process.cwd() },
    llm: config.llm,
    visionFallback: config.visionFallback ?? defaultVisionFallback,
    ...(config.disableAutoSessionTitle !== undefined
      ? { disableAutoSessionTitle: config.disableAutoSessionTitle }
      : {}),
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
    mcpServers: config.mcpServers,
    defaultModelSelection,
    activeProviderId: providerId,
    activeWorkflowId: config.activeWorkflowId,
    server: config.server ?? { port: 10369, host: '127.0.0.1', openBrowser: true },
    logging: config.logging ?? { level: 'error' },
    database: config.database ?? { path: '' },
    workspace: config.workspace ?? { workdir: process.cwd() },
    llm: config.llm,
    visionFallback: config.visionFallback ?? defaultVisionFallback,
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
    mcpServers: config.mcpServers,
    defaultModelSelection:
      shouldActivate && !config.defaultModelSelection
        ? `${newProvider.id}/${newProvider.models?.find((m) => m.selected)?.id ?? newProvider.models?.[0]?.id ?? 'auto'}`
        : config.defaultModelSelection,
    activeProviderId: shouldActivate ? newProvider.id : config.activeProviderId,
    activeWorkflowId: config.activeWorkflowId,
    server: config.server ?? { port: 10369, host: '127.0.0.1', openBrowser: true },
    logging: config.logging ?? { level: 'error' },
    database: config.database ?? { path: '' },
    workspace: config.workspace ?? { workdir: process.cwd() },
    llm: config.llm,
    visionFallback: config.visionFallback ?? defaultVisionFallback,
  }
}

export function updateProvider(
  config: GlobalConfig,
  providerId: string,
  updates: Partial<Omit<Provider, 'id' | 'createdAt'>>,
): GlobalConfig {
  return {
    ...config,
    providers: config.providers.map((p) => (p.id === providerId ? { ...p, ...updates } : p)),
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
      // Reset to first available provider with its first model
      const firstModelId = filtered[0]?.models?.[0]?.id ?? 'auto'
      newDefaultModelSelection = filtered.length > 0 ? `${filtered[0]!.id}/${firstModelId}` : undefined
    }
  }

  const wasActive = config.activeProviderId === providerId

  // If we removed the active provider, activate the first remaining one
  const newActiveId =
    wasActive && filtered.length > 0 ? filtered[0]!.id : wasActive ? undefined : config.activeProviderId

  return {
    providers: filtered.map((p) => ({ ...p, isActive: p.id === newActiveId })),
    mcpServers: config.mcpServers,
    activeProviderId: newActiveId,
    defaultModelSelection: newDefaultModelSelection,
    activeWorkflowId: config.activeWorkflowId,
    server: config.server ?? { port: 10369, host: '127.0.0.1', openBrowser: true },
    logging: config.logging ?? { level: 'error' },
    database: config.database ?? { path: '' },
    workspace: config.workspace ?? { workdir: process.cwd() },
    llm: config.llm,
    visionFallback: config.visionFallback ?? defaultVisionFallback,
  }
}

export function activateProvider(config: Partial<GlobalConfig>, providerId: string): GlobalConfig {
  const provider = config.providers?.find((p) => p.id === providerId)
  if (!provider) {
    return {
      providers: config.providers ?? [],
      mcpServers: config.mcpServers,
      defaultModelSelection: config.defaultModelSelection,
      activeProviderId: config.activeProviderId,
      activeWorkflowId: config.activeWorkflowId,
      server: config.server ?? { port: 10369, host: '127.0.0.1', openBrowser: true },
      logging: config.logging ?? { level: 'error' },
      database: config.database ?? { path: '' },
      workspace: config.workspace ?? { workdir: process.cwd() },
      llm: config.llm,
      visionFallback: config.visionFallback ?? defaultVisionFallback,
    }
  }

  return {
    providers: (config.providers ?? []).map((p) => ({ ...p, isActive: p.id === providerId })),
    mcpServers: config.mcpServers,
    defaultModelSelection: config.defaultModelSelection,
    activeProviderId: providerId,
    activeWorkflowId: config.activeWorkflowId,
    server: config.server ?? { port: 10369, host: '127.0.0.1', openBrowser: true },
    logging: config.logging ?? { level: 'error' },
    database: config.database ?? { path: '' },
    workspace: config.workspace ?? { workdir: process.cwd() },
    llm: config.llm,
    visionFallback: config.visionFallback ?? defaultVisionFallback,
  }
}
