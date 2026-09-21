import { useCallback } from 'react'
import { useSessionScope, useScopedPaneState } from '../stores/session/session-scope'
import { useSessionStore } from '../stores/session'
import { useProviders } from './useProviders'
import { useConfig } from './useConfig'
import { useResource } from './useResource'
import { agentsResource } from '../lib/resources'
import { useEffortChangeGate } from '../components/plan/EffortChangeGate'
import { resolveEffectiveEffort, shouldGateEffortChange } from '../lib/effort-gate'
import { parseModelValue } from '../lib/model-value'

/**
 * Current reasoning-effort context for a session: the effort that would be sent
 * right now (pin-aware), whether the LLM prefix cache is warm, and the gate to
 * request an explicit effort-switch choice.
 *
 * Pass an explicit `sessionId` when the caller is not inside a SessionScopeProvider
 * (e.g. hook consumers at the panel level); otherwise the scoped session is used.
 */
export function useEffortGateContext(explicitSessionId?: string | null | undefined) {
  const scopedSessionId = useSessionScope()
  const sessionId = explicitSessionId ?? scopedSessionId
  const currentSession = useScopedPaneState(
    sessionId,
    (pane) => pane.session ?? null,
    (state) => state.currentSession,
    null,
  )
  const contextState = useScopedPaneState(
    sessionId,
    (pane) => pane.contextState ?? null,
    (state) => state.contextState,
    null,
  )
  const gate = useEffortChangeGate()

  const { providers } = useProviders()
  const defaultModelSelection = useConfig().config?.defaultModelSelection ?? null
  // Agent overrides come from the agents resource cache, scoped to the
  // session's workdir so project-scoped overrides resolve correctly.
  const { data } = useResource(agentsResource, currentSession?.workdir)
  const modelOverrides = data?.modelOverrides ?? {}

  // Current agent's override effort and model (the agent currently active in
  // the session). The override's MODEL is the source of the model-default
  // effort fallback, mirroring the server: an override without an explicit
  // effort still resolves to its own model's thinkingLevel, not the session's.
  const currentAgentId = currentSession?.mode
  const agentOverride = currentAgentId ? (modelOverrides[currentAgentId] ?? undefined) : undefined
  const agentOverrideParsed = agentOverride ? parseModelValue(agentOverride) : undefined
  const agentOverrideEffort = agentOverrideParsed?.reasoningEffort

  const isSessionManual = !!currentSession?.providerManual && !!currentSession?.providerManualActive
  const sessionProviderId = currentSession?.providerId ?? null
  const sessionModel = currentSession?.providerModel ?? null
  const defaultProviderId = defaultModelSelection?.split('/')[0] ?? null
  const defaultModel = defaultModelSelection?.split('/').slice(1).join('/') ?? null
  // Same precedence as the server and the selector label: manual pick wins
  // while active, otherwise agent override > session preference > default.
  const effectiveProviderId = isSessionManual
    ? sessionProviderId
    : (agentOverrideParsed?.providerId ?? sessionProviderId ?? defaultProviderId)
  const effectiveModel = isSessionManual ? sessionModel : (agentOverrideParsed?.model ?? sessionModel ?? defaultModel)
  const effectiveModelConfig = effectiveProviderId
    ? providers.find((p) => p.id === effectiveProviderId)?.models.find((m) => m.id === effectiveModel)
    : undefined
  const modelDefaultEffort =
    effectiveModelConfig?.reasoningEffortOverride ??
    (effectiveModelConfig?.thinkingEnabled ? effectiveModelConfig.thinkingLevel : undefined)

  const currentEffort = resolveEffectiveEffort({
    session: currentSession,
    agentOverrideEffort,
    modelDefaultEffort,
  })

  // The effort that would apply WITHOUT the current agent's override — the
  // session's own pin/session-stored effort, else the session/default model's
  // default. Used as the proposed effort when switching to a non-override
  // agent (which can restore a differing stored effort and must gate too).
  const sessionOwnProviderId = isSessionManual ? sessionProviderId : (sessionProviderId ?? defaultProviderId)
  const sessionOwnModel = isSessionManual ? sessionModel : (sessionModel ?? defaultModel)
  const sessionOwnModelConfig = sessionOwnProviderId
    ? providers.find((p) => p.id === sessionOwnProviderId)?.models.find((m) => m.id === sessionOwnModel)
    : undefined
  const sessionOwnModelDefaultEffort =
    sessionOwnModelConfig?.reasoningEffortOverride ??
    (sessionOwnModelConfig?.thinkingEnabled ? sessionOwnModelConfig.thinkingLevel : undefined)
  const sessionOwnEffort = resolveEffectiveEffort({
    session: currentSession,
    agentOverrideEffort: undefined,
    modelDefaultEffort: sessionOwnModelDefaultEffort,
  })

  return {
    sessionId,
    currentEffort,
    sessionOwnEffort,
    warmCache: contextState?.warmCache,
    gate,
    modelOverrides,
  }
}

/**
 * A gate-aware agent switch shared by every agent-selection entry point (the
 * dropdown and the keyboard shortcuts): switching to an agent whose resulting
 * reasoning effort differs from the current one on a warm cache opens the gate.
 * The resulting effort is the target's override effort, else the session's own
 * effort (switching away from an override agent can restore a differing stored
 * effort — that invalidates the cache too). Apply clears the pin (the new
 * effort takes effect), Keep pins the current effort.
 */
export function useEffortGatedAgentSwitch(
  explicitSessionId?: string | null | undefined,
): (agentId: string, agentName?: string) => Promise<void> {
  const { sessionId, currentEffort, sessionOwnEffort, warmCache, gate, modelOverrides } =
    useEffortGateContext(explicitSessionId)
  const switchMode = useSessionStore((state) => state.switchMode)
  const pinSessionEffort = useSessionStore((state) => state.pinSessionEffort)
  const clearSessionEffortPin = useSessionStore((state) => state.clearSessionEffortPin)

  return useCallback(
    async (agentId: string, agentName?: string) => {
      if (!sessionId) return
      const overrideEffort = parseModelValue(modelOverrides[agentId])?.reasoningEffort
      const proposedEffort = overrideEffort ?? sessionOwnEffort
      if (
        proposedEffort &&
        shouldGateEffortChange({
          warmCache,
          currentEffort,
          proposedEffort,
        })
      ) {
        const choice = await gate.requestEffortSwitch({
          fromEffort: currentEffort,
          toEffort: proposedEffort,
          contextLabel: agentName,
        })
        if (choice === 'keep') {
          if (currentEffort) await pinSessionEffort(sessionId, currentEffort)
        } else {
          await clearSessionEffortPin(sessionId)
        }
      }
      await switchMode(sessionId, agentId)
    },
    [
      sessionId,
      warmCache,
      currentEffort,
      sessionOwnEffort,
      gate,
      switchMode,
      pinSessionEffort,
      clearSessionEffortPin,
      modelOverrides,
    ],
  )
}
