/**
 * Canonical "providerId/model:reasoningEffort" value handling.
 *
 * A provider/model selection is represented as a single string so it can flow
 * through pickers and agent overrides unchanged. The effort is an optional
 * `:effort` suffix on the model id. Model ids may themselves contain ':' (e.g.
 * ollama tags like "deepseek-r1:70b"), so parsing only treats the suffix as an
 * effort when it matches a known reasoning-effort value.
 *
 * The effort vocabulary is shared with the server (`src/shared/reasoning-effort.ts`)
 * so the UI accepts exactly the values the server validates.
 */

import { REASONING_EFFORT_VALUES, isReasoningEffortValue } from '@shared/reasoning-effort.js'
import type { Message } from '@shared/types.js'

export { REASONING_EFFORT_VALUES, isReasoningEffortValue }

export type ReasoningEffortValue = (typeof REASONING_EFFORT_VALUES)[number]

export interface ModelValue {
  providerId: string
  model: string
  reasoningEffort?: string
}

export function formatModelValue(providerId: string, model: string, reasoningEffort?: string): string {
  const suffix = reasoningEffort && isReasoningEffortValue(reasoningEffort) ? `:${reasoningEffort}` : ''
  return `${providerId}/${model}${suffix}`
}

export function parseModelValue(value: string | undefined | null): ModelValue | undefined {
  if (!value) return undefined
  const slashIndex = value.indexOf('/')
  if (slashIndex <= 0) return undefined
  const providerId = value.substring(0, slashIndex)
  const rest = value.substring(slashIndex + 1)
  if (!rest) return undefined

  const colonIndex = rest.lastIndexOf(':')
  if (colonIndex > 0) {
    const candidate = rest.substring(colonIndex + 1)
    if (isReasoningEffortValue(candidate)) {
      return { providerId, model: rest.substring(0, colonIndex), reasoningEffort: candidate }
    }
  }
  return { providerId, model: rest }
}

/**
 * Format a model ID and optional reasoning effort into a short display label.
 * Strips any provider prefixes ("provider/model" -> "model") and appends ":effort" if present.
 */
export function formatShortModelLabel(model: string, reasoningEffort?: string | null): string {
  const shortModel = model.split('/').pop() ?? model
  return reasoningEffort ? `${shortModel}:${reasoningEffort}` : shortModel
}

/**
 * Resolves the display model label for a sub-agent execution context.
 * Priority order:
 * 1. Last assistant message stats from executed turns (most authoritative runtime source).
 * 2. Agent-specific model override (configured per-agent override).
 * 3. Session provider model override (active session model).
 * 4. Global default model selection.
 */
export function resolveSubAgentModelLabel({
  messages,
  subAgentType,
  modelOverrides,
  sessionProviderModel,
  sessionReasoningEffort,
  defaultModelSelection,
}: {
  messages?: Message[]
  subAgentType: string
  modelOverrides?: Record<string, string>
  sessionProviderModel?: string | null
  sessionReasoningEffort?: string | null
  defaultModelSelection?: string | null
}): string | undefined {
  // 1. Message stats from executed turns (runtime stats)
  if (messages && messages.length > 0) {
    const lastStats = messages.findLast((m) => m.role === 'assistant' && m.stats && !('error' in m.stats))?.stats
    if (lastStats?.model) {
      return formatShortModelLabel(lastStats.model, lastStats.reasoningEffort)
    }
  }

  // 2. Agent model override
  const override = modelOverrides?.[subAgentType]
  if (override) {
    const parsed = parseModelValue(override)
    if (parsed?.model) {
      return formatShortModelLabel(parsed.model, parsed.reasoningEffort)
    }
  }

  // 3. Session provider model override
  if (sessionProviderModel) {
    return formatShortModelLabel(sessionProviderModel, sessionReasoningEffort)
  }

  // 4. Global default model selection
  if (defaultModelSelection) {
    const parsedDefault = parseModelValue(defaultModelSelection)
    if (parsedDefault?.model) {
      return formatShortModelLabel(parsedDefault.model, parsedDefault.reasoningEffort)
    }
  }

  return undefined
}
