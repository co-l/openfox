// ============================================================================
// Project Types
// ============================================================================

export interface Project {
  id: string
  name: string
  workdir: string
  createdAt: string
  updatedAt: string
}

// ============================================================================
// Session Types
// ============================================================================

export type SessionMode = 'planner' | 'builder' | 'verifier'

export interface Session {
  id: string
  projectId: string
  workdir: string
  mode: SessionMode
  isRunning: boolean  // Is the agent actively working?
  summary: string | null  // Generated when switching to builder, used by verifier
  createdAt: string
  updatedAt: string
  messages: Message[]
  criteria: Criterion[]
  executionState: ExecutionState | null
  metadata: SessionMetadata
}

export interface SessionMetadata {
  title?: string
  totalTokensUsed: number
  totalToolCalls: number
  iterationCount: number
}

export interface SessionSummary {
  id: string
  projectId: string
  title?: string
  workdir: string
  mode: SessionMode
  isRunning: boolean
  createdAt: string
  updatedAt: string
  criteriaCount: number
  criteriaCompleted: number
}

// ============================================================================
// Message Types
// ============================================================================

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

// Segment types for preserving streaming order
export type MessageSegment =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_call'; toolCallId: string }

export interface MessageStats {
  model: string
  mode: SessionMode
  totalTime: number         // wall clock time (seconds)
  toolTime: number          // time spent in tool execution (seconds)
  prefillTokens: number     // total prompt tokens across all LLM calls
  prefillSpeed: number      // aggregate tokens/second
  generationTokens: number  // total completion tokens
  generationSpeed: number   // aggregate tokens/second
}

export interface Message {
  id: string
  role: MessageRole
  content: string
  toolCalls?: ToolCall[]
  thinkingContent?: string
  toolCallId?: string
  toolName?: string
  toolResult?: ToolResult
  timestamp: string
  tokenCount: number
  isCompacted?: boolean
  originalMessageIds?: string[]
  segments?: MessageSegment[]  // Preserves streaming order: text/thinking chunks + tool call refs
  stats?: MessageStats         // LLM performance stats for this response
  partial?: boolean            // true if message was interrupted mid-stream
  isSystemGenerated?: boolean  // true for auto-injected messages (retry prompts, etc.)
  isStreaming?: boolean        // true while assistant is still generating
  messageKind?: 'correction' | 'auto-prompt' | 'context-reset'  // Visual styling hint for system-generated messages
}

// ============================================================================
// Tool Types
// ============================================================================

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  success: boolean
  output?: string
  error?: string
  durationMs: number
  truncated: boolean
}

export type ToolName = 
  | 'read_file'
  | 'write_file'
  | 'edit_file'
  | 'run_command'
  | 'glob'
  | 'grep'
  | 'ask_user'
  // Criteria tools
  | 'add_criterion'
  | 'update_criterion'
  | 'remove_criterion'
  | 'get_criteria'
  | 'complete_criterion'  // Builder marks criterion done
  | 'pass_criterion'      // Verifier confirms criterion
  | 'fail_criterion'      // Verifier rejects criterion
  // Task tracking
  | 'todo_write'

// ============================================================================
// Criterion Types
// ============================================================================

export interface Criterion {
  id: string
  description: string  // Self-contained contract, includes how to verify
  status: CriterionStatus
  attempts: CriterionAttempt[]
}

export type CriterionStatus =
  | { type: 'pending' }
  | { type: 'in_progress' }
  | { type: 'completed'; completedAt: string; reason?: string }  // Builder marked done, awaiting verification
  | { type: 'passed'; verifiedAt: string; reason?: string }       // Verifier confirmed
  | { type: 'failed'; reason: string; failedAt: string }          // Verifier rejected

export interface CriterionAttempt {
  attemptNumber: number
  status: 'passed' | 'failed'
  timestamp: string
  details?: string
}

// ============================================================================
// Todo Types (for builder task tracking)
// ============================================================================

export interface Todo {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  priority: 'high' | 'medium' | 'low'
}

// ============================================================================
// Execution State
// ============================================================================

export interface ExecutionState {
  iteration: number
  modifiedFiles: string[]
  consecutiveFailures: number
  lastFailedTool?: string
  lastFailureReason?: string
  currentTokenCount: number
  compactionCount: number
  startedAt: string
  lastActivityAt: string
}

// ============================================================================
// Validation Types
// ============================================================================

export interface ValidationResult {
  allPassed: boolean
  results: CriterionValidation[]
}

export interface CriterionValidation {
  criterionId: string
  status: 'pass' | 'fail'
  reasoning: string
  issues: string[]
}

// ============================================================================
// LSP Types
// ============================================================================

export interface Diagnostic {
  path: string
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  severity: 'error' | 'warning' | 'info' | 'hint'
  message: string
  source: string
  code?: string | number
}

// ============================================================================
// Config Types
// ============================================================================

export interface Config {
  vllm: {
    baseUrl: string
    model: string
    timeout: number
  }
  context: {
    maxTokens: number
    compactionThreshold: number
    compactionTarget: number
  }
  agent: {
    maxIterations: number
    maxConsecutiveFailures: number
    toolTimeout: number
  }
  server: {
    port: number
    host: string
  }
  database: {
    path: string
  }
}
