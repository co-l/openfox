/**
 * Runner State Machine Types
 *
 * The runner orchestrates the build → verify → done/blocked cycle.
 * State is derived from session criteria, not persisted separately.
 */

import type { Attachment, StatsIdentity, WorkflowLaunchScope } from '../../shared/types.js'
import type { ServerMessage } from '../../shared/protocol.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { StreamTiming } from '../llm/streaming.js'
import type { SessionManager } from '../session/index.js'

// ============================================================================
// Decision Types - What the state machine decides to do next
// ============================================================================

export type NextAction =
  | { type: 'RUN_BUILDER'; reason: string }
  | { type: 'RUN_VERIFIER'; criteriaToVerify: string[] }
  | { type: 'DONE' }
  | { type: 'BLOCKED'; reason: string; blockedCriteria: string[] }
  | { type: 'WAITING'; reason: string; workflowId: string; stepId: string; stepOutput: Record<string, string> }

// ============================================================================
// Orchestrator Types
// ============================================================================

export interface OrchestratorOptions {
  sessionManager: SessionManager
  sessionId: string
  llmClient: LLMClientWithModel
  statsIdentity?: StatsIdentity
  signal?: AbortSignal
  /** Override the globally active workflow for this session */
  workflowId?: string
  /**
   * Which scope to resolve the workflow from: 'builtin' | 'user' | 'project',
   * or 'auto' for server precedence (project > user > builtin). Invalid values
   * are normalized to 'auto'.
   */
  scope: WorkflowLaunchScope
  /** Resume from a specific step (used after a user step pause) */
  resumeFromStep?: string
  /** Initial step output when resuming */
  initialStepOutput?: Record<string, string>
  /** Template parameters passed at launch (e.g. from slash commands) */
  params?: Record<string, string>
  /** Run only steps with this sub-group label */
  subGroup?: string
  /** Branch selected by the user at a paused user step (matches a step_result result) */
  userChoice?: string
  /** User-provided message to inject after workflow-started marker */
  userMessage?: { content: string; attachments?: Attachment[] }
  /** For path confirmation dialogs (sent directly, not through EventStore) */
  onMessage?: (msg: ServerMessage) => void
  /** Re-resolve the session's LLM client per retry attempt so a provider
   *  switch made mid-run takes effect on the next attempt. */
  getSessionLLMClient?: () => LLMClientWithModel
  /** Overrides for the LLM-failure retry backoff policy. */
  llmRetryPolicy?: Partial<LLMRetryPolicy>
}

export interface OrchestratorResult {
  finalAction: NextAction
  iterations: number
  totalTime: number
}

// ============================================================================
// LLM-Failure Retry Policy
// ============================================================================

/**
 * Backoff policy for retrying an LLM call that failed. Applied uniformly to
 * regular chat turns, workflow agent steps, and sub-agent turns: the failing
 * call retries with escalating delays, then settles into a steady cadence,
 * until the retry window elapses (or the attempt backstop is hit).
 */
export interface LLMRetryPolicy {
  /** Delay before attempt N+1: backoffMs[0] = before attempt 2, etc. */
  backoffMs: number[]
  /** Steady-state delay between attempts once the backoff ladder is exhausted. */
  minIntervalMs: number
  /** Total window from the first failure; retrying stops when it elapses. */
  maxDurationMs: number
  /** Hard cap on consecutive failed attempts for this step. */
  maxAttempts: number
}

export const DEFAULT_LLM_RETRY_POLICY: LLMRetryPolicy = {
  backoffMs: [1000, 5000, 30_000],
  minIntervalMs: 60_000,
  maxDurationMs: 30 * 60_000,
  maxAttempts: 40,
}

// ============================================================================
// Worker Types - Results from individual build/verify steps
// ============================================================================

export interface StepResult {
  messageId: string
  hasToolCalls: boolean
  content: string
  timing: StreamTiming
  usage: { promptTokens: number; completionTokens: number }
  toolTime: number // Total tool execution time in milliseconds
}

// ============================================================================
// Configuration
// ============================================================================

export const RUNNER_CONFIG = {
  maxVerifyRetries: 10, // Max times to retry a failing criterion
} as const
