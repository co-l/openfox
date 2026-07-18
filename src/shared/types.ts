// ============================================================================
// Project Types
// ============================================================================

export interface Project {
  id: string
  name: string
  workdir: string
  customInstructions?: string // Project-specific instructions injected into prompts
  dangerLevel?: DangerLevel // Project default danger level for new sessions
  isStarred?: boolean // Whether the project is starred for quick access
  createdAt: string
  updatedAt: string
}

// ============================================================================
// Session Types
// ============================================================================

export type SessionMode = string

// Tool mode includes 'verifier' for the verification sub-agent (which uses distinct tools but runs inline within builder)
export type ToolMode = string

// Workflow phase shown to user (more granular than mode)
export type SessionPhase = 'plan' | 'build' | 'verification' | 'blocked' | 'done'

export type DangerLevel = 'normal' | 'dangerous'

export interface Session {
  id: string
  projectId: string
  workdir: string
  workspace?: string // Optional workspace path
  mode: SessionMode
  phase: SessionPhase // Current workflow phase
  isRunning: boolean // Is the agent actively working?
  providerId?: string | null // Per-session provider override
  providerModel?: string | null // Per-session model override
  createdAt: string
  updatedAt: string
  messages: Message[]
  criteria: Criterion[]
  contextWindows: ContextWindow[] // Context windows for this session
  executionState: ExecutionState | null
  metadata: SessionMetadata
  metadataEntries: Record<string, MetadataEntry[]> // Key-value store for structured session data (criteria, todos, review_findings, etc.)
  dangerLevel?: DangerLevel // Controls path confirmation bypass
  messageCount?: number // Cached message count for efficient sidebar display (optional, populated on load)
}

// ============================================================================
// Context Window Types
// ============================================================================

export interface ContextWindow {
  id: string
  sessionId: string
  sequenceNumber: number // 1, 2, 3... for ordering
  createdAt: string
  summaryOfPrevious?: string // LLM-generated summary of previous window (null for first)
  summaryTokenCount?: number // Token count of the summary
  closedAt?: string // When this window was compacted (null if current)
  tokenCountAtClose?: number // Final token count when closed
}

export interface SessionMetadata {
  title?: string
  totalTokensUsed: number
  totalToolCalls: number
  iterationCount: number
}

export interface RecentUserPrompt {
  id: string
  content: string
  timestamp: string
}

export interface SessionSummary {
  id: string
  projectId: string
  title?: string
  workdir: string
  workspace?: string // Optional workspace path
  mode: SessionMode
  phase: SessionPhase // Current workflow phase
  isRunning: boolean
  providerId?: string | null // Per-session provider override
  providerModel?: string | null // Per-session model override
  createdAt: string
  updatedAt: string
  criteriaCount: number
  criteriaCompleted: number
  messageCount: number
  recentUserPrompts?: RecentUserPrompt[]
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
  providerId: string
  providerName: string
  backend: ProviderBackend
  model: string
  mode: ToolMode // Which system prompt was used (planner, builder, verifier)
  totalTime: number // wall clock time (seconds)
  toolTime: number // time spent in tool execution (seconds)
  prefillTokens: number // total prompt tokens across all LLM calls
  prefTokenIncrement?: number // sum of new (non-cached) tokens across all calls; used for accurate prefillSpeed
  prefillSpeed: number // aggregate tok/s (computed from prefTokenIncrement if available)
  generationTokens: number // total completion tokens
  generationSpeed: number // aggregate tokens/second
  llmCalls?: LLMCallStats[] // optional per-call breakdown for this response
}

export interface LLMCallStats {
  providerId: string
  providerName: string
  backend: ProviderBackend
  model: string
  callIndex: number // 1-based call order within the response
  promptTokens: number // prompt tokens for this specific LLM call (total, including cached)
  completionTokens: number // completion tokens for this specific LLM call
  prefTokenIncrement?: number // new (non-cached) tokens that required actual processing; used for accurate prefillSpeed
  ttft: number // seconds to first token
  completionTime: number // seconds spent generating tokens after TTFT
  prefillSpeed: number // tok/s for prompt processing (computed from prefTokenIncrement if available, else promptTokens)
  generationSpeed: number // tok/s for token generation
  totalTime: number // ttft + completionTime
  timestamp?: string // optional completion timestamp for ordering/display
  // Request parameters used for this call
  temperature?: number
  topP?: number
  topK?: number
  maxTokens?: number
}

// Single data point for session stats progression charts
export interface StatsDataPoint {
  messageId: string
  timestamp: string
  providerId: string
  providerName: string
  backend: ProviderBackend
  model: string
  mode: ToolMode
  responseIndex: number // 1-based assistant response order within the session
  prefillTokens: number // Total prompt tokens spent producing this response
  generationTokens: number // Total completion tokens for this response
  prefillSpeed: number // tok/s
  generationSpeed: number // tok/s
  totalTime: number // seconds
  aiTime: number // totalTime - toolTime (LLM inference only)
  toolTime: number // seconds spent in tools during this response
}

export interface CallStatsDataPoint {
  messageId: string
  timestamp: string
  providerId: string
  providerName: string
  backend: ProviderBackend
  model: string
  mode: ToolMode
  responseIndex: number // 1-based assistant response order within the session
  sessionCallIndex: number // 1-based LLM call order across the whole session
  callIndex: number // 1-based LLM call order within the response
  promptTokens: number
  completionTokens: number
  ttft: number
  completionTime: number
  prefillSpeed: number
  generationSpeed: number
  totalTime: number
  // Request parameters used for this call
  temperature?: number
  topP?: number
  topK?: number
  maxTokens?: number
}

// Aggregated session-level stats for benchmarking
export interface SessionStats {
  // Aggregates
  totalTime: number // Sum of all LLM call times (seconds)
  aiTime: number // totalTime - toolTime (seconds)
  toolTime: number // Total tool execution time (seconds)
  prefillTokens: number // Total prompt tokens
  generationTokens: number // Total completion tokens
  avgPrefillSpeed: number // Weighted average tok/s
  avgGenerationSpeed: number // Weighted average tok/s
  responseCount: number // Number of assistant responses with stats
  llmCallCount: number // Number of persisted internal LLM calls across responses
  // Progression data for charts
  dataPoints: StatsDataPoint[]
  callDataPoints: CallStatsDataPoint[]
  modelGroups: ModelSessionStats[]
}

export interface StatsIdentity {
  providerId: string
  providerName: string
  backend: ProviderBackend
  model: string
}

export interface ModelSessionStats extends StatsIdentity {
  key: string
  label: string
  totalTime: number
  aiTime: number
  toolTime: number
  prefillTokens: number
  generationTokens: number
  avgPrefillSpeed: number
  avgGenerationSpeed: number
  responseCount: number
  llmCallCount: number
  dataPoints: StatsDataPoint[]
  callDataPoints: CallStatsDataPoint[]
}

export interface InjectedFile {
  path: string // File path or identifier
  content: string // File content
  source: 'agents-md' | 'global' | 'project' // Where the file came from
}

// Preparing tool call (temporary, replaced by full ToolCall when complete)
export interface PreparingToolCall {
  index: number // Tool call index (for matching when complete)
  name: string // Tool name (available early in stream)
  arguments?: string // Partial arguments (streaming JSON fragments)
}

export interface Attachment {
  id: string
  filename: string
  /** MIME type of the file (e.g. image/png, application/pdf, text/plain, application/json, etc.) */
  mimeType: string
  size: number
  data: string // Raw UTF-8 text for text-based types; data: URL (base64) for images and PDFs
  description?: string // Vision fallback description (for non-vision models)
}

export interface Message {
  id: string
  role: MessageRole
  content: string
  contextWindowId?: string // Which context window this message belongs to (auto-assigned if omitted)
  toolCalls?: ToolCall[]
  preparingToolCalls?: PreparingToolCall[] // Tool calls being streamed (transient, frontend only)
  thinkingContent?: string
  toolCallId?: string
  toolName?: string
  toolResult?: ToolResult
  timestamp: string
  tokenCount?: number // Deprecated: no longer used for context tracking
  isCompacted?: boolean
  originalMessageIds?: string[]
  segments?: MessageSegment[] // Preserves streaming order: text/thinking chunks + tool call refs
  stats?: MessageStats // LLM performance stats for this response
  partial?: boolean // true if message was interrupted mid-stream
  completeReason?: 'complete' | 'stopped' | 'error' | 'waiting_for_user' | 'truncated' | 'step_done' // How the message ended
  isSystemGenerated?: boolean // true for auto-injected messages (retry prompts, etc.)
  isStreaming?: boolean // true while assistant is still generating
  messageKind?: 'correction' | 'auto-prompt' | 'context-reset' | 'task-completed' | 'workflow-started' | 'command' // Visual styling hint for system-generated messages
  isCompactionSummary?: boolean // true if this is the summary message after compaction
  subAgentId?: string // If set, this message belongs to a sub-agent process
  subAgentType?: string // Sub-agent ID from agent registry
  attachments?: Attachment[] // Optional image attachments
  metadata?: {
    type: string
    name: string
    color: string
    kind?: 'definition' | 'reminder'
    branchName?: string
    workspaceName?: string
  } // For auto-prompt messages
}

// ============================================================================
// Tool Types
// ============================================================================

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  result?: ToolResult // Attached after execution (during streaming or enriched on load)
  startedAt?: number // Timestamp when tool started (for timeout display, transient)
  streamingOutput?: Array<{ stream: 'stdout' | 'stderr'; content: string; timestamp: number }> // Real-time output (transient, run_command only)
  parseError?: string // Error message if JSON parsing failed
  rawArguments?: string // The unparsed arguments string for debugging
}

/** A single line of context around an edit */
export interface EditContextLine {
  lineNumber: number // 1-indexed
  content: string
}

/** A single edit within a region (for replace_all with multiple matches) */
export interface EditContextEdit {
  startLine: number // 1-indexed line where old content starts
  endLine: number // 1-indexed line where old content ends (inclusive)
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
  startLine: number // First edit's start line
  endLine: number // Last edit's end line
  oldContent: string // First edit's old content (for single edit compat)
  newContent: string // First edit's new content (for single edit compat)
  edits: EditContextEdit[] // All edits in this region
}

export interface ToolResult {
  success: boolean
  output?: string
  error?: string
  durationMs: number
  truncated: boolean
  diagnostics?: Diagnostic[] // LSP diagnostics for file operations
  editContext?: {
    regions: EditContextRegion[]
  }
  metadata?: Record<string, unknown> // Tool-specific metadata for frontend display
}

export type ToolName =
  | 'read_file'
  | 'write_file'
  | 'edit_file'
  | 'run_command'
  | 'glob'
  | 'grep'
  | 'ask_user'
  // Session metadata
  | 'session_metadata'
  // Web
  | 'web_fetch'

// ============================================================================
// Criterion Types
// ============================================================================

export interface Criterion {
  id: string
  description: string // Self-contained contract, includes how to verify
  status: CriterionStatus
  attempts: CriterionAttempt[]
}

export type CriterionStatus =
  | { type: 'pending' }
  | { type: 'in_progress' }
  | { type: 'completed'; completedAt: string; reason?: string } // Builder marked done, awaiting verification
  | { type: 'passed'; verifiedAt: string; reason?: string } // Verifier confirmed
  | { type: 'failed'; reason: string; failedAt: string } // Verifier rejected

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
// Metadata Entry Types (for session_metadata tool)
// ============================================================================

export interface MetadataEntry {
  id: string
  description: string
  status: string
  [key: string]: unknown
}

// ============================================================================
// Execution State
// ============================================================================

// File read tracking entry - stores hash at time of read
export interface FileReadEntry {
  hash: string // SHA-256 hash of file content when read
  readAt: string // ISO timestamp of when file was read
}

export interface ExecutionState {
  iteration: number
  readFiles: Record<string, FileReadEntry> // path → hash/timestamp for read-before-write validation
  consecutiveFailures: number
  lastFailedTool?: string
  lastFailureReason?: string
  currentTokenCount: number // Real token count from last LLM call
  messageCountAtLastUpdate: number // Message count when currentTokenCount was set
  compactionCount: number
  startedAt: string
  lastActivityAt: string
  cachedSystemPrompt?: string // Cached system prompt for prefix cache stability
  dynamicContextHash?: string // Hash of dynamic inputs (instructions + skills) when cached
  dynamicContextChanged?: boolean // True if dynamic inputs changed since system prompt was cached
}

// ============================================================================
// Context State (for UI display)
// ============================================================================

export interface ContextState {
  currentTokens: number // Current context window usage
  maxTokens: number // Maximum context window size
  compactionCount: number // Number of times context has been compacted
  dangerZone: boolean // True if approaching max (< 20K remaining)
  canCompact: boolean // True if there's enough context to compact
  dynamicContextChanged: boolean // True if dynamic inputs changed since system prompt was cached
  debugDump?: { cachedPrompt: string; cachedTools: string[]; liveTools: string[] }
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
export type LlmBackend = 'vllm' | 'sglang' | 'ollama' | 'llamacpp' | 'lmstudio' | 'opencode-go' | 'unknown'

/** Extended backend type including cloud providers */
export type ProviderBackend = LlmBackend | 'openai' | 'anthropic'

/** Model configuration with context window */
export interface ModelConfig {
  id: string // Model ID exposed in OpenFox (may be a projected mode such as "gpt-5.6-sol-fast")
  /** Human-readable model name from the provider catalog. */
  name?: string
  /** Actual model ID sent to the provider when `id` is a projected catalog mode. */
  apiModelId?: string
  /** Extra top-level request body fields attached to this catalog model/mode. */
  requestBody?: Record<string, unknown>
  /** Reasoning effort values advertised by the provider catalog. */
  reasoningEfforts?: string[]
  contextWindow: number // Context window size in tokens
  source: 'backend' | 'user' | 'default' // Where the value came from
  selected?: boolean // User explicitly selected this model (for multi-model providers)
  // User-configurable LLM parameters (optional, falls back to profile defaults)
  temperature?: number
  topP?: number
  topK?: number
  maxTokens?: number
  supportsVision?: boolean
  // Per-model thinking configuration
  thinkingEnabled?: boolean
  thinkingLevel?: string
  nonThinkingEnabled?: boolean
  thinkingExtraKwargs?: string // JSON string for thinking mode kwargs
  nonThinkingExtraKwargs?: string // JSON string for non-thinking mode kwargs
  thinkingQueryParams?: string // JSON string of extra top-level request body params for thinking mode
  nonThinkingQueryParams?: string // JSON string of extra top-level request body params for non-thinking mode
  // Profile defaults for transparency
  defaultTemperature?: number
  defaultTopP?: number
  defaultTopK?: number
  defaultMaxTokens?: number
}

/** LLM provider configuration */
export interface Provider {
  id: string // Stable instance ID
  /** Plugin preset used to hydrate omitted provider fields. */
  preset?: string
  name: string // User-defined display name (e.g., "Local vLLM", "Anthropic Claude")
  url: string // API endpoint (e.g., "http://localhost:8000/v1")
  backend: ProviderBackend
  apiKey?: string | undefined // Optional, for cloud providers
  /** Registered auth adapter id. Credentials are stored separately. */
  authAdapter?: string
  /** Registered transport adapter id. Defaults to OpenAI-compatible HTTP. */
  transportAdapter?: string
  /** Opaque reference into the credential store. Never contains a token. */
  credentialRef?: string
  models: ModelConfig[] // Available models with their context windows
  isActive: boolean // Currently selected provider
  createdAt: string // ISO timestamp
  status?: 'connected' | 'disconnected' | 'unknown' // Connection status
  isLocal?: boolean | undefined // User-specified: true = local, false/undefined = API/cloud
  /** Response field name that contains thinking/reasoning content (e.g., "reasoning_content") */
  thinkingField?: string
}

export interface Config {
  llm: {
    baseUrl: string
    model: string
    timeout: number
    idleTimeout: number
    /** Backend type */
    backend: LlmBackend
    /** API key for cloud providers */
    apiKey?: string
    /** Reasoning effort level (none, low, medium, high, etc.) */
    reasoningEffort?: string
    /** Response field name that contains thinking/reasoning content (e.g., "reasoning_content") */
    thinkingField?: string
    /** Vision model for image description fallback when primary model lacks vision support */
    visionModel?: string
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
    /** Auto-loop patterns: when LLM response matches, auto-inject a response */
    autoPatterns?: Array<{ pattern: string; response: string }>
  }
  server: {
    port: number
    host?: string
    openBrowser?: boolean
  }
  database: {
    path: string
  }
  logging?: {
    level: 'debug' | 'info' | 'warn' | 'error'
  }
  mode?: 'development' | 'production' | 'test'
  dev?: boolean // true when running in dev mode (OPENFOX_DEV=true or mode='development')
  /** Configured providers (loaded from global config) */
  providers?: Provider[] | undefined
  /** Default model selection in format "providerId/modelName" */
  defaultModelSelection?: string | undefined
  /** ID of the active provider (deprecated, use defaultModelSelection) */
  activeProviderId?: string | undefined
  /** Workspace directory for projects */
  workdir: string
  /** Active workflow ID (defaults to "default") */
  activeWorkflowId?: string | undefined
  /** Disable automatic session title generation */
  disableAutoSessionTitle?: boolean
  /** Override path for the global config file (used for test isolation) */
  globalConfigPath?: string
  /** MCP server configurations */
  mcpServers?:
    | Record<
        string,
        {
          transport: 'stdio' | 'http'
          command?: string
          args?: string[]
          env?: Record<string, string>
          url?: string
          headers?: Record<string, string>
          disabledTools?: string[]
        }
      >
    | undefined
}

// ============================================================================
// UI Inspect Feedback Types
// ============================================================================

export interface ElementData {
  tag: string
  id: string | null
  className: string | null
  xpath: string
  text: string | null
  outerHTML: string
  rect: { x: number; y: number; width: number; height: number }
  attributes: Record<string, string>
}
