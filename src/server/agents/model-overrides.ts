/**
 * Agent Model Overrides
 *
 * Per-user overrides mapping an agent id to a specific provider + model.
 * Stored in DB settings as JSON under `agent.modelOverrides`.
 * Absence of an override = agent uses the session/global model.
 */

import { z } from 'zod'
import { getSetting, setSetting, SETTINGS_KEYS } from '../db/settings.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { ProviderManager } from '../provider-manager.js'
import { parseModelValue } from '../../shared/model-value.js'

export const AGENT_MODEL_OVERRIDES_KEY = SETTINGS_KEYS.AGENT_MODEL_OVERRIDES

const overrideSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().min(1).optional(),
})

export type AgentModelOverride = z.infer<typeof overrideSchema>
export type AgentModelOverrides = Record<string, AgentModelOverride>

export function parseStepModelOverride(
  step: { model?: string; providerId?: string; reasoningEffort?: string } | string | undefined | null,
): AgentModelOverride | undefined {
  if (!step) return undefined
  if (typeof step === 'string') {
    const parsed = parseModelValue(step)
    return parsed
      ? {
          providerId: parsed.providerId,
          model: parsed.model,
          ...(parsed.reasoningEffort ? { reasoningEffort: parsed.reasoningEffort } : {}),
        }
      : undefined
  }
  const parsed = step.model ? parseModelValue(step.model) : undefined
  const providerId = step.providerId ?? parsed?.providerId
  const model = parsed ? parsed.model : step.model
  if (!providerId || !model) return undefined
  const effort = step.reasoningEffort ?? parsed?.reasoningEffort
  return {
    providerId,
    model,
    ...(effort ? { reasoningEffort: effort } : {}),
  }
}

export function parseAgentModelOverrides(raw: string | null | undefined): AgentModelOverrides {
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}

  const result: AgentModelOverrides = {}
  for (const [agentId, value] of Object.entries(parsed)) {
    const validated = overrideSchema.safeParse(value)
    if (validated.success) {
      result[agentId] = validated.data
    }
  }
  return result
}

export function getAgentModelOverrides(): AgentModelOverrides {
  return parseAgentModelOverrides(getSetting(AGENT_MODEL_OVERRIDES_KEY))
}

export function getAgentModelOverride(agentId: string): AgentModelOverride | undefined {
  return getAgentModelOverrides()[agentId]
}

export function setAgentModelOverride(agentId: string, override: AgentModelOverride | null): void {
  const overrides = getAgentModelOverrides()
  if (override === null) {
    delete overrides[agentId]
  } else {
    overrides[agentId] = override
  }
  setSetting(AGENT_MODEL_OVERRIDES_KEY, JSON.stringify(overrides))
}

export interface AgentClientResolution {
  client: LLMClientWithModel
  usedOverride: boolean
  override?: AgentModelOverride
  warning?: string
}

/**
 * Resolve an LLM client for a specific model override definition.
 */
export function resolveLLMClientForOverride(
  override: AgentModelOverride,
  fallbackClient: LLMClientWithModel,
  providerManager: ProviderManager,
  pinnedEffort?: string,
  targetLabel: string = 'Model override',
): AgentClientResolution {
  const effectiveEffort = pinnedEffort ?? override.reasoningEffort
  const client = providerManager.createClient(override.providerId, override.model, effectiveEffort)
  if (!client) {
    return {
      client: fallbackClient,
      usedOverride: false,
      override,
      warning: `${targetLabel} is configured to use model '${override.model}' from provider '${override.providerId}', but it is no longer available. Falling back to the session model.`,
    }
  }

  return {
    client,
    usedOverride: true,
    override: effectiveEffort ? { ...override, reasoningEffort: effectiveEffort } : override,
  }
}

/**
 * Resolve the LLM client for an agent. When the agent has an override and the
 * provider/model still exists, returns a dedicated client. Otherwise returns
 * the fallback (session/global) client, with a warning when an override was
 * configured but could not be resolved.
 *
 * A session-pinned effort ("Keep current reasoning effort") is the most recent
 * explicit intent and wins over the override's own reasoningEffort — without
 * replacing the override's provider/model. The returned `override` reflects
 * the effective effort so callers (stats identity) report what is actually sent.
 */
export function resolveLLMClientForAgent(
  agentId: string,
  fallbackClient: LLMClientWithModel,
  providerManager: ProviderManager,
  pinnedEffort?: string,
): AgentClientResolution {
  const override = getAgentModelOverride(agentId)
  if (!override) {
    return { client: fallbackClient, usedOverride: false }
  }

  return resolveLLMClientForOverride(override, fallbackClient, providerManager, pinnedEffort, `Agent '${agentId}'`)
}
