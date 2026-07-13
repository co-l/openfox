import type { ModelConfig } from '../../../shared/types.js'

const MODELS_DEV_URL = 'https://models.dev/api.json'
const CACHE_TTL_MS = 5 * 60_000
const DISALLOWED_MODELS = new Set(['gpt-5.5-pro'])

interface ModelsDevMode {
  provider?: {
    body?: Record<string, unknown>
  }
}

interface ModelsDevReasoningOption {
  type?: string
  values?: string[]
}

interface ModelsDevModel {
  id: string
  name?: string
  status?: string
  reasoning_options?: ModelsDevReasoningOption[]
  experimental?: { modes?: Record<string, ModelsDevMode> }
  limit?: { context?: number; input?: number; output?: number }
  modalities?: { input?: string[]; output?: string[] }
}

interface ModelsDevProvider {
  models?: Record<string, ModelsDevModel>
}

interface ModelsDevResponse {
  openai?: ModelsDevProvider
}

let cache: { expiresAt: number; models: ModelConfig[] } | undefined

export async function fetchCodexModels(fetcher: typeof fetch = fetch): Promise<ModelConfig[]> {
  if (cache && cache.expiresAt > Date.now()) return structuredClone(cache.models)

  const response = await fetcher(MODELS_DEV_URL, {
    headers: { Accept: 'application/json', 'User-Agent': 'openfox' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`models.dev HTTP ${response.status}`)
  const data = (await response.json()) as ModelsDevResponse
  const models = Object.values(data.openai?.models ?? {})
    .filter(isCodexCompatible)
    .flatMap(projectModelAndModes)
    .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }))

  if (models.length === 0) throw new Error('models.dev returned no Codex-compatible OpenAI models')
  cache = { expiresAt: Date.now() + CACHE_TTL_MS, models }
  return structuredClone(models)
}

export function clearCodexModelsCache(): void {
  cache = undefined
}

function projectModelAndModes(model: ModelsDevModel): ModelConfig[] {
  const base = toModelConfig(model)
  const modes = Object.entries(model.experimental?.modes ?? {}).map(([mode, config]) => ({
    ...base,
    id: `${model.id}-${mode}`,
    name: `${model.name ?? model.id} ${capitalize(mode)}`,
    apiModelId: model.id,
    ...(config.provider?.body && { requestBody: structuredClone(config.provider.body) }),
  }))
  return [base, ...modes]
}

function toModelConfig(model: ModelsDevModel): ModelConfig {
  const reasoningEfforts = model.reasoning_options
    ?.filter((option) => option.type === 'effort')
    .flatMap((option) => option.values ?? [])

  return {
    id: model.id,
    name: model.name ?? model.id,
    apiModelId: model.id,
    contextWindow: model.limit?.context ?? 200000,
    source: 'backend',
    selected: true,
    supportsVision: model.modalities?.input?.includes('image') ?? false,
    ...(model.limit?.output && { defaultMaxTokens: model.limit.output }),
    ...(reasoningEfforts?.length && { reasoningEfforts: [...new Set(reasoningEfforts)] }),
  }
}

function capitalize(value: string): string {
  return value.length > 0 ? value[0]!.toUpperCase() + value.slice(1) : value
}

function isCodexCompatible(model: ModelsDevModel): boolean {
  if (model.status === 'deprecated') return false
  if (DISALLOWED_MODELS.has(model.id)) return false
  return model.id.includes('codex') || model.id.startsWith('gpt-5')
}
