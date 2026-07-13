import type { ModelConfig } from '../../../shared/types.js'

const MODELS_DEV_URL = 'https://models.dev/api.json'
const CACHE_TTL_MS = 5 * 60_000
const ALLOWED_GENERAL_MODELS = new Set(['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'])
const DISALLOWED_MODELS = new Set(['gpt-5.5-pro'])

interface ModelsDevModel {
  id: string
  status?: string
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
    .map((model) => ({
      id: model.id,
      contextWindow: model.limit?.context ?? 200000,
      source: 'backend' as const,
      supportsVision: model.modalities?.input?.includes('image') ?? false,
      ...(model.limit?.output && { defaultMaxTokens: model.limit.output }),
    }))
    .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }))

  if (models.length === 0) throw new Error('models.dev returned no Codex-compatible OpenAI models')
  cache = { expiresAt: Date.now() + CACHE_TTL_MS, models }
  return structuredClone(models)
}

export function clearCodexModelsCache(): void {
  cache = undefined
}

function isCodexCompatible(model: ModelsDevModel): boolean {
  if (model.status === 'deprecated') return false
  if (DISALLOWED_MODELS.has(model.id)) return false
  return model.id.includes('codex') || ALLOWED_GENERAL_MODELS.has(model.id)
}
