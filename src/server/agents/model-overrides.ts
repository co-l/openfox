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
import type { StatsIdentity } from '../../shared/types.js'

export const AGENT_MODEL_OVERRIDES_KEY = SETTINGS_KEYS.AGENT_MODEL_OVERRIDES

const overrideSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().min(1).optional(),
})

export type AgentModelOverride = z.infer<typeof overrideSchema>
export type AgentModelOverrides = Record<string, AgentModelOverride>

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

  const effectiveEffort = pinnedEffort ?? override.reasoningEffort
  const client = providerManager.createClient(override.providerId, override.model, effectiveEffort)
  if (!client) {
    return {
      client: fallbackClient,
      usedOverride: false,
      override,
      warning: `Agent '${agentId}' is configured to use model '${override.model}' from provider '${override.providerId}', but it is no longer available. Falling back to the session model.`,
    }
  }

  return {
    client,
    usedOverride: true,
    override: effectiveEffort ? { ...override, reasoningEffort: effectiveEffort } : override,
  }
}

/**
 * Build the stats identity for a resolved agent override (shared by the
 * sub-agent manager and the workflow executor).
 */
export function buildAgentOverrideStatsIdentity(
  providerManager: ProviderManager,
  client: LLMClientWithModel,
  override: AgentModelOverride,
): StatsIdentity {
  const provider = providerManager.getProviders().find((p) => p.id === override.providerId)
  return {
    providerId: override.providerId,
    providerName: provider?.name ?? override.providerId,
    backend: provider?.backend ?? client.getBackend(),
    model: override.model,
    ...(override.reasoningEffort ? { reasoningEffort: override.reasoningEffort } : {}),
  }
}
