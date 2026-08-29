/**
 * Reasoning-effort change gating.
 *
 * Switching the reasoning effort mid-session invalidates the LLM server's prefix
 * cache (the server templates `reasoning_effort` into the system prompt). To keep
 * the cache sacred, effort-changing transitions are gated behind an explicit
 * choice when a warm cache exists.
 */

import { isReasoningEffortValue, REASONING_EFFORT_VALUES } from './model-value'
import { resolveEffortForModel } from '@shared/reasoning-effort.js'

export interface EffortGateSession {
  providerReasoningEffort?: string | null
  providerPinnedEffort?: string | null
  providerManual?: boolean
  providerManualActive?: boolean
}

export interface ResolveEffectiveEffortOptions {
  session?: EffortGateSession | null
  /** Effort from the current agent's model override. */
  agentOverrideEffort?: string | undefined
  /** Model's configured default effort (thinkingLevel or reasoningEffortOverride). */
  modelDefaultEffort?: string | undefined
}

/**
 * The reasoning effort that would currently be SENT for the session, mirroring
 * the server's resolution: pin > manual pick > agent override > session-stored
 * effort > model default.
 *
 * An active pin ("Keep current reasoning effort") is the most recent explicit
 * choice and wins even over an active manual pick. Otherwise an ACTIVE manual
 * pick is authoritative: the server returns only its stored effort (empty →
 * the model's default effort applies), never an agent override.
 *
 * The result is always a STORABLE effort: only shared-vocabulary values can be
 * pinned or written to the session, so a custom model default (free-text
 * `thinkingLevel` or a non-vocabulary override) resolves to undefined — there
 * is nothing for "Keep" to preserve, and the gates treat it as "no current
 * effort" (no modal, no pin).
 */
export function resolveEffectiveEffort({
  session,
  agentOverrideEffort,
  modelDefaultEffort,
}: ResolveEffectiveEffortOptions): string | undefined {
  const isManual = !!session?.providerManual && !!session?.providerManualActive
  const resolved = isManual
    ? (session?.providerPinnedEffort ?? session?.providerReasoningEffort ?? modelDefaultEffort)
    : (session?.providerPinnedEffort ?? agentOverrideEffort ?? session?.providerReasoningEffort ?? modelDefaultEffort)
  return resolved && isReasoningEffortValue(resolved) ? resolved : undefined
}

/**
 * Whether switching to `proposedEffort` should be gated: only when there is a
 * warm prefix cache AND a concrete STORABLE current effort to preserve AND the
 * proposed effort genuinely differs from it. Fresh sessions, no-op picks, and
 * cases with no current effort (nothing for "Keep" to pin) apply immediately.
 * A non-vocabulary current effort (custom thinkingLevel / override) is not
 * storable, so it never gates — there is nothing "Keep" could pin.
 */
export function shouldGateEffortChange(opts: {
  warmCache?: boolean
  currentEffort?: string
  proposedEffort?: string
}): boolean {
  const { warmCache, currentEffort, proposedEffort } = opts
  const storableCurrent =
    currentEffort && (REASONING_EFFORT_VALUES as readonly string[]).includes(currentEffort) ? currentEffort : undefined
  return !!warmCache && !!proposedEffort && !!storableCurrent && proposedEffort !== storableCurrent
}

export interface ResolveDisplayEffortOptions {
  /** Explicit effort (session pick, pin, or agent override). */
  explicitEffort?: string
  /** The model's advertised preset list (UI chips). */
  reasoningEfforts?: string[]
  /** The model's configured thinkingLevel default. */
  thinkingLevel?: string
  thinkingEnabled?: boolean
  /** The model's raw reasoning-effort override (sent verbatim). */
  override?: string
}

/**
 * The reasoning effort the server will actually SEND for the model: the
 * explicit effort clamped to the preset list, else the override verbatim,
 * else the thinkingLevel default if advertised, else nothing. Mirrors the
 * server's resolveEffortForModel so labels and chip highlights never show a
 * value that gets silently clamped or dropped at request time.
 */
export function resolveDisplayEffort({
  explicitEffort,
  reasoningEfforts,
  thinkingLevel,
  thinkingEnabled,
  override,
}: ResolveDisplayEffortOptions): string | undefined {
  return resolveEffortForModel({
    ...(reasoningEfforts?.length ? { reasoningEfforts } : {}),
    ...(explicitEffort ? { candidate: explicitEffort } : {}),
    ...(thinkingEnabled && thinkingLevel ? { defaultEffort: thinkingLevel } : {}),
    ...(override ? { override } : {}),
  })
}

export interface WorkflowStepLike {
  id: string
  type: string
  agentId?: string
  subAgentType?: string
  subGroup?: string
}

/**
 * The agent a workflow launch will run first — the first step that will
 * actually issue an LLM query. Mirrors the server executor's start-step
 * selection (entry step, or the first step of the launched sub-group slice),
 * then walks the steps in order and returns the first one with an agent
 * identity (agent → agentId, sub_agent → subAgentType), skipping `user` and
 * `shell` steps that pause or run commands without querying the LLM. Returns
 * undefined when the workflow has no agent/sub_agent step at all.
 */
export function resolveWorkflowFirstAgentId(
  workflow: { entryStep: string; steps: WorkflowStepLike[] },
  subGroup?: string,
): string | undefined {
  const slice = subGroup ? workflow.steps.filter((s) => s.subGroup === subGroup) : workflow.steps
  // An empty sub-group slice falls back to the full workflow (the executor
  // starts at the entry step in that case).
  const steps = slice.length > 0 ? slice : workflow.steps
  const startId = subGroup ? (slice[0]?.id ?? workflow.entryStep) : workflow.entryStep
  const startIndex = Math.max(
    0,
    steps.findIndex((s) => s.id === startId),
  )
  for (let i = startIndex; i < steps.length; i++) {
    const step = steps[i]
    if (!step) continue
    if (step.type === 'agent') return step.agentId
    if (step.type === 'sub_agent') return step.subAgentType
  }
  return undefined
}
