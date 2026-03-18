import type Database from 'better-sqlite3'
import type {
  Session,
  SessionSummary,
  SessionMode,
  SessionPhase,
  Message,
  MessageSegment,
  Criterion,
  ExecutionState,
  FileReadEntry,
  CriterionStatus,
  ToolCall,
  ToolResult,
  CriterionAttempt,
  ContextWindow,
} from '../../shared/types.js'
import { getDatabase } from './index.js'

/**
 * Remove undefined values from an object at runtime.
 * Required for exactOptionalPropertyTypes compatibility.
 * Returns the object cast to the target type.
 */
function stripUndefined<T>(obj: Record<string, unknown>): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as T
}

// ============================================================================
// Session Operations
// ============================================================================

export function createSession(projectId: string, workdir: string, title?: string): Session {
  const db = getDatabase()
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  
  db.prepare(`
    INSERT INTO sessions (id, project_id, workdir, phase, mode, workflow_phase, is_running, created_at, updated_at, title)
    VALUES (?, ?, ?, 'idle', 'planner', 'plan', 0, ?, ?, ?)
  `).run(id, projectId, workdir, now, now, title ?? null)
  
  // Create the first context window for this session
  const contextWindowId = crypto.randomUUID()
  db.prepare(`
    INSERT INTO context_windows (id, session_id, sequence_number, created_at)
    VALUES (?, ?, 1, ?)
  `).run(contextWindowId, id, now)
  
  const firstContextWindow: ContextWindow = {
    id: contextWindowId,
    sessionId: id,
    sequenceNumber: 1,
    createdAt: now,
  }
  
  return {
    id,
    projectId,
    workdir,
    mode: 'planner',
    phase: 'plan',
    isRunning: false,
    summary: null,
    createdAt: now,
    updatedAt: now,
    messages: [],
    criteria: [],
    contextWindows: [firstContextWindow],
    executionState: null,
    metadata: {
      ...(title ? { title } : {}),
      totalTokensUsed: 0,
      totalToolCalls: 0,
      iterationCount: 0,
    },
  }
}

export function getSession(id: string): Session | null {
  const db = getDatabase()
  
  const row = db.prepare(`
    SELECT * FROM sessions WHERE id = ?
  `).get(id) as SessionRow | undefined
  
  if (!row) {
    return null
  }
  
  const messages = getMessages(id)
  const criteria = getCriteria(id)
  const contextWindows = getContextWindows(id)
  const executionState = getExecutionState(id)
  
  return {
    id: row.id,
    projectId: row.project_id,
    workdir: row.workdir,
    mode: (row.mode ?? 'planner') as SessionMode,
    phase: (row.workflow_phase ?? 'plan') as SessionPhase,
    isRunning: Boolean(row.is_running),
    summary: row.summary ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages,
    criteria,
    contextWindows,
    executionState,
    metadata: {
      ...(row.title ? { title: row.title } : {}),
      totalTokensUsed: row.total_tokens_used,
      totalToolCalls: row.total_tool_calls,
      iterationCount: row.iteration_count,
    },
  }
}

export function updateSessionMode(id: string, mode: SessionMode): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  
  db.prepare(`
    UPDATE sessions SET mode = ?, updated_at = ? WHERE id = ?
  `).run(mode, now, id)
}

export function updateSessionPhase(id: string, phase: SessionPhase): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  
  db.prepare(`
    UPDATE sessions SET workflow_phase = ?, updated_at = ? WHERE id = ?
  `).run(phase, now, id)
}

export function updateSessionRunning(id: string, isRunning: boolean): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  
  db.prepare(`
    UPDATE sessions SET is_running = ?, updated_at = ? WHERE id = ?
  `).run(isRunning ? 1 : 0, now, id)
}

export function updateSessionSummary(id: string, summary: string): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  
  db.prepare(`
    UPDATE sessions SET summary = ?, updated_at = ? WHERE id = ?
  `).run(summary, now, id)
}

export function updateSessionMetadata(
  id: string,
  metadata: Partial<Session['metadata']>
): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  
  const updates: string[] = ['updated_at = ?']
  const values: (string | number)[] = [now]
  
  if (metadata.title !== undefined) {
    updates.push('title = ?')
    values.push(metadata.title ?? '')
  }
  if (metadata.totalTokensUsed !== undefined) {
    updates.push('total_tokens_used = ?')
    values.push(metadata.totalTokensUsed)
  }
  if (metadata.totalToolCalls !== undefined) {
    updates.push('total_tool_calls = ?')
    values.push(metadata.totalToolCalls)
  }
  if (metadata.iterationCount !== undefined) {
    updates.push('iteration_count = ?')
    values.push(metadata.iterationCount)
  }
  
  values.push(id)
  
  db.prepare(`
    UPDATE sessions SET ${updates.join(', ')} WHERE id = ?
  `).run(...values)
}

export function listSessions(): SessionSummary[] {
  const db = getDatabase()
  
  const rows = db.prepare(`
    SELECT 
      s.id,
      s.project_id,
      s.workdir,
      s.mode,
      s.workflow_phase,
      s.is_running,
      s.created_at,
      s.updated_at,
      s.title,
      (SELECT COUNT(*) FROM criteria WHERE session_id = s.id) as criteria_count,
      (SELECT COUNT(*) FROM criteria WHERE session_id = s.id AND status LIKE '%"type":"passed"%') as criteria_completed
    FROM sessions s
    ORDER BY s.updated_at DESC
  `).all() as SessionSummaryRow[]
  
  return rows.map(row => ({
    id: row.id,
    projectId: row.project_id,
    ...(row.title ? { title: row.title } : {}),
    workdir: row.workdir,
    mode: (row.mode ?? 'planner') as SessionMode,
    phase: (row.workflow_phase ?? 'plan') as SessionPhase,
    isRunning: Boolean(row.is_running),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    criteriaCount: row.criteria_count,
    criteriaCompleted: row.criteria_completed,
  }))
}

export function listSessionsByProject(projectId: string, projectWorkdir: string): SessionSummary[] {
  const db = getDatabase()
  
  // Get sessions where workdir starts with projectWorkdir (includes subdirectories)
  const rows = db.prepare(`
    SELECT 
      s.id,
      s.project_id,
      s.workdir,
      s.mode,
      s.workflow_phase,
      s.is_running,
      s.created_at,
      s.updated_at,
      s.title,
      (SELECT COUNT(*) FROM criteria WHERE session_id = s.id) as criteria_count,
      (SELECT COUNT(*) FROM criteria WHERE session_id = s.id AND status LIKE '%"type":"passed"%') as criteria_completed
    FROM sessions s
    WHERE s.project_id = ? OR s.workdir LIKE ? || '%'
    ORDER BY s.updated_at DESC
  `).all(projectId, projectWorkdir) as SessionSummaryRow[]
  
  return rows.map(row => ({
    id: row.id,
    projectId: row.project_id,
    ...(row.title ? { title: row.title } : {}),
    workdir: row.workdir,
    mode: (row.mode ?? 'planner') as SessionMode,
    phase: (row.workflow_phase ?? 'plan') as SessionPhase,
    isRunning: Boolean(row.is_running),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    criteriaCount: row.criteria_count,
    criteriaCompleted: row.criteria_completed,
  }))
}

export function deleteSession(id: string): void {
  const db = getDatabase()
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

// ============================================================================
// Message Operations
// ============================================================================

export function addMessage(sessionId: string, message: Omit<Message, 'id' | 'timestamp'>): Message {
  const db = getDatabase()
  const id = crypto.randomUUID()
  const timestamp = new Date().toISOString()
  
  db.prepare(`
    INSERT INTO messages (
      id, session_id, role, content, tool_calls, thinking_content,
      tool_call_id, tool_name, tool_result, timestamp, token_count,
      is_compacted, original_message_ids, segments, stats, partial, is_system_generated, is_streaming, message_kind,
      sub_agent_id, sub_agent_type, context_window_id, is_compaction_summary, prompt_context
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    sessionId,
    message.role,
    message.content,
    message.toolCalls ? JSON.stringify(message.toolCalls) : null,
    message.thinkingContent ?? null,
    message.toolCallId ?? null,
    message.toolName ?? null,
    message.toolResult ? JSON.stringify(message.toolResult) : null,
    timestamp,
    message.tokenCount,
    message.isCompacted ? 1 : 0,
    message.originalMessageIds ? JSON.stringify(message.originalMessageIds) : null,
    message.segments ? JSON.stringify(message.segments) : null,
    message.stats ? JSON.stringify(message.stats) : null,
    message.partial ? 1 : 0,
    message.isSystemGenerated ? 1 : 0,
    message.isStreaming ? 1 : 0,
    message.messageKind ?? null,
    message.subAgentId ?? null,
    message.subAgentType ?? null,
    message.contextWindowId,
    message.isCompactionSummary ? 1 : 0,
    message.promptContext ? JSON.stringify(message.promptContext) : null
  )
  
  // Update session updated_at
  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(timestamp, sessionId)
  
  return {
    id,
    timestamp,
    ...message,
  }
}

export function getMessages(sessionId: string): Message[] {
  const db = getDatabase()
  
  const rows = db.prepare(`
    SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC
  `).all(sessionId) as MessageRow[]
  
  return rows.map(row => stripUndefined<Message>({
    id: row.id,
    role: row.role as Message['role'],
    content: row.content,
    contextWindowId: row.context_window_id,
    toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) as ToolCall[] : undefined,
    thinkingContent: row.thinking_content ?? undefined,
    toolCallId: row.tool_call_id ?? undefined,
    toolName: row.tool_name ?? undefined,
    toolResult: row.tool_result ? JSON.parse(row.tool_result) as ToolResult : undefined,
    timestamp: row.timestamp,
    tokenCount: row.token_count,
    isCompacted: row.is_compacted === 1,
    originalMessageIds: row.original_message_ids 
      ? JSON.parse(row.original_message_ids) as string[]
      : undefined,
    segments: row.segments
      ? JSON.parse(row.segments) as MessageSegment[]
      : undefined,
    stats: row.stats
      ? JSON.parse(row.stats) as Message['stats']
      : undefined,
    partial: row.partial === 1,
    isSystemGenerated: row.is_system_generated === 1 ? true : undefined,
    isStreaming: row.is_streaming === 1 ? true : undefined,
    messageKind: row.message_kind as Message['messageKind'] ?? undefined,
    isCompactionSummary: row.is_compaction_summary === 1 ? true : undefined,
    subAgentId: row.sub_agent_id ?? undefined,
    subAgentType: row.sub_agent_type as Message['subAgentType'] ?? undefined,
    promptContext: row.prompt_context
      ? JSON.parse(row.prompt_context) as Message['promptContext']
      : undefined,
  }))
}

export function deleteMessages(sessionId: string, messageIds: string[]): void {
  const db = getDatabase()
  const placeholders = messageIds.map(() => '?').join(', ')
  db.prepare(`
    DELETE FROM messages WHERE session_id = ? AND id IN (${placeholders})
  `).run(sessionId, ...messageIds)
}

export function updateMessageStats(sessionId: string, messageId: string, stats: Message['stats']): void {
  const db = getDatabase()
  
  db.prepare(`
    UPDATE messages SET stats = ? WHERE id = ?
  `).run(JSON.stringify(stats), messageId)
}

export function updateMessage(
  sessionId: string, 
  messageId: string, 
  updates: Partial<Omit<Message, 'id' | 'timestamp' | 'role'>>
): void {
  const db = getDatabase()
  
  // Build dynamic UPDATE query based on provided fields
  const setClauses: string[] = []
  const values: unknown[] = []
  
  if (updates.content !== undefined) {
    setClauses.push('content = ?')
    values.push(updates.content)
  }
  if (updates.thinkingContent !== undefined) {
    setClauses.push('thinking_content = ?')
    values.push(updates.thinkingContent)
  }
  if (updates.toolCalls !== undefined) {
    setClauses.push('tool_calls = ?')
    values.push(JSON.stringify(updates.toolCalls))
  }
  if (updates.tokenCount !== undefined) {
    setClauses.push('token_count = ?')
    values.push(updates.tokenCount)
  }
  if (updates.segments !== undefined) {
    setClauses.push('segments = ?')
    values.push(JSON.stringify(updates.segments))
  }
  if (updates.stats !== undefined) {
    setClauses.push('stats = ?')
    values.push(JSON.stringify(updates.stats))
  }
  if (updates.isStreaming !== undefined) {
    setClauses.push('is_streaming = ?')
    values.push(updates.isStreaming ? 1 : 0)
  }
  if (updates.partial !== undefined) {
    setClauses.push('partial = ?')
    values.push(updates.partial ? 1 : 0)
  }
  if (updates.promptContext !== undefined) {
    setClauses.push('prompt_context = ?')
    values.push(JSON.stringify(updates.promptContext))
  }
  
  if (setClauses.length === 0) return
  
  values.push(sessionId, messageId)
  
  db.prepare(`
    UPDATE messages SET ${setClauses.join(', ')} 
    WHERE session_id = ? AND id = ?
  `).run(...values)
}

// ============================================================================
// Criteria Operations
// ============================================================================

export function setCriteria(sessionId: string, criteria: Criterion[]): void {
  const db = getDatabase()
  
  // Clear existing criteria
  db.prepare('DELETE FROM criteria WHERE session_id = ?').run(sessionId)
  
  // Insert new criteria
  const insert = db.prepare(`
    INSERT INTO criteria (id, session_id, description, status, attempts, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  
  for (let i = 0; i < criteria.length; i++) {
    const c = criteria[i]!
    insert.run(
      c.id,
      sessionId,
      c.description,
      JSON.stringify(c.status),
      JSON.stringify(c.attempts),
      i
    )
  }
  
  // Update session updated_at
  const now = new Date().toISOString()
  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId)
}

export function getCriteria(sessionId: string): Criterion[] {
  const db = getDatabase()
  
  const rows = db.prepare(`
    SELECT * FROM criteria WHERE session_id = ? ORDER BY sort_order ASC
  `).all(sessionId) as CriterionRow[]
  
  return rows.map(row => ({
    id: row.id,
    description: row.description,
    status: JSON.parse(row.status) as CriterionStatus,
    attempts: JSON.parse(row.attempts) as CriterionAttempt[],
  }))
}

export function updateCriterion(
  sessionId: string,
  criterionId: string,
  updates: Partial<Pick<Criterion, 'status' | 'attempts'>>
): void {
  const db = getDatabase()
  
  const sets: string[] = []
  const values: string[] = []
  
  if (updates.status !== undefined) {
    sets.push('status = ?')
    values.push(JSON.stringify(updates.status))
  }
  if (updates.attempts !== undefined) {
    sets.push('attempts = ?')
    values.push(JSON.stringify(updates.attempts))
  }
  
  if (sets.length === 0) return
  
  values.push(sessionId, criterionId)
  
  db.prepare(`
    UPDATE criteria SET ${sets.join(', ')} WHERE session_id = ? AND id = ?
  `).run(...values)
  
  // Update session updated_at
  const now = new Date().toISOString()
  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId)
}

export function addCriterion(sessionId: string, criterion: Criterion): { success: true; actualId: string } | { success: false; error: string } {
  const db = getDatabase()
  
  // Get current max sort_order
  const maxRow = db.prepare(
    'SELECT MAX(sort_order) as max_order FROM criteria WHERE session_id = ?'
  ).get(sessionId) as { max_order: number | null } | undefined
  
  const sortOrder = (maxRow?.max_order ?? -1) + 1
  
  // Try inserting with the given ID, adding suffix on conflict
  let actualId = criterion.id
  let attempts = 0
  const maxAttempts = 10
  
  while (attempts < maxAttempts) {
    // First check if this exact (session_id, id) combo exists
    const existing = db.prepare('SELECT 1 FROM criteria WHERE session_id = ? AND id = ?').get(sessionId, actualId)
    if (existing) {
      attempts++
      actualId = `${criterion.id}-${attempts}`
      continue
    }
    
    try {
      const result = db.prepare(`
        INSERT INTO criteria (id, session_id, description, status, attempts, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        actualId,
        sessionId,
        criterion.description,
        JSON.stringify(criterion.status),
        JSON.stringify(criterion.attempts),
        sortOrder
      )
      
      if (result.changes > 0) {
        const now = new Date().toISOString()
        db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId)
        return { success: true, actualId }
      }
    } catch (err) {
      // If it's a constraint error, try next ID
      if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
        attempts++
        actualId = `${criterion.id}-${attempts}`
        continue
      }
      // Other error - return failure
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
    
    // ID conflict - add/increment suffix
    attempts++
    actualId = `${criterion.id}-${attempts}`
  }
  
  return { success: false, error: `Could not add criterion after ${maxAttempts} attempts` }
}

export function updateCriterionFull(
  sessionId: string,
  criterionId: string,
  updates: Partial<Pick<Criterion, 'description'>>
): void {
  const db = getDatabase()
  
  if (updates.description === undefined) return
  
  db.prepare(`
    UPDATE criteria SET description = ? WHERE session_id = ? AND id = ?
  `).run(updates.description, sessionId, criterionId)
  
  const now = new Date().toISOString()
  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId)
}

export function removeCriterion(sessionId: string, criterionId: string): void {
  const db = getDatabase()
  
  db.prepare('DELETE FROM criteria WHERE session_id = ? AND id = ?').run(sessionId, criterionId)
  
  const now = new Date().toISOString()
  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId)
}

// ============================================================================
// Execution State Operations
// ============================================================================

export function setExecutionState(sessionId: string, state: ExecutionState): void {
  const db = getDatabase()
  
  db.prepare(`
    INSERT OR REPLACE INTO execution_state (
      session_id, iteration, modified_files, read_files, consecutive_failures,
      last_failed_tool, last_failure_reason, current_token_count,
      message_count_at_last_update, compaction_count, started_at, last_activity_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    state.iteration,
    JSON.stringify(state.modifiedFiles),
    JSON.stringify(state.readFiles),
    state.consecutiveFailures,
    state.lastFailedTool ?? null,
    state.lastFailureReason ?? null,
    state.currentTokenCount,
    state.messageCountAtLastUpdate,
    state.compactionCount,
    state.startedAt,
    state.lastActivityAt
  )
}

export function getExecutionState(sessionId: string): ExecutionState | null {
  const db = getDatabase()
  
  const row = db.prepare(`
    SELECT * FROM execution_state WHERE session_id = ?
  `).get(sessionId) as ExecutionStateRow | undefined
  
  if (!row) {
    return null
  }
  
  return stripUndefined<ExecutionState>({
    iteration: row.iteration,
    modifiedFiles: JSON.parse(row.modified_files) as string[],
    readFiles: JSON.parse(row.read_files ?? '{}') as Record<string, FileReadEntry>,
    consecutiveFailures: row.consecutive_failures,
    lastFailedTool: row.last_failed_tool ?? undefined,
    lastFailureReason: row.last_failure_reason ?? undefined,
    currentTokenCount: row.current_token_count,
    messageCountAtLastUpdate: row.message_count_at_last_update ?? 0,
    compactionCount: row.compaction_count,
    startedAt: row.started_at,
    lastActivityAt: row.last_activity_at,
  })
}

export function clearExecutionState(sessionId: string): void {
  const db = getDatabase()
  db.prepare('DELETE FROM execution_state WHERE session_id = ?').run(sessionId)
}

// ============================================================================
// Context Window Operations
// ============================================================================

export function getContextWindows(sessionId: string): ContextWindow[] {
  const db = getDatabase()
  
  const rows = db.prepare(`
    SELECT * FROM context_windows WHERE session_id = ? ORDER BY sequence_number ASC
  `).all(sessionId) as ContextWindowRow[]
  
  return rows.map(row => stripUndefined<ContextWindow>({
    id: row.id,
    sessionId: row.session_id,
    sequenceNumber: row.sequence_number,
    createdAt: row.created_at,
    summaryOfPrevious: row.summary_of_previous ?? undefined,
    summaryTokenCount: row.summary_token_count ?? undefined,
    closedAt: row.closed_at ?? undefined,
    tokenCountAtClose: row.token_count_at_close ?? undefined,
  }))
}

export function getCurrentContextWindow(sessionId: string): ContextWindow | null {
  const db = getDatabase()
  
  // Current window is the one with highest sequence_number and no closed_at
  const row = db.prepare(`
    SELECT * FROM context_windows 
    WHERE session_id = ? AND closed_at IS NULL
    ORDER BY sequence_number DESC
    LIMIT 1
  `).get(sessionId) as ContextWindowRow | undefined
  
  if (!row) {
    return null
  }
  
  return stripUndefined<ContextWindow>({
    id: row.id,
    sessionId: row.session_id,
    sequenceNumber: row.sequence_number,
    createdAt: row.created_at,
    summaryOfPrevious: row.summary_of_previous ?? undefined,
    summaryTokenCount: row.summary_token_count ?? undefined,
    closedAt: row.closed_at ?? undefined,
    tokenCountAtClose: row.token_count_at_close ?? undefined,
  })
}

export function createContextWindow(
  sessionId: string,
  sequenceNumber: number,
  summaryOfPrevious?: string,
  summaryTokenCount?: number
): ContextWindow {
  const db = getDatabase()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  
  db.prepare(`
    INSERT INTO context_windows (id, session_id, sequence_number, created_at, summary_of_previous, summary_token_count)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, sessionId, sequenceNumber, now, summaryOfPrevious ?? null, summaryTokenCount ?? null)
  
  return stripUndefined<ContextWindow>({
    id,
    sessionId,
    sequenceNumber,
    createdAt: now,
    summaryOfPrevious,
    summaryTokenCount,
  })
}

export function closeContextWindow(windowId: string, tokenCountAtClose: number): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  
  db.prepare(`
    UPDATE context_windows SET closed_at = ?, token_count_at_close = ? WHERE id = ?
  `).run(now, tokenCountAtClose, windowId)
}

export function getMessagesForWindow(sessionId: string, contextWindowId: string): Message[] {
  const db = getDatabase()
  
  const rows = db.prepare(`
    SELECT * FROM messages WHERE session_id = ? AND context_window_id = ? ORDER BY timestamp ASC
  `).all(sessionId, contextWindowId) as MessageRow[]
  
  return rows.map(row => stripUndefined<Message>({
    id: row.id,
    role: row.role as Message['role'],
    content: row.content,
    contextWindowId: row.context_window_id,
    toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) as ToolCall[] : undefined,
    thinkingContent: row.thinking_content ?? undefined,
    toolCallId: row.tool_call_id ?? undefined,
    toolName: row.tool_name ?? undefined,
    toolResult: row.tool_result ? JSON.parse(row.tool_result) as ToolResult : undefined,
    timestamp: row.timestamp,
    tokenCount: row.token_count,
    isCompacted: row.is_compacted === 1,
    originalMessageIds: row.original_message_ids 
      ? JSON.parse(row.original_message_ids) as string[]
      : undefined,
    segments: row.segments
      ? JSON.parse(row.segments) as MessageSegment[]
      : undefined,
    stats: row.stats
      ? JSON.parse(row.stats) as Message['stats']
      : undefined,
    partial: row.partial === 1,
    isSystemGenerated: row.is_system_generated === 1 ? true : undefined,
    isStreaming: row.is_streaming === 1 ? true : undefined,
    messageKind: row.message_kind as Message['messageKind'] ?? undefined,
    isCompactionSummary: row.is_compaction_summary === 1 ? true : undefined,
    subAgentId: row.sub_agent_id ?? undefined,
    subAgentType: row.sub_agent_type as Message['subAgentType'] ?? undefined,
    promptContext: row.prompt_context
      ? JSON.parse(row.prompt_context) as Message['promptContext']
      : undefined,
  }))
}

// ============================================================================
// Row Types
// ============================================================================

interface SessionRow {
  id: string
  project_id: string
  workdir: string
  phase: string  // Legacy, kept for compatibility
  mode: string
  workflow_phase: string  // UI phase: plan/build/verification/done
  is_running: number
  summary: string | null
  created_at: string
  updated_at: string
  title: string | null
  total_tokens_used: number
  total_tool_calls: number
  iteration_count: number
}

interface SessionSummaryRow extends SessionRow {
  criteria_count: number
  criteria_completed: number
  workflow_phase: string  // From SessionRow, but make explicit
}

interface MessageRow {
  id: string
  session_id: string
  role: string
  content: string
  context_window_id: string
  tool_calls: string | null
  thinking_content: string | null
  tool_call_id: string | null
  tool_name: string | null
  tool_result: string | null
  timestamp: string
  token_count: number
  is_compacted: number
  original_message_ids: string | null
  segments: string | null
  stats: string | null
  partial: number
  is_system_generated: number
  is_streaming: number
  message_kind: string | null
  is_compaction_summary: number
  sub_agent_id: string | null
  sub_agent_type: string | null
  prompt_context: string | null
}

interface ContextWindowRow {
  id: string
  session_id: string
  sequence_number: number
  created_at: string
  summary_of_previous: string | null
  summary_token_count: number | null
  closed_at: string | null
  token_count_at_close: number | null
}

interface CriterionRow {
  id: string
  session_id: string
  description: string
  status: string
  attempts: string
  sort_order: number
}

interface ExecutionStateRow {
  session_id: string
  iteration: number
  modified_files: string
  read_files: string
  consecutive_failures: number
  last_failed_tool: string | null
  last_failure_reason: string | null
  current_token_count: number
  message_count_at_last_update: number
  compaction_count: number
  started_at: string
  last_activity_at: string
}
