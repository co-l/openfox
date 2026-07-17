import type { LLMClientWithModel } from './client.js'
import type { LLMCompletionRequest, LLMErrorMetadata, LLMStreamEvent } from './types.js'
import { LLMError } from '../utils/errors.js'
import { getSetting, SETTINGS_DEFAULTS, SETTINGS_KEYS } from '../db/settings.js'

interface CascadeEntry {
  providerId: string
  model: string
  client: LLMClientWithModel
}

interface UnavailableState {
  kind: 'cooldown' | 'configuration'
  until?: number
  reason: string
}

function settingMs(key: string): number {
  const fallback = Number(SETTINGS_DEFAULTS[key])
  const value = Number(getSetting(key) ?? fallback)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

class ModelCooldownRegistry {
  private states = new Map<string, UnavailableState>()

  private key(providerId: string, model: string): string {
    return `${providerId}\u0000${model}`
  }

  get(providerId: string, model: string): UnavailableState | undefined {
    const key = this.key(providerId, model)
    const state = this.states.get(key)
    if (state?.until !== undefined && state.until <= Date.now()) {
      this.states.delete(key)
      return undefined
    }
    return state
  }

  mark(
    providerId: string,
    model: string,
    metadata: LLMErrorMetadata,
    overloadMs = settingMs(SETTINGS_KEYS.MODEL_CASCADE_OVERLOAD_COOLDOWN_MS),
    transientMs = settingMs(SETTINGS_KEYS.MODEL_CASCADE_TRANSIENT_COOLDOWN_MS),
  ): void {
    if (metadata.kind === 'abort') return
    const status = metadata.status
    if (status !== undefined && [401, 403, 404].includes(status)) {
      this.states.set(this.key(providerId, model), {
        kind: 'configuration',
        reason: `HTTP ${status}; unavailable until provider configuration changes`,
      })
      return
    }
    const duration =
      status === 429 || status === 503 || metadata.kind === 'overload'
        ? (metadata.retryAfterMs ?? overloadMs)
        : transientMs
    this.states.set(this.key(providerId, model), {
      kind: 'cooldown',
      until: Date.now() + Math.max(0, duration),
      reason: metadata.message ?? (status ? `HTTP ${status}` : metadata.kind),
    })
  }

  clear(): void {
    this.states.clear()
  }

  clearProvider(providerId: string): void {
    for (const key of this.states.keys()) if (key.startsWith(`${providerId}\u0000`)) this.states.delete(key)
  }
}

export const modelCooldownRegistry = new ModelCooldownRegistry()

function errorMetadata(error: unknown): LLMErrorMetadata {
  if (error instanceof LLMError && error.details && typeof error.details === 'object') {
    return error.details as LLMErrorMetadata
  }
  return { kind: 'unknown', message: error instanceof Error ? error.message : String(error) }
}

function displayError(error: string): string {
  const normalized = error.replace(/\s+/g, ' ').trim()
  return normalized.length > 500 ? `${normalized.slice(0, 497)}...` : normalized
}

function attemptSettings(
  entry: CascadeEntry,
  request: LLMCompletionRequest,
): NonNullable<LLMCompletionRequest['modelSettings']> {
  const settings = { ...entry.client.getModelSettings?.(), ...request.modelSettings }
  if (request.maxTokensLimit !== undefined) {
    settings.maxTokens = Math.min(settings.maxTokens ?? 16_384, request.maxTokensLimit)
  }
  return settings
}

function unavailableMessage(entries: CascadeEntry[]): string {
  const details = entries.map(({ providerId, model }) => {
    const state = modelCooldownRegistry.get(providerId, model)
    if (!state) return `${providerId}/${model}: unavailable`
    if (state.until !== undefined)
      return `${providerId}/${model}: ${Math.ceil((state.until - Date.now()) / 1000)}s remaining`
    return `${providerId}/${model}: ${state.reason}`
  })
  return `All configured models are unavailable: ${details.join('; ')}`
}

export function createCascadingLLMClient(entries: CascadeEntry[]): LLMClientWithModel {
  if (entries.length === 0) throw new Error('Model cascade must not be empty')
  let current = entries.find((entry) => !modelCooldownRegistry.get(entry.providerId, entry.model)) ?? entries[0]!

  const selectAvailable = () => {
    const selected = entries.find((entry) => !modelCooldownRegistry.get(entry.providerId, entry.model))
    if (selected) current = selected
    return selected
  }

  return {
    getModel: () => (selectAvailable() ?? current).model,
    getProviderId: () => (selectAvailable() ?? current).providerId,
    getProviderName: () => {
      const selected = selectAvailable() ?? current
      return selected.client.getProviderName?.() ?? selected.providerId
    },
    setModel: () => undefined,
    getProfile: () => (selectAvailable() ?? current).client.getProfile(),
    getBackend: () => (selectAvailable() ?? current).client.getBackend(),
    setBackend: () => undefined,
    getContextWindow: () => Math.min(...entries.map((entry) => entry.client.getContextWindow?.() ?? 200_000)),
    getModelSettings: () => null,
    async complete(request: LLMCompletionRequest) {
      const available = entries.filter((entry) => !modelCooldownRegistry.get(entry.providerId, entry.model))
      if (available.length === 0) throw new LLMError(unavailableMessage(entries), { kind: 'unavailable' })
      let lastError: unknown
      for (const entry of available) {
        current = entry
        try {
          return await entry.client.complete({
            ...request,
            modelSettings: attemptSettings(entry, request),
          })
        } catch (error) {
          lastError = error
          const metadata = errorMetadata(error)
          if (request.signal?.aborted || metadata.kind === 'abort') throw error
          modelCooldownRegistry.mark(entry.providerId, entry.model, metadata)
        }
      }
      throw lastError
    },
    async *stream(request: LLMCompletionRequest): AsyncIterable<LLMStreamEvent> {
      const available = entries.filter((entry) => !modelCooldownRegistry.get(entry.providerId, entry.model))
      if (available.length === 0) {
        yield { type: 'error', error: unavailableMessage(entries), metadata: { kind: 'unavailable' } }
        return
      }
      for (const [index, entry] of available.entries()) {
        current = entry
        let emitted = false
        let failed: (LLMStreamEvent & { type: 'error' }) | undefined
        const attemptRequest = {
          ...request,
          modelSettings: attemptSettings(entry, request),
        }
        for await (const event of entry.client.stream(attemptRequest)) {
          if (event.type === 'error') {
            failed = event
            break
          }
          if (event.type === 'text_delta' || event.type === 'thinking_delta' || event.type === 'tool_call_delta')
            emitted = true
          yield event
        }
        if (!failed) return
        if (request.signal?.aborted || failed.metadata?.kind === 'abort' || emitted) {
          yield failed
          return
        }
        modelCooldownRegistry.mark(
          entry.providerId,
          entry.model,
          failed.metadata ?? { kind: 'unknown', message: failed.error },
        )
        if (available[index + 1]) {
          yield {
            type: 'model_cascade_fallback',
            fallback: {
              providerId: entry.providerId,
              providerName: entry.client.getProviderName?.() ?? entry.providerId,
              model: entry.model,
              error: displayError(failed.metadata?.message ?? failed.error),
            },
          }
        }
      }
      yield { type: 'error', error: unavailableMessage(entries), metadata: { kind: 'unavailable' } }
    },
  }
}
