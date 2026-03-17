// ============================================================================
// Project Types
// ============================================================================

export interface Project {
  id: string
  name: string
  workdir: string
  customInstructions?: string  // Project-specific instructions injected into prompts
  createdAt: string
  updatedAt: string
}

// ============================================================================
// Session Types
// ============================================================================

export type SessionMode = 'planner' | 'builder'

// Tool mode includes 'verifier' for the verification sub-agent (which uses distinct tools but runs inline within builder)
export type ToolMode = SessionMode | 'verifier'

// Workflow phase shown to user (more granular than mode)
export type SessionPhase = 'plan' | 'build' | 'verification' | 'blocked' | 'done'

export interface Session {
  id: string
  projectId: string
  workdir: string
  mode: SessionMode
  phase: SessionPhase  // Current workflow phase
  isRunning: boolean  // Is the agent actively working?
  summary: string | null  // Generated when switching to builder, used by verifier
  createdAt: string
  updatedAt: string
  messages: Message[]
  criteria: Criterion[]
  contextWindows: ContextWindow[]  // Context windows for this session
  executionState: ExecutionState | null
  metadata: SessionMetadata
}

// ============================================================================
// Context Window Types
// ============================================================================

export interface ContextWindow {
  id: string
  sessionId: string
  sequenceNumber: number          // 1, 2, 3... for ordering
  createdAt: string
  summaryOfPrevious?: string      // LLM-generated summary of previous window (null for first)
  summaryTokenCount?: number      // Token count of the summary
  closedAt?: string               // When this window was compacted (null if current)
  tokenCountAtClose?: number      // Final token count when closed
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
  phase: SessionPhase  // Current workflow phase
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
  mode: ToolMode  // Which system prompt was used (planner, builder, verifier)
  totalTime: number         // wall clock time (seconds)
  toolTime: number          // time spent in tool execution (seconds)
  prefillTokens: number     // total prompt tokens across all LLM calls
  prefillSpeed: number      // aggregate tokens/second
  generationTokens: number  // total completion tokens
  generationSpeed: number   // aggregate tokens/second
}

// Single data point for session stats progression charts
export interface StatsDataPoint {
  messageId: string
  timestamp: string
  mode: ToolMode
  contextTokens: number      // prefillTokens (≈ context size at this point)
  prefillSpeed: number       // tok/s
  generationSpeed: number    // tok/s
  totalTime: number          // seconds
  aiTime: number             // totalTime - toolTime (LLM inference only)
}

// Aggregated session-level stats for benchmarking
export interface SessionStats {
  // Aggregates
  totalTime: number          // Sum of all LLM call times (seconds)
  aiTime: number             // totalTime - toolTime (seconds)
  toolTime: number           // Total tool execution time (seconds)
  prefillTokens: number      // Total prompt tokens
  generationTokens: number   // Total completion tokens
  avgPrefillSpeed: number    // Weighted average tok/s
  avgGenerationSpeed: number // Weighted average tok/s
  messageCount: number       // Number of assistant messages with stats
  // Progression data for charts
  dataPoints: StatsDataPoint[]
}

// Metadata about what was sent to the LLM for this response
export interface PromptContext {
  systemPrompt: string           // Full system prompt sent to LLM
  injectedFiles: InjectedFile[]  // AGENTS.md, global/project instructions, etc.
  userMessage: string            // The user message that triggered this response
}

export interface InjectedFile {
  path: string                   // File path or identifier
  content: string                // File content
  source: 'agents-md' | 'global' | 'project'  // Where the file came from
}

// Preparing tool call (temporary, replaced by full ToolCall when complete)
export interface PreparingToolCall {
  index: number   // Tool call index (for matching when complete)
  name: string    // Tool name (available early in stream)
}

export interface Message {
  id: string
  role: MessageRole
  content: string
  contextWindowId?: string       // Which context window this message belongs to (auto-assigned if omitted)
  toolCalls?: ToolCall[]
  preparingToolCalls?: PreparingToolCall[]  // Tool calls being streamed (transient, frontend only)
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
  isCompactionSummary?: boolean  // true if this is the summary message after compaction
  subAgentId?: string          // If set, this message belongs to a sub-agent process
  subAgentType?: 'verifier'    // Type of sub-agent (extensible for future)
  promptContext?: PromptContext  // What was sent to LLM for this response (assistant messages only)
}

// ============================================================================
// Tool Types
// ============================================================================

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  result?: ToolResult  // Attached after execution (during streaming or enriched on load)
  startedAt?: number   // Timestamp when tool started (for timeout display, transient)
  streamingOutput?: Array<{ stream: 'stdout' | 'stderr'; content: string }>  // Real-time output (transient, run_command only)
}

/** A single line of context around an edit */
export interface EditContextLine {
  lineNumber: number  // 1-indexed
  content: string
}

/** A single edit within a region (for replace_all with multiple matches) */
export interface EditContextEdit {
  startLine: number   // 1-indexed line where old content starts
  endLine: number     // 1-indexed line where old content ends (inclusive)
  oldContent: string
  newContent: string
}

/** 
 * A region of the file showing context around one or more edits.
 * Multiple edits are merged when their contexts overlap.
 */
export interface EditContextRegion {
  beforeContext: EditContextLine[]
  afterContext: EditContextLine[]
  startLine: number   // First edit's start line
  endLine: number     // Last edit's end line
  oldContent: string  // First edit's old content (for single edit compat)
  newContent: string  // First edit's new content (for single edit compat)
  edits: EditContextEdit[]  // All edits in this region
}

export interface ToolResult {
  success: boolean
  output?: string
  error?: string
  durationMs: number
  truncated: boolean
  diagnostics?: Diagnostic[]  // LSP diagnostics for file operations
  editContext?: {
    regions: EditContextRegion[]
  }
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
}

// ============================================================================
// Execution State
// ============================================================================

// File read tracking entry - stores hash at time of read
export interface FileReadEntry {
  hash: string      // SHA-256 hash of file content when read
  readAt: string    // ISO timestamp of when file was read
}

export interface ExecutionState {
  iteration: number
  modifiedFiles: string[]
  readFiles: Record<string, FileReadEntry>  // path → hash/timestamp for read-before-write validation
  consecutiveFailures: number
  lastFailedTool?: string
  lastFailureReason?: string
  currentTokenCount: number         // Real token count from last LLM call
  messageCountAtLastUpdate: number  // Message count when currentTokenCount was set
  compactionCount: number
  startedAt: string
  lastActivityAt: string
}

// ============================================================================
// Context State (for UI display)
// ============================================================================

export interface ContextState {
  currentTokens: number    // Current context window usage
  maxTokens: number        // Maximum context window size
  compactionCount: number  // Number of times context has been compacted
  dangerZone: boolean      // True if approaching max (< 20K remaining)
  canCompact: boolean      // True if there's enough context to compact
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

/** Supported LLM inference backends */
export type LlmBackend = 'vllm' | 'sglang' | 'ollama' | 'llamacpp' | 'unknown'

export interface Config {
  llm: {
    baseUrl: string
    model: string
    timeout: number
    /** Backend type - 'auto' for auto-detection, or explicit backend name */
    backend: LlmBackend | 'auto'
    /** Disable thinking/reasoning globally (for e2e tests) */
    disableThinking?: boolean
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
