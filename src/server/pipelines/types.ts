/**
 * Pipeline Configuration Types
 *
 * A pipeline defines the orchestrator's step sequence as a state machine.
 * Steps have explicit transitions with conditions — the executor walks
 * the graph until it reaches a terminal state ($done or $blocked).
 */

// ============================================================================
// Pipeline Definition
// ============================================================================

export interface PipelineMetadata {
  id: string
  name: string
  description: string
  version: string
}

export interface PipelineSettings {
  /** Safety limit on total state-machine iterations (default 50) */
  maxIterations: number
  /** Per-criterion retry cap before marking blocked (default 4) */
  maxVerifyRetries: number
}

export interface PipelineDefinition {
  metadata: PipelineMetadata
  /** ID of the first step to execute */
  entryStep: string
  settings: PipelineSettings
  /** Ordered for display; execution follows transitions, not array order */
  steps: PipelineStep[]
}

// ============================================================================
// Steps
// ============================================================================

export type PipelineStep = LLMTurnStep | SubAgentStep | ShellStep

interface StepBase {
  /** Unique within this pipeline */
  id: string
  /** Display name */
  name: string
  /** Maps to SessionPhase for UI display ("build", "verification", etc.) */
  phase: string
  /** Evaluated in order; first match wins */
  transitions: Transition[]
}

/** Full LLM call + tool execution loop (like the current builder turn) */
export interface LLMTurnStep extends StepBase {
  type: 'llm_turn'
  /** Which tool registry to use */
  toolMode: 'builder' | 'planner'
  /** Injected as user message on first entry */
  kickoffPrompt?: string
  /** Injected when re-entering after a failed verify */
  nudgePrompt?: string
}

/** Isolated LLM sub-agent with fresh context */
export interface SubAgentStep extends StepBase {
  type: 'sub_agent'
  /** e.g. "verifier" or a custom sub-agent type */
  subAgentType: string
  /** Override the default kickoff prompt */
  prompt?: string
  /** Tool set override */
  toolMode?: 'verifier' | 'builder'
}

/** Run a shell command, branch on exit code */
export interface ShellStep extends StepBase {
  type: 'shell'
  /** Shell command to run. Supports template variables: {{workdir}}, etc. */
  command: string
  /** Timeout in milliseconds (default 60000) */
  timeout?: number
  /** Which exit codes count as success (default [0]) */
  successExitCodes?: number[]
}

// ============================================================================
// Transitions
// ============================================================================

export interface Transition {
  when: TransitionCondition
  /** Step ID, or "$done" / "$blocked" for terminal states */
  goto: string
}

export type TransitionCondition =
  | { type: 'all_criteria_passed' }
  | { type: 'all_criteria_completed_or_passed' }
  | { type: 'any_criteria_blocked' }
  | { type: 'has_pending_criteria' }
  | { type: 'step_result'; result: 'success' | 'failure' }
  | { type: 'always' }

// ============================================================================
// Terminal state constants
// ============================================================================

export const TERMINAL_DONE = '$done'
export const TERMINAL_BLOCKED = '$blocked'
