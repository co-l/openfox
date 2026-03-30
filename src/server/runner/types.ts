/**
 * Runner State Machine Types
 * 
 * The runner orchestrates the build → verify → done/blocked cycle.
 * State is derived from session criteria, not persisted separately.
 */

import type { Attachment, Criterion, MessageStats, StatsIdentity } from '../../shared/types.js'
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

// ============================================================================
// Orchestrator Types
// ============================================================================

export interface OrchestratorOptions {
  sessionManager: SessionManager
  sessionId: string
  llmClient: LLMClientWithModel
  statsIdentity?: StatsIdentity
  signal?: AbortSignal
  injectBuilderKickoff?: boolean
  /** Override the globally active workflow for this session */
  workflowId?: string
  /** User-provided message to inject after workflow-started marker */
  userMessage?: { content: string; attachments?: Attachment[] }
  /** For path confirmation dialogs (sent directly, not through EventStore) */
  onMessage?: (msg: ServerMessage) => void
}

export interface OrchestratorResult {
  finalAction: NextAction
  iterations: number
  totalTime: number
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
  toolTime: number  // Total tool execution time in milliseconds
}

// ============================================================================
// Configuration
// ============================================================================

export const RUNNER_CONFIG = {
  maxVerifyRetries: 10,      // Max times to retry a failing criterion
} as const
