import type { Provider, Config, LlmBackend, ModelConfig } from '../shared/types.js'
import type { ProviderRegistry } from './providers/plugins/registry.js'
import { createTransportLLMClient } from './providers/adapters/transport-client.js'
import { createLLMClient, clearModelCache, getModelProfile, type LLMClientWithModel } from './llm/index.js'
import { logger } from './utils/logger.js'
import { ensureVersionPrefix, stripVersionPrefix, buildModelsUrl } from './llm/url-utils.js'

function normalizeModelId(s: string): string {
  return s.toLowerCase().replace(/[-_\s:.]+/g, '')
}

async function fetchModelsFromBackend(
  url: string,
  apiKey?: string,
): Promise<{ id: string; contextWindow: number | undefined }[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  try {
    const response = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(10000) })
    if (!response.ok) {
      logger.debug('Failed to fetch models', { url, status: response.status })
      return []
    }
    const data = (await response.json()) as { data?: { id: string; max_model_len?: number }[] }
    if (data.data && Array.isArray(data.data)) {
      return data.data.map((m) => ({
        id: m.id,
        contextWindow: m.max_model_len ?? undefined,
      }))
    }
    return []
  } catch (error) {
    logger.debug('Error fetching models', { url, error: error instanceof Error ? error.message : String(error) })
    return []
  }
}

function enrichWithProfileDefaults(model: ModelConfig): ModelConfig {
  const profile = getModelProfile(model.id)
  return {
    ...model,
    defaultTemperature: profile.temperature,
    defaultTopP: profile.topP,
    ...(profile.topK !== undefined && { defaultTopK: profile.topK }),
    defaultMaxTokens: profile.defaultMaxTokens,
  }
}

function mergeModelsWithUserOverrides(
  backendModels: ModelConfig[],
  userModels: ModelConfig[],
  preserveMissingUserModels = true,
): ModelConfig[] {
  const normalizedUserIdMap = new Map(userModels.map((m) => [normalizeModelId(m.id), m]))

  const updatedModels = backendModels.map((backendModel) => {
    const existingUserModel = normalizedUserIdMap.get(normalizeModelId(backendModel.id))
    if (existingUserModel) {
      return enrichWithProfileDefaults({ ...backendModel, ...existingUserModel, id: backendModel.id })
    }
    return enrichWithProfileDefaults(backendModel)
  })

  if (preserveMissingUserModels) {
    const normalizedBackendIds = new Set(backendModels.map((m) => normalizeModelId(m.id)))
    for (const userModel of userModels) {
      if (!normalizedBackendIds.has(normalizeModelId(userModel.id))) {
        updatedModels.push(enrichWithProfileDefaults(userModel))
      }
    }
  }

  return updatedModels
}

export async function fetchAvailableModelsFromBackend(baseUrl: string, apiKey?: string): Promise<string[]> {
  const url = buildModelsUrl(baseUrl)
  const models = await fetchModelsFromBackend(url, apiKey)
  return models.map((m) => m.id)
}

/** Fetch models with context window metadata */
export async function fetchModelsWithContext(
  baseUrl: string,
  apiKey?: string,
  backend?: 'ollama' | 'vllm' | 'sglang' | 'llamacpp' | 'lmstudio' | 'unknown',
): Promise<ModelConfig[]> {
  logger.info('fetchModelsWithContext called', { baseUrl, apiKey: !!apiKey, backend })

  // Ollama uses /api/show for context detection
  if (backend === 'ollama') {
    logger.info('Fetching Ollama models via /api/tags and /api/show')
    return fetchOllamaModelsWithContext(baseUrl, apiKey)
  }

  // LM Studio has a native /api/v1/models endpoint with loaded context info
  if (backend === 'lmstudio') {
    logger.info('Fetching LM Studio models via /api/v1/models')
    const lmStudioModels = await fetchLmStudioModelsWithContext(baseUrl, apiKey)
    if (lmStudioModels.length > 0) return lmStudioModels
    logger.info('LM Studio native endpoint unavailable, falling back to /v1/models')
  }

  // OpenCode Go has models at /zen/v1/models not /zen/go/v1/models
  const isOpenCodeGo = baseUrl.includes('opencode.ai/zen/go')
  const url = isOpenCodeGo ? buildModelsUrl(baseUrl.replace('/zen/go', '/zen')) : buildModelsUrl(baseUrl)

  logger.info('Fetching models via /v1/models', { url })
  const models = await fetchModelsFromBackend(url, apiKey)

  if (models.length === 0) return []

  logger.info('Fetched models from /v1/models', { count: models.length })
  return models.map((m) => ({
    id: m.id,
    contextWindow: m.contextWindow ?? 200000,
    source: m.contextWindow ? 'backend' : ('default' as const),
  }))
}

/** Fetch Ollama models with context windows via /api/show */
async function fetchOllamaModelsWithContext(baseUrl: string, _apiKey?: string): Promise<ModelConfig[]> {
  // First get list of models from /api/tags
  const tagsUrl = `${baseUrl}/api/tags`

  try {
    const tagsResponse = await fetch(tagsUrl, {
      signal: AbortSignal.timeout(10000),
    })

    if (!tagsResponse.ok) {
      logger.debug('Failed to fetch Ollama tags', { url: tagsUrl })
      return []
    }

    const tagsData = (await tagsResponse.json()) as { models?: Array<{ name: string }> }
    if (!tagsData.models || !Array.isArray(tagsData.models)) {
      return []
    }

    // Fetch context info for each model via /api/show
    const modelsWithContext: ModelConfig[] = []
    for (const model of tagsData.models) {
      try {
        const showUrl = `${baseUrl}/api/show`
        const showResponse = await fetch(showUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: model.name, verbose: true }),
          signal: AbortSignal.timeout(5000),
        })

        if (showResponse.ok) {
          const showData = (await showResponse.json()) as {
            model_info?: {
              llama?: { context_length?: number }
              context_length?: number
            }
          }

          const contextLength =
            showData.model_info?.llama?.context_length ?? showData.model_info?.context_length ?? 200000
          modelsWithContext.push({
            id: model.name,
            contextWindow: contextLength,
            source: contextLength !== 200000 ? 'backend' : ('default' as const),
          })
        } else {
          // Fall back to default if /api/show fails
          modelsWithContext.push({
            id: model.name,
            contextWindow: 200000,
            source: 'default' as const,
          })
        }
      } catch (error) {
        logger.debug('Failed to fetch Ollama model context', {
          model: model.name,
          error: error instanceof Error ? error.message : String(error),
        })
        // Fall back to default
        modelsWithContext.push({
          id: model.name,
          contextWindow: 200000,
          source: 'default' as const,
        })
      }
    }

    return modelsWithContext
  } catch (error) {
    logger.info('Error fetching Ollama models', {
      url: baseUrl,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

/** Fetch LM Studio models with context windows via native /api/v1/models */
async function fetchLmStudioModelsWithContext(baseUrl: string, _apiKey?: string): Promise<ModelConfig[]> {
  const base = baseUrl.replace(/\/+$/, '')
  // LM Studio native endpoint is at /api/v1/models (not under /v1/)
  const nativeUrl = `${base.replace(/\/v\d+\/?$/, '')}/api/v1/models`

  try {
    logger.info('Fetching LM Studio native models', { url: nativeUrl })
    const response = await fetch(nativeUrl, {
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      logger.info('LM Studio native endpoint returned error', { url: nativeUrl, status: response.status })
      return []
    }

    const raw = (await response.json()) as Record<string, unknown>
    // Handle bare array [...], { data: [...] }, or { models: [...] } formats
    const rawArray = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as { models?: unknown }).models)
        ? (raw as { models: unknown[] }).models
        : Array.isArray((raw as { data?: unknown }).data)
          ? (raw as { data: unknown[] }).data
          : []
    const modelList = rawArray as Array<{
      key?: string
      id?: string
      max_context_length?: number
      loaded_instances?: Array<{
        id?: string
        config?: { context_length?: number }
      }>
    }>

    if (modelList.length === 0) {
      logger.info('LM Studio native endpoint returned no models', { url: nativeUrl })
      return []
    }

    logger.info('LM Studio native models found', { count: modelList.length })

    return modelList.map((model) => {
      const modelId = model.key ?? model.id ?? ''
      // Prefer loaded instance context, fall back to max context
      const loadedContext = model.loaded_instances?.[0]?.config?.context_length
      const maxContext = model.max_context_length
      const contextWindow = loadedContext ?? maxContext ?? 200000

      logger.info('LM Studio model detected', {
        modelId,
        loadedContext,
        maxContext,
        contextWindow,
      })

      return {
        id: modelId,
        contextWindow,
        source: loadedContext || maxContext ? 'backend' : ('default' as const),
      }
    })
  } catch (error) {
    logger.info('Error fetching LM Studio native models', {
      url: nativeUrl,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

export interface ModelSettingsUpdate {
  contextWindow?: number
  temperature?: number | null
  topP?: number | null
  topK?: number | null
  maxTokens?: number | null
  supportsVision?: boolean
  thinkingEnabled?: boolean
  thinkingLevel?: string
  nonThinkingEnabled?: boolean
  thinkingExtraKwargs?: string
  nonThinkingExtraKwargs?: string
  thinkingQueryParams?: string
  nonThinkingQueryParams?: string
}

export interface ProviderManager {
  getProviders(): Provider[]
  createClient(providerId: string, model: string): LLMClientWithModel | undefined
  resolveModel(providerId: string, model?: string): string | undefined
  getActiveProvider(): Provider | undefined
  getActiveProviderId(): string | undefined
  getCurrentModel(): string | undefined
  getCurrentModelContext(): number
  getLLMClient(): LLMClientWithModel
  activateProvider(providerId: string, options?: { model?: string }): Promise<{ success: boolean; error?: string }>
  addProvider(provider: Omit<Provider, 'id' | 'createdAt'>): Provider
  removeProvider(providerId: string): boolean
  setProviders(providers: Provider[], defaultModelSelection?: string): void
  getProviderStatus(providerId: string): 'connected' | 'disconnected' | 'unknown'
  getProviderModels(providerId: string): Promise<ModelConfig[]>
  setDefaultModelSelection(providerId: string, model: string): Promise<{ success: boolean; error?: string }>
  updateModelContext(
    providerId: string,
    modelId: string,
    contextWindow: number,
  ): Promise<{ success: boolean; error?: string }>
  updateModelSettings(
    providerId: string,
    modelId: string,
    settings: ModelSettingsUpdate,
  ): Promise<{ success: boolean; error?: string; model?: ModelConfig }>
  refreshProviderModels(providerId: string): Promise<{ success: boolean; error?: string }>
  getModelSettings(
    providerId: string,
    modelId: string,
    mode?: 'thinking' | 'non-thinking',
  ):
    | {
        temperature?: number
        topP?: number
        topK?: number
        maxTokens?: number
        supportsVision?: boolean
        chatTemplateKwargs?: Record<string, unknown>
        queryParams?: Record<string, unknown>
      }
    | undefined
}

export function parseDefaultModelSelection(selection?: string): {
  providerId: string | undefined
  model: string | undefined
} {
  if (!selection) return { providerId: undefined, model: undefined }
  const slashIndex = selection.indexOf('/')
  if (slashIndex === -1) return { providerId: selection, model: undefined }
  return {
    providerId: selection.substring(0, slashIndex),
    model: selection.substring(slashIndex + 1),
  }
}

export interface ProviderManagerOptions {
  adapters?: ProviderRegistry
}

export function createProviderManager(config: Config, options: ProviderManagerOptions = {}): ProviderManager {
  let providers: Provider[] = [...(config.providers ?? [])]
  // Enrich all models with profile defaults for display
  providers = providers.map((p) => ({ ...p, models: p.models.map((m) => enrichWithProfileDefaults(m)) }))
  let defaultModelSelection: string | undefined = config.defaultModelSelection
  let llmClient = createLLMClient(config)
  const providerStatus = new Map<string, 'connected' | 'disconnected' | 'unknown'>()

  logger.debug('ProviderManager created', {
    providers: providers.map((p) => ({
      id: p.id,
      models: p.models.map((m) => ({ id: m.id, contextWindow: m.contextWindow, source: m.source })),
    })),
  })

  for (const p of providers) {
    providerStatus.set(p.id, 'unknown')
  }

  function resolveModelThinkingConfig(provider: Provider, modelId: string): { reasoningEffort?: string } {
    const modelConfig = provider.models.find((m) => m.id === modelId)
    if (!modelConfig) return {}
    if (modelConfig.thinkingEnabled && modelConfig.thinkingLevel) {
      return { reasoningEffort: modelConfig.thinkingLevel }
    }
    return {}
  }

  function createConfigForProvider(provider: Provider, model: string): Config {
    const modelThinking = resolveModelThinkingConfig(provider, model)
    return {
      ...config,
      llm: {
        ...config.llm,
        baseUrl: ensureVersionPrefix(provider.url),
        model,
        backend: provider.backend as LlmBackend,
        ...(provider.apiKey && { apiKey: provider.apiKey }),
        ...(provider.thinkingField && { thinkingField: provider.thinkingField }),
        ...(modelThinking.reasoningEffort && { reasoningEffort: modelThinking.reasoningEffort }),
      },
    }
  }

  function resolveTransportAdapter(provider: Provider): string | undefined {
    if (provider.transportAdapter) return provider.transportAdapter
    return undefined
  }

  function resolveProviderModel(provider: Provider, requestedModel?: string): string {
    if (requestedModel && requestedModel !== 'auto') return requestedModel

    const activeSelection = parseDefaultModelSelection(defaultModelSelection)
    if (activeSelection.providerId === provider.id) {
      const activeClientModel = llmClient.getModel()
      if (
        activeClientModel &&
        activeClientModel !== 'auto' &&
        provider.models.some((m) => m.id === activeClientModel)
      ) {
        return activeClientModel
      }
      if (
        activeSelection.model &&
        activeSelection.model !== 'auto' &&
        provider.models.some((m) => m.id === activeSelection.model)
      ) {
        return activeSelection.model
      }
    }

    return provider.models.find((m) => m.selected)?.id ?? provider.models[0]?.id ?? requestedModel ?? 'auto'
  }

  function createClientForProvider(provider: Provider, model?: string): LLMClientWithModel {
    const resolvedModel = resolveProviderModel(provider, model)
    const transport = options.adapters?.getTransport(resolveTransportAdapter(provider))
    return transport
      ? createTransportLLMClient(provider, resolvedModel, transport)
      : createLLMClient(createConfigForProvider(provider, resolvedModel))
  }

  async function fetchProviderModels(provider: Provider): Promise<ModelConfig[]> {
    const transport = options.adapters?.getTransport(resolveTransportAdapter(provider))
    if (transport) {
      return transport.listModels({
        providerId: provider.id,
        ...(provider.credentialRef && { credentialRef: provider.credentialRef }),
      })
    }

    const backend = provider.backend as 'ollama' | 'vllm' | 'sglang' | 'llamacpp' | 'unknown'
    return fetchModelsWithContext(provider.url, provider.apiKey, backend)
  }

  // Initialize the LLM client with the active provider's config (URL, model, apiKey, etc.)
  // so the global client points to the correct backend from the start.
  const { providerId: activeProviderId, model: activeModel } = parseDefaultModelSelection(defaultModelSelection)
  if (activeProviderId && activeModel) {
    const activeProvider = providers.find((p) => p.id === activeProviderId)
    if (activeProvider) {
      llmClient = createClientForProvider(activeProvider, activeModel)
    }
  }

  return {
    createClient(providerId: string, model: string) {
      const provider = providers.find((p) => p.id === providerId)
      return provider ? createClientForProvider(provider, model) : undefined
    },

    resolveModel(providerId: string, model?: string) {
      const provider = providers.find((p) => p.id === providerId)
      return provider ? resolveProviderModel(provider, model) : undefined
    },

    getProviders() {
      return providers.map((p) => ({
        ...p,
        status: providerStatus.get(p.id) ?? 'unknown',
      }))
    },

    getActiveProvider() {
      const { providerId } = parseDefaultModelSelection(defaultModelSelection)
      if (!providerId) return undefined
      return providers.find((p) => p.id === providerId)
    },

    getActiveProviderId() {
      const { providerId } = parseDefaultModelSelection(defaultModelSelection)
      return providerId
    },

    getCurrentModel() {
      const { model } = parseDefaultModelSelection(defaultModelSelection)
      return model
    },

    getLLMClient() {
      return llmClient
    },

    async activateProvider(providerId: string, options?: { model?: string }) {
      const provider = providers.find((p) => p.id === providerId)
      if (!provider) {
        return { success: false, error: 'Provider not found' }
      }

      const currentModel = parseDefaultModelSelection(defaultModelSelection).model
      const targetModel = resolveProviderModel(provider, options?.model ?? currentModel)
      const isModelSwitch =
        providerId === parseDefaultModelSelection(defaultModelSelection).providerId &&
        options?.model &&
        options.model !== currentModel

      if (
        providerId === parseDefaultModelSelection(defaultModelSelection).providerId &&
        !isModelSwitch &&
        llmClient.getModel() === targetModel
      ) {
        if (currentModel !== targetModel) defaultModelSelection = `${providerId}/${targetModel}`
        return { success: true }
      }

      logger.info('Switching provider', {
        from: parseDefaultModelSelection(defaultModelSelection).providerId,
        to: providerId,
        providerName: provider.name,
        url: provider.url,
        model: targetModel,
      })

      const newClient = createClientForProvider(provider, targetModel)

      try {
        const cacheUrl = stripVersionPrefix(provider.url)
        clearModelCache(cacheUrl)

        // Refetch models from backend when switching providers
        const backend = provider.backend as 'ollama' | 'vllm' | 'sglang' | 'llamacpp' | 'lmstudio' | 'unknown'
        logger.info('activateProvider fetching models', {
          providerId,
          providerName: provider.name,
          url: provider.url,
          backend,
        })
        const modelsWithContext = await fetchProviderModels(provider)

        const userModels = provider.models.filter((m) => m.source === 'user')
        logger.debug('activateProvider', {
          providerId,
          backendModelsCount: modelsWithContext.length,
          userModelsCount: userModels.length,
        })

        if (modelsWithContext.length > 0) {
          const updatedModels = mergeModelsWithUserOverrides(
            modelsWithContext,
            userModels,
            !resolveTransportAdapter(provider),
          )
          providers = providers.map((p) => (p.id === providerId ? { ...p, models: updatedModels } : p))
        } else if (userModels.length > 0) {
          // Backend unavailable but we have user models - preserve them
          logger.debug('Backend unavailable during provider switch, preserving user models', {
            providerId,
            userModelsCount: userModels.length,
          })
          providers = providers.map((p) => (p.id === providerId ? { ...p, models: userModels } : p))
        }

        newClient.setBackend(provider.backend as LlmBackend)

        newClient.setModel(targetModel)

        providerStatus.set(providerId, 'connected')
      } catch (err) {
        logger.warn('Could not connect to provider', {
          providerId,
          error: err instanceof Error ? err.message : String(err),
        })
        providerStatus.set(providerId, 'disconnected')
      }

      providers = providers.map((p) => ({
        ...p,
        isActive: p.id === providerId,
      }))
      defaultModelSelection = `${providerId}/${targetModel}`
      llmClient = newClient

      logger.info('Provider activated', {
        providerId,
        providerName: provider.name,
        model: llmClient.getModel(),
        backend: llmClient.getBackend(),
      })

      return { success: true }
    },

    addProvider(providerData) {
      const id = crypto.randomUUID()
      const provider: Provider = {
        ...providerData,
        id,
        createdAt: new Date().toISOString(),
      }

      if (providerData.isActive || providers.length === 0) {
        providers = providers.map((p) => ({ ...p, isActive: false }))
        provider.isActive = true
        const firstModelId = provider.models?.[0]?.id ?? 'auto'
        defaultModelSelection = `${id}/${firstModelId}`
      }

      providers.push(provider)
      providerStatus.set(id, 'unknown')

      return provider
    },

    removeProvider(providerId) {
      const index = providers.findIndex((p) => p.id === providerId)
      if (index === -1) return false

      const wasActive = providers[index]?.isActive
      providers.splice(index, 1)
      providerStatus.delete(providerId)

      if (wasActive && providers.length > 0) {
        providers[0]!.isActive = true
        const firstModelId = providers[0]?.models?.[0]?.id ?? 'auto'
        defaultModelSelection = `${providers[0]!.id}/${firstModelId}`
      } else if (providers.length === 0) {
        defaultModelSelection = undefined
      }

      return true
    },

    setProviders(newProviders, newDefaultModelSelection) {
      providers = [...newProviders]
      defaultModelSelection = newDefaultModelSelection

      providerStatus.clear()
      for (const p of providers) {
        providerStatus.set(p.id, 'unknown')
      }

      // Provider metadata can change without changing the active provider ID. Always rebuild
      // the active client so it receives the latest auth and transport context.
      const activeProviderId = this.getActiveProviderId()
      if (activeProviderId) {
        const activeProvider = providers.find((p) => p.id === activeProviderId)
        if (activeProvider) {
          llmClient = createClientForProvider(activeProvider, this.getCurrentModel())
          logger.info('setProviders: recreated LLM client for active provider', {
            providerId: activeProviderId,
            url: activeProvider.url,
            hasCredential: Boolean(activeProvider.credentialRef),
            transportAdapter: resolveTransportAdapter(activeProvider),
          })
        }
      }
    },

    getProviderStatus(providerId) {
      return providerStatus.get(providerId) ?? 'unknown'
    },

    async getProviderModels(providerId: string): Promise<ModelConfig[]> {
      const provider = providers.find((p) => p.id === providerId)
      if (!provider) {
        return []
      }

      // Return stored models with context info
      if (provider.models && provider.models.length > 0) {
        return provider.models
      }

      // Fallback: fetch from backend if no stored models
      return fetchProviderModels(provider)
    },

    async setDefaultModelSelection(providerId: string, model: string) {
      const provider = providers.find((p) => p.id === providerId)
      if (!provider) {
        return { success: false, error: 'Provider not found' }
      }

      logger.info('Setting default model selection', { providerId, model, providerName: provider.name })

      defaultModelSelection = `${providerId}/${model}`
      providers = providers.map((p) => ({ ...p, isActive: p.id === providerId }))

      const currentProviderId = parseDefaultModelSelection(defaultModelSelection).providerId
      if (currentProviderId === providerId) {
        llmClient.setModel(model)
        logger.info('Model updated', { providerId, model })
      }

      return { success: true }
    },

    getCurrentModelContext(): number {
      const { providerId, model } = parseDefaultModelSelection(defaultModelSelection)
      if (!providerId || !model) return config.context.maxTokens

      const provider = providers.find((p) => p.id === providerId)
      if (!provider) return config.context.maxTokens

      const modelConfig = provider.models.find((m) => m.id === model)
      return modelConfig?.contextWindow ?? config.context.maxTokens
    },

    async updateModelContext(providerId: string, modelId: string, contextWindow: number) {
      const provider = providers.find((p) => p.id === providerId)
      if (!provider) {
        return { success: false, error: 'Provider not found' }
      }

      const modelIndex = provider.models.findIndex((m) => m.id === modelId)
      if (modelIndex === -1) {
        providers = providers.map((p) =>
          p.id === providerId
            ? { ...p, models: [...p.models, { id: modelId, contextWindow, source: 'user' as const }] }
            : p,
        )
      } else {
        providers = providers.map((p) =>
          p.id === providerId
            ? {
                ...p,
                models: p.models.map((m, i) =>
                  i === modelIndex ? { ...m, contextWindow, source: 'user' as const } : m,
                ),
              }
            : p,
        )
      }

      logger.info('Model context updated', { providerId, modelId, contextWindow })
      return { success: true }
    },

    async updateModelSettings(providerId: string, modelId: string, settings: ModelSettingsUpdate) {
      const provider = providers.find((p) => p.id === providerId)
      if (!provider) {
        return { success: false, error: 'Provider not found' }
      }

      const existingModel = provider.models.find((m) => m.id === modelId)

      // Merge new settings with existing settings
      const finalTemp =
        settings.temperature !== undefined && settings.temperature !== null
          ? settings.temperature
          : existingModel?.temperature
      const finalTopP = settings.topP !== undefined && settings.topP !== null ? settings.topP : existingModel?.topP
      const finalTopK = settings.topK !== undefined && settings.topK !== null ? settings.topK : existingModel?.topK
      const finalMaxTokens =
        settings.maxTokens !== undefined && settings.maxTokens !== null ? settings.maxTokens : existingModel?.maxTokens
      const finalSupportsVision =
        settings.supportsVision !== undefined ? settings.supportsVision : existingModel?.supportsVision

      logger.info('Updating model settings', {
        providerId,
        modelId,
        existing: existingModel,
        incoming: settings,
        final: {
          temperature: finalTemp,
          topP: finalTopP,
          topK: finalTopK,
          maxTokens: finalMaxTokens,
          supportsVision: finalSupportsVision,
        },
      })

      // Merge with existing model to preserve any other settings
      const updatedModel: ModelConfig = enrichWithProfileDefaults({
        id: modelId,
        contextWindow: settings.contextWindow ?? existingModel?.contextWindow ?? 200000,
        source: 'user',
        ...(finalTemp !== undefined && { temperature: finalTemp }),
        ...(finalTopP !== undefined && { topP: finalTopP }),
        ...(finalTopK !== undefined && { topK: finalTopK }),
        ...(finalMaxTokens !== undefined && { maxTokens: finalMaxTokens }),
        ...(finalSupportsVision !== undefined && { supportsVision: finalSupportsVision }),
        ...(settings.thinkingEnabled !== undefined
          ? { thinkingEnabled: settings.thinkingEnabled }
          : existingModel?.thinkingEnabled !== undefined
            ? { thinkingEnabled: existingModel.thinkingEnabled }
            : {}),
        ...(settings.thinkingLevel !== undefined
          ? { thinkingLevel: settings.thinkingLevel }
          : existingModel?.thinkingLevel !== undefined
            ? { thinkingLevel: existingModel.thinkingLevel }
            : {}),
        ...(settings.nonThinkingEnabled !== undefined
          ? { nonThinkingEnabled: settings.nonThinkingEnabled }
          : existingModel?.nonThinkingEnabled !== undefined
            ? { nonThinkingEnabled: existingModel.nonThinkingEnabled }
            : {}),
        ...(settings.thinkingExtraKwargs !== undefined
          ? { thinkingExtraKwargs: settings.thinkingExtraKwargs }
          : existingModel?.thinkingExtraKwargs !== undefined
            ? { thinkingExtraKwargs: existingModel.thinkingExtraKwargs }
            : {}),
        ...(settings.nonThinkingExtraKwargs !== undefined
          ? { nonThinkingExtraKwargs: settings.nonThinkingExtraKwargs }
          : existingModel?.nonThinkingExtraKwargs !== undefined
            ? { nonThinkingExtraKwargs: existingModel.nonThinkingExtraKwargs }
            : {}),
        ...(settings.thinkingQueryParams !== undefined
          ? { thinkingQueryParams: settings.thinkingQueryParams }
          : existingModel?.thinkingQueryParams !== undefined
            ? { thinkingQueryParams: existingModel.thinkingQueryParams }
            : {}),
        ...(settings.nonThinkingQueryParams !== undefined
          ? { nonThinkingQueryParams: settings.nonThinkingQueryParams }
          : existingModel?.nonThinkingQueryParams !== undefined
            ? { nonThinkingQueryParams: existingModel.nonThinkingQueryParams }
            : {}),
      })

      if (existingModel) {
        providers = providers.map((p) =>
          p.id === providerId ? { ...p, models: p.models.map((m) => (m.id === modelId ? updatedModel : m)) } : p,
        )
      } else {
        providers = providers.map((p) => (p.id === providerId ? { ...p, models: [...p.models, updatedModel] } : p))
      }

      logger.info('Model settings updated', { providerId, modelId, final: updatedModel })
      return { success: true, model: updatedModel }
    },

    getModelSettings(providerId: string, modelId: string, mode: 'thinking' | 'non-thinking' = 'thinking') {
      const provider = providers.find((p) => p.id === providerId)
      const model = provider?.models.find((m) => m.id === modelId)
      if (!model) return undefined

      const baseSettings: Record<string, unknown> = {}
      if (model['temperature'] !== undefined) baseSettings['temperature'] = model['temperature']
      if (model['topP'] !== undefined) baseSettings['topP'] = model['topP']
      if (model['topK'] !== undefined) baseSettings['topK'] = model['topK']
      if (model['maxTokens'] !== undefined) baseSettings['maxTokens'] = model['maxTokens']
      if (model['supportsVision'] !== undefined) baseSettings['supportsVision'] = model['supportsVision']

      // User-configured queryParams take priority
      const rawQueryParams = mode === 'thinking' ? model.thinkingQueryParams : model.nonThinkingQueryParams
      if (rawQueryParams) {
        return { ...baseSettings, queryParams: JSON.parse(rawQueryParams) as Record<string, unknown> }
      }

      // Generate sensible defaults when mode is enabled
      const modeEnabled = mode === 'thinking' ? model.thinkingEnabled : model.nonThinkingEnabled
      if (modeEnabled) {
        return {
          ...baseSettings,
          chatTemplateKwargs: mode === 'thinking' ? { enable_thinking: true } : { enable_thinking: false },
        }
      }

      // Fall back to the other mode's queryParams
      const fallbackRawQP = mode === 'thinking' ? model.nonThinkingQueryParams : model.thinkingQueryParams
      if (fallbackRawQP) {
        return { ...baseSettings, queryParams: JSON.parse(fallbackRawQP) as Record<string, unknown> }
      }

      return undefined
    },

    async refreshProviderModels(providerId: string) {
      const provider = providers.find((p) => p.id === providerId)
      if (!provider) {
        return { success: false, error: 'Provider not found' }
      }

      const backend = provider.backend as 'ollama' | 'vllm' | 'sglang' | 'llamacpp' | 'lmstudio' | 'unknown'
      logger.info('refreshProviderModels fetching models', {
        providerId,
        providerName: provider.name,
        url: provider.url,
        backend,
      })
      const modelsWithContext = await fetchProviderModels(provider)

      // Preserve user-set models even if backend fetch fails or returns empty
      const userModels = provider.models.filter((m) => m.source === 'user')
      logger.info('refreshProviderModels', {
        providerId,
        userModelsCount: userModels.length,
        backendModelsCount: modelsWithContext.length,
      })

      if (modelsWithContext.length === 0) {
        providerStatus.set(providerId, 'disconnected')
        // Keep existing user models when backend is unavailable
        if (userModels.length > 0) {
          logger.debug('Backend unavailable, preserving user models', {
            providerId,
            userModels: userModels.map((m) => ({ id: m.id, contextWindow: m.contextWindow })),
          })
          providers = providers.map((p) => (p.id === providerId ? { ...p, models: userModels } : p))
          return { success: true }
        }
        return { success: false, error: 'No models returned from backend' }
      }

      providerStatus.set(providerId, 'connected')

      const updatedModels = mergeModelsWithUserOverrides(
        modelsWithContext,
        userModels,
        !resolveTransportAdapter(provider),
      )
      providers = providers.map((p) => (p.id === providerId ? { ...p, models: updatedModels } : p))

      // Update defaultModelSelection if the model ID was changed due to fuzzy matching
      const { providerId: currentProviderId, model: currentModel } = parseDefaultModelSelection(defaultModelSelection)
      if (currentProviderId === providerId && currentModel) {
        const normalizedCurrentModel = normalizeModelId(currentModel)
        const matchedModel = updatedModels.find((m) => normalizeModelId(m.id) === normalizedCurrentModel)
        if (matchedModel && matchedModel.id !== currentModel) {
          defaultModelSelection = `${providerId}/${matchedModel.id}`
          logger.debug('Updated defaultModelSelection after fuzzy match', { from: currentModel, to: matchedModel.id })
        }
      }
      logger.info('Provider models refreshed', { providerId, modelCount: updatedModels.length })
      return { success: true }
    },
  }
}
