/**
 * Auto-config: probes a backend to discover working thinking/non-thinking params
 * and context window size for each model.
 */

import { logger } from '../utils/logger.js'
import { ensureVersionPrefix } from '../llm/url-utils.js'

// ============================================================================
// Types
// ============================================================================

export interface ModelProbeResult {
  id: string
  contextWindow: number
  contextSource: 'backend' | 'hardcoded' | 'default'
  supportsVision: boolean
  thinkingConfig: Record<string, unknown> | null
  nonThinkingConfig: Record<string, unknown> | null
}

export interface AutoConfigInput {
  url: string
  apiKey?: string
  backend: string
  models: Array<{ id: string }>
}

export interface AutoConfigOutput {
  models: ModelProbeResult[]
}

// ============================================================================
// Combo definitions
// ============================================================================

const NON_THINKING_COMBOS: Record<string, unknown>[] = [
  {},
  { reasoning_effort: 'none' },
  { chat_template_kwargs: { enable_thinking: false } },
  { thinking: { type: 'disabled' } },
  { reasoning_effort: 'none', chat_template_kwargs: { enable_thinking: false } },
]

const THINKING_COMBOS: Record<string, unknown>[] = [
  { reasoning_effort: 'high' },
  { chat_template_kwargs: { enable_thinking: true } },
  { thinking: { type: 'enabled' } },
  { reasoning_effort: 'high', thinking: { type: 'enabled' } },
]

// ============================================================================
// Context window detection
// ============================================================================

interface ModelInfo {
  contextWindow: number
  source: 'backend' | 'hardcoded' | 'default'
  supportsVision: boolean
}

async function detectModelInfo(
  baseUrl: string,
  apiKey: string | undefined,
  backend: string,
  modelId: string,
): Promise<ModelInfo> {
  // Hardcoded known values for cloud APIs
  if (backend === 'unknown') {
    const known: Record<string, { ctx: number; vision: boolean }> = {
      'deepseek-v4-flash': { ctx: 1_000_000, vision: false },
      'deepseek-v4-pro': { ctx: 1_000_000, vision: false },
      'glm-5.2': { ctx: 1_000_000, vision: false },
      'glm-5.1': { ctx: 1_000_000, vision: false },
      'glm-5': { ctx: 1_000_000, vision: false },
      'glm-5-turbo': { ctx: 1_000_000, vision: false },
      'glm-4.7': { ctx: 128_000, vision: false },
      'glm-4.6': { ctx: 128_000, vision: false },
      'glm-4.5': { ctx: 128_000, vision: false },
      'glm-4-32b-0414-128k': { ctx: 128_000, vision: false },
    }
    const knownVal = known[modelId]
    if (knownVal) return { contextWindow: knownVal.ctx, source: 'hardcoded', supportsVision: knownVal.vision }
  }

  try {
    if (backend === 'ollama') {
      return await detectOllamaInfo(baseUrl, modelId)
    }

    if (backend === 'llamacpp') {
      return await detectLlamacppInfo(baseUrl)
    }

    if (backend === 'lmstudio') {
      return await detectLmstudioInfo(baseUrl, modelId)
    }

    // vLLM and others: try /v1/models
    return await detectVllmInfo(baseUrl, apiKey, modelId)
  } catch {
    return { contextWindow: 200_000, source: 'default', supportsVision: false }
  }
}

async function detectVllmInfo(baseUrl: string, apiKey: string | undefined, modelId: string): Promise<ModelInfo> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  const response = await fetch(`${ensureVersionPrefix(baseUrl)}/models`, { headers, signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  const data = (await response.json()) as { data?: Array<{ id: string; max_model_len?: number }> }
  const model = data.data?.find((m) => m.id === modelId)
  if (model?.max_model_len) {
    return { contextWindow: model.max_model_len, source: 'backend', supportsVision: false }
  }
  throw new Error('No context window in response')
}

async function detectLlamacppInfo(baseUrl: string): Promise<ModelInfo> {
  const response = await fetch(`${baseUrl}/props`, { signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  const data = (await response.json()) as {
    default_generation_settings?: { n_ctx?: number }
    modalities?: { vision?: boolean }
  }
  const nCtx = data.default_generation_settings?.n_ctx
  const supportsVision = data.modalities?.vision ?? false
  if (nCtx) {
    return { contextWindow: nCtx, source: 'backend', supportsVision }
  }
  throw new Error('No n_ctx in props')
}

async function detectOllamaInfo(baseUrl: string, modelId: string): Promise<ModelInfo> {
  const response = await fetch(`${baseUrl}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelId }),
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  const data = (await response.json()) as {
    model_info?: Record<string, unknown>
  }
  const mi = data.model_info ?? {}

  // Context window: key varies by model (llama.context_length, qwen35.context_length, etc.)
  const ctxKey = Object.keys(mi).find((k) => k.endsWith('.context_length') || k === 'context_length')
  const ctxLen = ctxKey ? Number(mi[ctxKey]) : undefined

  // Vision: indicated by vision_start_token_id or .vision. keys in model_info
  const supportsVision = !!mi['vision_start_token_id'] || Object.keys(mi).some((k) => k.includes('.vision.'))

  if (ctxLen && !isNaN(ctxLen)) {
    return { contextWindow: ctxLen, source: 'backend', supportsVision }
  }
  throw new Error('No context_length in model_info')
}

async function detectLmstudioInfo(baseUrl: string, modelId: string): Promise<ModelInfo> {
  const base = baseUrl.replace(/\/+$/, '')
  const nativeUrl = `${base.replace(/\/v\d+\/?$/, '')}/api/v1/models`
  const response = await fetch(nativeUrl, { signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  const data = (await response.json()) as Array<{
    key?: string
    id?: string
    max_context_length?: number
    loaded_instances?: Array<{
      config?: { context_length?: number }
    }>
    capabilities?: { vision?: boolean }
  }>

  const model = data.find((m) => (m.key ?? m.id) === modelId)
  if (!model) throw new Error(`Model ${modelId} not found in LM Studio`)

  const loadedContext = model.loaded_instances?.[0]?.config?.context_length
  const ctxLen = loadedContext ?? model.max_context_length
  const supportsVision = model.capabilities?.vision ?? false

  if (ctxLen) {
    return { contextWindow: ctxLen, source: 'backend', supportsVision }
  }
  throw new Error('No context_length in LM Studio response')
}

// ============================================================================
// Combo probing
// ============================================================================

interface ProbeResult {
  combo: Record<string, unknown>
  httpCode: number
  hasContent: boolean
  durationMs: number
}

async function probeCombo(
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  combo: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ProbeResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: 'say hi in one word' }],
    max_tokens: 50,
    ...combo,
  }

  const start = Date.now()
  try {
    const response = await fetch(`${ensureVersionPrefix(baseUrl)}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    })
    const durationMs = Date.now() - start

    if (!response.ok) {
      return { combo, httpCode: response.status, hasContent: false, durationMs }
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: Record<string, unknown> }>
    }
    const message = data.choices?.[0]?.message ?? {}
    const hasContent = !!(
      message['content'] ||
      message['reasoning'] ||
      message['reasoning_content'] ||
      message['thinking']
    )

    return { combo, httpCode: response.status, hasContent, durationMs }
  } catch {
    const durationMs = Date.now() - start
    return { combo, httpCode: 0, hasContent: false, durationMs }
  }
}

async function probeCombos(
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  combos: Record<string, unknown>[],
): Promise<Record<string, unknown> | null> {
  const timeout = AbortSignal.timeout(15000)
  const results = await Promise.allSettled(combos.map((combo) => probeCombo(baseUrl, apiKey, model, combo, timeout)))

  const successful = results
    .filter(
      (r): r is PromiseFulfilledResult<ProbeResult> =>
        r.status === 'fulfilled' && r.value.httpCode === 200 && r.value.hasContent,
    )
    .map((r) => r.value)
    .sort((a, b) => a.durationMs - b.durationMs)

  if (successful.length > 0) {
    const winner = successful[0]!
    logger.debug('Auto-config: found working combo', {
      model,
      combo: winner.combo,
      durationMs: winner.durationMs,
    })
    return winner.combo
  }

  logger.debug('Auto-config: no working combo found', { model })
  return null
}

// ============================================================================
// Main entry point
// ============================================================================

export async function autoConfig(input: AutoConfigInput): Promise<AutoConfigOutput> {
  const { url, apiKey, backend, models } = input
  const baseUrl = url.replace(/\/+$/, '')

  const results: ModelProbeResult[] = []

  for (const model of models) {
    logger.info('Auto-config probing model', { model: model.id, backend })

    const {
      contextWindow,
      source: contextSource,
      supportsVision,
    } = await detectModelInfo(baseUrl, apiKey, backend, model.id)

    const [thinkingConfig, nonThinkingConfig] = await Promise.all([
      probeCombos(baseUrl, apiKey, model.id, THINKING_COMBOS),
      probeCombos(baseUrl, apiKey, model.id, NON_THINKING_COMBOS),
    ])

    results.push({
      id: model.id,
      contextWindow,
      contextSource,
      supportsVision,
      thinkingConfig,
      nonThinkingConfig,
    })
  }

  return { models: results }
}
