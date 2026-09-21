/**
 * Workflow Configuration Types
 *
 * A workflow defines the orchestrator's step sequence as a state machine.
 * Steps have explicit transitions with conditions — the executor walks
 * the graph until it reaches a terminal state ($done or $blocked).
 */

// ============================================================================
// Workflow Definition
// ============================================================================

import type { WorkflowParameter } from '../../shared/types.js'

export type { WorkflowParameter }

export interface WorkflowMetadata {
  id: string
  name: string
  description: string
  version: string
  color?: string
  parameters?: WorkflowParameter[]
}

export interface WorkflowSettings {
  /** Safety limit on total state-machine iterations (default 50) */
  maxIterations: number
}

export interface WorkflowDefinition {
  metadata: WorkflowMetadata
  /** ID of the first step to execute */
  entryStep: string
  settings: WorkflowSettings
  /** Ordered for display; execution follows transitions, not array order */
  steps: WorkflowStep[]
  /** Condition that must be met before the workflow starts (default: always) */
  startCondition?: TransitionCondition
}

// ============================================================================
// Steps
// ============================================================================

/** Pause and wait for the user to click "Continue workflow" */
export interface UserStep extends StepBase {
  type: 'user'
}

export type WorkflowStep = AgentStep | SubAgentStep | ShellStep | UserStep | ParallelStep

interface StepBase {
  /** Unique within this workflow */
  id: string
  /** Display name */
  name: string
  /** Maps to SessionPhase for UI display ("build", "verification", etc.) */
  phase: string
  /** Evaluated in order; first match wins */
  transitions: Transition[]
  /** Optional sub-group label for running a subset of workflow steps */
  subGroup?: string
}

/** Full LLM call + tool execution loop */
export interface AgentStep extends StepBase {
  type: 'agent'
  /** Agent definition ID (defaults to 'planner' at runtime) */
  agentId?: string
  /** Injected as user message on first entry. Supports template variables. */
  prompt?: string
  /**
   * Injected when re-entering an agent step without calling step_done.
   * Supports template variables. Skipped when the step's transition condition
   * is already satisfied — in that case only the step_done reminder is shown.
   */
  nudgePrompt?: string
}

/** Isolated LLM sub-agent with fresh context */
export interface SubAgentStep extends StepBase {
  type: 'sub_agent'
  /** e.g. "verifier" or a custom sub-agent type */
  subAgentType: string
  /** Injected as user message on first entry. Supports template variables. */
  prompt?: string
  /** Injected when nudging the sub-agent. Supports template variables. */
  nudgePrompt?: string
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
// Parallel step
// ============================================================================

/** A sub_agent child of a parallel step */
export interface SubAgentChildStep {
  /** Unique within the parent; doubles as the stepOutput key prefix and UI label */
  id: string
  type: 'sub_agent'
  /** e.g. "verifier" or a custom sub-agent type */
  subAgentType: string
  /** Injected as the child's task. Supports template variables (pre-run context). */
  prompt?: string
}

/** A shell child of a parallel step */
export interface ShellChildStep {
  /** Unique within the parent; doubles as the stepOutput key prefix and UI label */
  id: string
  type: 'shell'
  /** Shell command to run. Supports template variables (pre-run context). */
  command: string
  /** Timeout in milliseconds (default 60000) */
  timeout?: number
  /** Which exit codes count as success (default [0]) */
  successExitCodes?: number[]
}

export type ParallelChildStep = SubAgentChildStep | ShellChildStep

/**
 * Run multiple children concurrently, then aggregate their results into a
 * single step outcome. Children: `sub_agent` and `shell` only (no `agent`,
 * no `user`, no nested `parallel`).
 */
export interface ParallelStep extends StepBase {
  type: 'parallel'
  /** Children to run concurrently */
  children: ParallelChildStep[]
  /** Max children running at once (default: all children) */
  maxConcurrency?: number
}

// ============================================================================
// Transitions
// ============================================================================

export interface Transition {
  when: TransitionCondition
  /** Step ID, or "$done" / "$blocked" for terminal states */
  goto: string
  /**
   * Sub-group slice escape tag. When running a slice of this sub-group (or one that
   * entered it via escape), a transition tagged with it may leave the active slice
   * and pull its `goto` step into the run. Ignored on full runs and for other slices.
   */
  subGroup?: string
}

export type TransitionCondition =
  | { type: 'step_result'; result: string }
  | { type: 'metadata_all_match'; key: string; field: string; value: string }
  | { type: 'metadata_all_in'; key: string; field: string; values: string[] }
  | { type: 'custom'; handler: string; config?: unknown }
  | { type: 'always' }

// ============================================================================
// Terminal state constants
// ============================================================================

export const TERMINAL_DONE = '$done'
export const TERMINAL_BLOCKED = '$blocked'
