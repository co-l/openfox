/**
 * Agent Model Overrides
 *
 * Per-user overrides mapping an agent id to a specific provider + model.
 * Stored in DB settings as JSON under `agent.modelOverrides`.
 * Absence of an override = agent uses the session/global model.
 */

import { getSetting, setSetting, SETTINGS_KEYS } from '../db/settings.js'
import { getTeam, getWorkflowTeam } from './teams.js'
import { parseJsonObject } from './settings-json.js'
import { overrideSchema, type AgentModelOverride } from './override-schema.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { ProviderManager } from '../provider-manager.js'

export { overrideSchema }
export type { AgentModelOverride }

export const AGENT_MODEL_OVERRIDES_KEY = SETTINGS_KEYS.AGENT_MODEL_OVERRIDES
export const STEP_MODEL_OVERRIDES_KEY = SETTINGS_KEYS.STEP_MODEL_OVERRIDES

export type AgentModelOverrides = Record<string, AgentModelOverride>
export type StepModelOverrides = Record<string, AgentModelOverride>

/** Compose the storage key for a per-step override: `${workflowId}:${stepId}`. */
export function stepOverrideKey(workflowId: string, stepId: string): string {
  return `${workflowId}:${stepId}`
}

export function parseAgentModelOverrides(raw: string | null | undefined): AgentModelOverrides {
  return parseOverridesMap(raw)
}

export function parseStepModelOverrides(raw: string | null | undefined): StepModelOverrides {
  return parseOverridesMap(raw)
}

/** Shared parser for an override map keyed by an arbitrary string id. */
function parseOverridesMap(raw: string | null | undefined): Record<string, AgentModelOverride> {
  const parsed = parseJsonObject(raw)
  if (!parsed) return {}

  const result: Record<string, AgentModelOverride> = {}
  for (const [id, value] of Object.entries(parsed)) {
    const validated = overrideSchema.safeParse(value)
    if (validated.success) {
      result[id] = validated.data
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

export function getStepModelOverrides(): StepModelOverrides {
  return parseStepModelOverrides(getSetting(STEP_MODEL_OVERRIDES_KEY))
}

export function getStepModelOverride(workflowId: string, stepId: string): AgentModelOverride | undefined {
  return getStepModelOverrides()[stepOverrideKey(workflowId, stepId)]
}

export function setStepModelOverride(workflowId: string, stepId: string, override: AgentModelOverride | null): void {
  const overrides = getStepModelOverrides()
  const key = stepOverrideKey(workflowId, stepId)
  if (override === null) {
    delete overrides[key]
  } else {
    overrides[key] = override
  }
  setSetting(STEP_MODEL_OVERRIDES_KEY, JSON.stringify(overrides))
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
 * Resolve the LLM client for a single workflow step. Precedence:
 *   1. step override (`workflowId:stepId`) — wins over everything when present.
 *      A configured-but-unresolvable step override is a hard error for that
 *      step: it falls back to the session model with a warning and does NOT
 *      silently pick up the team/agent override.
 *   2. team assignment — when the workflow is bound to a team that has an
 *      assignment for this step. A broken team assignment is likewise a hard
 *      error for that step (no fallthrough to the agent override).
 *   3. agent override (`agentId`) — delegated to `resolveLLMClientForAgent`.
 *   4. session/global fallback.
 */
export function resolveLLMClientForStep(
  workflowId: string,
  stepId: string,
  agentId: string,
  fallbackClient: LLMClientWithModel,
  providerManager: ProviderManager,
  pinnedEffort?: string,
): AgentClientResolution {
  const stepOverride = getStepModelOverride(workflowId, stepId)
  if (stepOverride) {
    const effectiveEffort = pinnedEffort ?? stepOverride.reasoningEffort
    const client = providerManager.createClient(stepOverride.providerId, stepOverride.model, effectiveEffort)
    if (!client) {
      return {
        client: fallbackClient,
        usedOverride: false,
        override: stepOverride,
        warning: `Step '${stepOverrideKey(workflowId, stepId)}' is configured to use model '${stepOverride.model}' from provider '${stepOverride.providerId}', but it is no longer available. Falling back to the session model.`,
      }
    }
    return {
      client,
      usedOverride: true,
      override: effectiveEffort ? { ...stepOverride, reasoningEffort: effectiveEffort } : stepOverride,
    }
  }

  // Team assignment: workflow bound to a team that carries this step.
  const teamId = getWorkflowTeam(workflowId)
  const team = teamId ? getTeam(teamId) : undefined
  const teamAssignment = team?.assignments[stepId]
  if (teamAssignment) {
    const effectiveEffort = pinnedEffort ?? teamAssignment.reasoningEffort
    const client = providerManager.createClient(teamAssignment.providerId, teamAssignment.model, effectiveEffort)
    if (!client) {
      return {
        client: fallbackClient,
        usedOverride: false,
        override: teamAssignment,
        warning: `Step '${stepOverrideKey(workflowId, stepId)}' (team '${teamId}') is configured to use model '${teamAssignment.model}' from provider '${teamAssignment.providerId}', but it is no longer available. Falling back to the session model.`,
      }
    }
    return {
      client,
      usedOverride: true,
      override: effectiveEffort ? { ...teamAssignment, reasoningEffort: effectiveEffort } : teamAssignment,
    }
  }

  return resolveLLMClientForAgent(agentId, fallbackClient, providerManager, pinnedEffort)
}
