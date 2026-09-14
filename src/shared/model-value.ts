/**
 * Canonical "providerId/model:reasoningEffort" value handling.
 *
 * A provider/model selection is represented as a single string so it can flow
 * through pickers, workflow steps, and agent overrides unchanged. The effort
 * is an optional `:effort` suffix on the model id. Model ids may themselves
 * contain ':' (e.g. ollama tags like "deepseek-r1:70b"), so parsing only treats
 * the suffix as an effort when it matches a known reasoning-effort value.
 *
 * The effort vocabulary is defined in `src/shared/reasoning-effort.ts`.
 */

import { REASONING_EFFORT_VALUES, isReasoningEffortValue } from './reasoning-effort.js'

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
