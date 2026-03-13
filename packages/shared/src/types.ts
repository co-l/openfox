// ============================================================================
// Session Types
// ============================================================================

export type SessionPhase = 
  | 'idle' 
  | 'planning' 
  | 'executing' 
  | 'validating' 
  | 'completed'

export interface Session {
  id: string
  workdir: string
  phase: SessionPhase
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
  title?: string
  workdir: string
  phase: SessionPhase
  createdAt: string
  updatedAt: string
  criteriaCount: number
  criteriaCompleted: number
}

// ============================================================================
// Message Types
// ============================================================================

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

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

// ============================================================================
// Criterion Types
// ============================================================================

export interface Criterion {
  id: string
  description: string
  verification: CriterionVerification
  status: CriterionStatus
  attempts: CriterionAttempt[]
}

export type CriterionVerification =
  | { type: 'auto'; command: string }
  | { type: 'model' }
  | { type: 'human' }

export type CriterionStatus =
  | { type: 'pending' }
  | { type: 'in_progress' }
  | { type: 'passed'; verifiedAt: string; verifiedBy: 'auto' | 'model' | 'human' }
  | { type: 'failed'; reason: string; failedAt: string }

export interface CriterionAttempt {
  attemptNumber: number
  status: 'passed' | 'failed'
  timestamp: string
  details?: string
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
// Metrics Types
// ============================================================================

export interface VllmMetrics {
  numRequestsRunning: number
  numRequestsWaiting: number
  timeToFirstTokenSeconds: number
  timePerOutputTokenSeconds: number
  e2eRequestLatencySeconds: number
  promptTokensTotal: number
  generationTokensTotal: number
  gpuCacheUsagePercent: number
  cpuCacheUsagePercent: number
  numPreemptionsTotal: number
}

export interface DerivedMetrics {
  prefillTimeMs: number
  prefillSpeed: number
  generationSpeed: number
  contextUsage: {
    current: number
    max: number
    percent: number
  }
  cacheHealth: 'good' | 'pressure' | 'critical'
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
