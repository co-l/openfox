import type {
  Session,
  SessionSummary,
  SessionMode,
  SessionPhase,
  Message,
  Criterion,
  ExecutionState,
  ContextState,
} from '@openfox/shared'
import {
  createSession as dbCreateSession,
  getSession as dbGetSession,
  updateSessionMode,
  updateSessionPhase,
  updateSessionRunning,
  updateSessionSummary,
  updateSessionMetadata,
  listSessions as dbListSessions,
  listSessionsByProject as dbListSessionsByProject,
  deleteSession as dbDeleteSession,
  addMessage as dbAddMessage,
  getMessages,
  getMessagesForWindow,
  deleteMessages,
  updateMessageStats as dbUpdateMessageStats,
  updateMessage as dbUpdateMessage,
  setCriteria as dbSetCriteria,
  getCriteria,
  updateCriterion as dbUpdateCriterion,
  addCriterion as dbAddCriterion,
  updateCriterionFull as dbUpdateCriterionFull,
  removeCriterion as dbRemoveCriterion,
  setExecutionState as dbSetExecutionState,
  getExecutionState,
  clearExecutionState,
  getCurrentContextWindow,
  createContextWindow,
  closeContextWindow,
} from '../db/sessions.js'
import { getProject } from '../db/projects.js'
import { SessionNotFoundError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { EventEmitter, type Unsubscribe } from '../utils/async.js'
import { calculateContextTokens, isInDangerZone, canCompact } from '../context/index.js'
import { loadConfig } from '../config.js'

// ============================================================================
// Event Types
// ============================================================================

export type SessionEvent =
  | { type: 'session_created'; session: Session }
  | { type: 'session_updated'; session: Session }
  | { type: 'session_deleted'; sessionId: string }
  | { type: 'mode_changed'; sessionId: string; from: SessionMode; to: SessionMode }
  | { type: 'phase_changed'; sessionId: string; phase: SessionPhase }
  | { type: 'message_added'; sessionId: string; message: Message }
  | { type: 'message_updated'; sessionId: string; messageId: string; updates: Partial<Omit<Message, 'id' | 'timestamp' | 'role'>> }
  | { type: 'criteria_updated'; sessionId: string; criteria: Criterion[] }
  | { type: 'criterion_status_changed'; sessionId: string; criterionId: string; status: Criterion['status'] }
  | { type: 'execution_state_changed'; sessionId: string; state: ExecutionState | null }

type SessionEvents = {
  event: [SessionEvent]
  [key: `session:${string}`]: [SessionEvent]
}

// ============================================================================
// Session Manager
// ============================================================================

class SessionManagerImpl {
  private events = new EventEmitter<SessionEvents>()
  private activeSessionId: string | null = null
  
  // Lifecycle
  
  createSession(projectId: string, title?: string): Session {
    const project = getProject(projectId)
    if (!project) {
      throw new Error(`Project not found: ${projectId}`)
    }
    
    // Auto-generate title if not provided: "Session N"
    let sessionTitle = title
    if (!sessionTitle) {
      const existingSessions = dbListSessionsByProject(projectId, project.workdir)
      sessionTitle = `Session ${existingSessions.length + 1}`
    }
    
    logger.info('Creating session', { projectId, workdir: project.workdir, title: sessionTitle })
    const session = dbCreateSession(projectId, project.workdir, sessionTitle)
    
    this.emit({ type: 'session_created', session })
    
    return session
  }
  
  getSession(id: string): Session | null {
    return dbGetSession(id)
  }
  
  requireSession(id: string): Session {
    const session = this.getSession(id)
    if (!session) {
      throw new SessionNotFoundError(id)
    }
    return session
  }
  
  listSessions(): SessionSummary[] {
    return dbListSessions()
  }
  
  listSessionsByProject(projectId: string): SessionSummary[] {
    const project = getProject(projectId)
    if (!project) {
      return []
    }
    return dbListSessionsByProject(projectId, project.workdir)
  }
  
  deleteSession(id: string): void {
    logger.info('Deleting session', { id })
    dbDeleteSession(id)
    
    if (this.activeSessionId === id) {
      this.activeSessionId = null
    }
    
    this.emit({ type: 'session_deleted', sessionId: id })
  }
  
  // Mode management (simpler than old phase system)
  
  setMode(sessionId: string, toMode: SessionMode): Session {
    const session = this.requireSession(sessionId)
    const fromMode = session.mode
    
    if (fromMode === toMode) {
      return session
    }
    
    logger.info('Changing session mode', { sessionId, from: fromMode, to: toMode })
    
    updateSessionMode(sessionId, toMode)
    
    // Initialize execution state if entering builder mode from planner
    if (toMode === 'builder' && fromMode === 'planner') {
      const now = new Date().toISOString()
      const state: ExecutionState = {
        iteration: (session.executionState?.iteration ?? 0) + 1,
        modifiedFiles: session.executionState?.modifiedFiles ?? [],
        consecutiveFailures: 0,
        currentTokenCount: session.executionState?.currentTokenCount ?? 0,
        compactionCount: session.executionState?.compactionCount ?? 0,
        startedAt: now,
        lastActivityAt: now,
      }
      dbSetExecutionState(sessionId, state)
    }
    
    const updatedSession = this.requireSession(sessionId)
    
    this.emit({ type: 'mode_changed', sessionId, from: fromMode, to: toMode })
    this.emit({ type: 'session_updated', session: updatedSession })
    
    return updatedSession
  }
  
  setPhase(sessionId: string, phase: SessionPhase): Session {
    const session = this.requireSession(sessionId)
    
    if (session.phase === phase) {
      return session
    }
    
    logger.info('Changing session phase', { sessionId, from: session.phase, to: phase })
    
    updateSessionPhase(sessionId, phase)
    
    const updatedSession = this.requireSession(sessionId)
    
    this.emit({ type: 'phase_changed', sessionId, phase })
    this.emit({ type: 'session_updated', session: updatedSession })
    
    return updatedSession
  }
  
  setRunning(sessionId: string, isRunning: boolean): Session {
    const session = this.requireSession(sessionId)
    
    if (session.isRunning === isRunning) {
      return session
    }
    
    logger.info('Setting session running state', { sessionId, isRunning })
    
    updateSessionRunning(sessionId, isRunning)
    
    const updatedSession = this.requireSession(sessionId)
    this.emit({ type: 'session_updated', session: updatedSession })
    
    return updatedSession
  }
  
  setSummary(sessionId: string, summary: string): Session {
    logger.info('Setting session summary', { sessionId, summaryLength: summary.length })
    
    updateSessionSummary(sessionId, summary)
    
    const updatedSession = this.requireSession(sessionId)
    this.emit({ type: 'session_updated', session: updatedSession })
    
    return updatedSession
  }
  
  // Messages
  
  addMessage(sessionId: string, message: Omit<Message, 'id' | 'timestamp'>): Message {
    this.requireSession(sessionId)
    
    // Auto-assign current context window ID if not provided
    let messageWithWindow = message
    if (!message.contextWindowId) {
      const currentWindow = getCurrentContextWindow(sessionId)
      if (currentWindow) {
        messageWithWindow = { ...message, contextWindowId: currentWindow.id }
      }
    }
    
    const savedMessage = dbAddMessage(sessionId, messageWithWindow)
    
    this.emit({ type: 'message_added', sessionId, message: savedMessage })
    
    return savedMessage
  }
  
  updateMessageStats(sessionId: string, messageId: string, stats: Message['stats']): void {
    this.requireSession(sessionId)
    dbUpdateMessageStats(sessionId, messageId, stats)
  }
  
  updateMessage(
    sessionId: string, 
    messageId: string, 
    updates: Partial<Omit<Message, 'id' | 'timestamp' | 'role'>>
  ): void {
    this.requireSession(sessionId)
    dbUpdateMessage(sessionId, messageId, updates)
    this.emit({ type: 'message_updated', sessionId, messageId, updates })
  }
  
  /**
   * Compact context using the context windows model.
   * 
   * The caller should have already:
   * 1. Added compaction prompt as a user message (in current window)
   * 2. Streamed the summary response (in current window, with isCompactionSummary)
   * 
   * This function:
   * - Closes the current context window (preserves all messages including summary)
   * - Creates a new empty context window for future messages
   * - Resets token tracking for the new window
   * 
   * @param sessionId - The session to compact
   * @param summary - The summary content (for storing in window metadata)
   * @param tokenCountAtClose - Token count when closing the window
   */
  compactContext(sessionId: string, summary: string, tokenCountAtClose: number): void {
    const session = this.requireSession(sessionId)
    
    // Get current context window
    const currentWindow = getCurrentContextWindow(sessionId)
    if (!currentWindow) {
      throw new Error('No current context window to compact')
    }
    
    // Estimate summary tokens
    const summaryTokenCount = Math.ceil(summary.length / 4)
    
    // Close current window
    closeContextWindow(currentWindow.id, tokenCountAtClose)
    
    // Create new context window with next sequence number
    // The summary is stored as metadata for reference
    createContextWindow(
      sessionId,
      currentWindow.sequenceNumber + 1,
      summary,
      summaryTokenCount
    )
    
    // Update execution state - new window starts fresh
    const execState = session.executionState
    this.updateExecutionState(sessionId, {
      currentTokenCount: 0,
      messageCountAtLastUpdate: 0,
      compactionCount: (execState?.compactionCount ?? 0) + 1,
    })
    
    const updatedSession = this.requireSession(sessionId)
    this.emit({ type: 'session_updated', session: updatedSession })
  }
  
  /**
   * Get messages for the current context window only (for LLM context building).
   * Returns empty array if no current window exists.
   */
  getCurrentWindowMessages(sessionId: string): Message[] {
    const currentWindow = getCurrentContextWindow(sessionId)
    if (!currentWindow) {
      return []
    }
    return getMessagesForWindow(sessionId, currentWindow.id)
  }
  
  /**
   * @deprecated Use compactContext() with the new context windows model
   */
  compactMessages(sessionId: string, messageIds: string[], summary: string): Message {
    this.requireSession(sessionId)
    
    // Delete old messages
    deleteMessages(sessionId, messageIds)
    
    // Add compacted message
    const compactedMessage = dbAddMessage(sessionId, {
      role: 'system',
      content: `[COMPACTED HISTORY]\n${summary}`,
      tokenCount: Math.ceil(summary.length / 4), // Approximate
      isCompacted: true,
      originalMessageIds: messageIds,
    })
    
    const session = this.requireSession(sessionId)
    this.emit({ type: 'session_updated', session })
    
    return compactedMessage
  }
  
  // Criteria
  
  setCriteria(sessionId: string, criteria: Criterion[]): void {
    this.requireSession(sessionId)
    
    dbSetCriteria(sessionId, criteria)
    
    this.emit({ type: 'criteria_updated', sessionId, criteria })
  }
  
  addCriterion(sessionId: string, criterion: Criterion): Criterion[] {
    this.requireSession(sessionId)
    
    dbAddCriterion(sessionId, criterion)
    
    // Reload to get updated list
    const criteria = getCriteria(sessionId)
    this.emit({ type: 'criteria_updated', sessionId, criteria })
    
    return criteria
  }
  
  updateCriterionFull(
    sessionId: string,
    criterionId: string,
    updates: Partial<Pick<Criterion, 'description'>>
  ): Criterion[] {
    const session = this.requireSession(sessionId)
    
    // Check criterion exists
    if (!session.criteria.find(c => c.id === criterionId)) {
      throw new Error(`Criterion not found: ${criterionId}`)
    }
    
    dbUpdateCriterionFull(sessionId, criterionId, updates)
    
    // Reload to get updated list
    const criteria = getCriteria(sessionId)
    this.emit({ type: 'criteria_updated', sessionId, criteria })
    
    return criteria
  }
  
  removeCriterion(sessionId: string, criterionId: string): Criterion[] {
    const session = this.requireSession(sessionId)
    
    // Check criterion exists
    if (!session.criteria.find(c => c.id === criterionId)) {
      throw new Error(`Criterion not found: ${criterionId}`)
    }
    
    dbRemoveCriterion(sessionId, criterionId)
    
    // Reload to get updated list
    const criteria = getCriteria(sessionId)
    this.emit({ type: 'criteria_updated', sessionId, criteria })
    
    return criteria
  }
  
  updateCriterionStatus(
    sessionId: string,
    criterionId: string,
    status: Criterion['status']
  ): void {
    this.requireSession(sessionId)
    
    dbUpdateCriterion(sessionId, criterionId, { status })
    
    this.emit({ type: 'criterion_status_changed', sessionId, criterionId, status })
  }
  
  addCriterionAttempt(
    sessionId: string,
    criterionId: string,
    attempt: Criterion['attempts'][number]
  ): void {
    const session = this.requireSession(sessionId)
    const criterion = session.criteria.find(c => c.id === criterionId)
    
    if (!criterion) {
      throw new Error(`Criterion not found: ${criterionId}`)
    }
    
    const attempts = [...criterion.attempts, attempt]
    dbUpdateCriterion(sessionId, criterionId, { attempts })
  }
  
  /**
   * Reset verification attempts on all criteria (used when user intervenes after blocked state)
   */
  resetAllCriteriaAttempts(sessionId: string): void {
    const session = this.requireSession(sessionId)
    
    for (const criterion of session.criteria) {
      if (criterion.attempts.length > 0) {
        dbUpdateCriterion(sessionId, criterion.id, { attempts: [] })
      }
    }
  }
  
  // Execution state
  
  updateExecutionState(sessionId: string, updates: Partial<ExecutionState>): void {
    const session = this.requireSession(sessionId)
    
    const currentState = session.executionState ?? {
      iteration: 1,
      modifiedFiles: [],
      consecutiveFailures: 0,
      currentTokenCount: 0,
      messageCountAtLastUpdate: 0,
      compactionCount: 0,
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    }
    
    const newState: ExecutionState = {
      ...currentState,
      ...updates,
      lastActivityAt: new Date().toISOString(),
    }
    
    dbSetExecutionState(sessionId, newState)
    
    this.emit({ type: 'execution_state_changed', sessionId, state: newState })
  }
  
  addModifiedFile(sessionId: string, filePath: string): void {
    const session = this.requireSession(sessionId)
    const modifiedFiles = session.executionState?.modifiedFiles ?? []
    
    if (!modifiedFiles.includes(filePath)) {
      this.updateExecutionState(sessionId, {
        modifiedFiles: [...modifiedFiles, filePath],
      })
    }
  }
  
  recordToolFailure(sessionId: string, tool: string, reason: string): void {
    const session = this.requireSession(sessionId)
    const consecutiveFailures = (session.executionState?.consecutiveFailures ?? 0) + 1
    
    this.updateExecutionState(sessionId, {
      consecutiveFailures,
      lastFailedTool: tool,
      lastFailureReason: reason,
    })
  }
  
  resetToolFailures(sessionId: string): void {
    this.updateExecutionState(sessionId, {
      consecutiveFailures: 0,
      lastFailedTool: undefined,
      lastFailureReason: undefined,
    })
  }
  
  /**
   * Set the current context window size (prompt tokens from last LLM call).
   * This is used for compaction decisions. Also tracks message count for staleness detection.
   */
  setCurrentContextSize(sessionId: string, promptTokens: number): void {
    const session = this.requireSession(sessionId)
    this.updateExecutionState(sessionId, {
      currentTokenCount: promptTokens,
      messageCountAtLastUpdate: session.messages.length,
    })
  }
  
  /**
   * Add to the cumulative token usage (for billing/metrics).
   * This tracks total tokens consumed across all LLM calls.
   */
  addTokensUsed(sessionId: string, tokens: number): void {
    const session = this.requireSession(sessionId)
    updateSessionMetadata(sessionId, {
      totalTokensUsed: session.metadata.totalTokensUsed + tokens,
    })
  }
  
  /**
   * @deprecated Use setCurrentContextSize() and addTokensUsed() separately
   */
  incrementTokenCount(sessionId: string, tokens: number): void {
    const session = this.requireSession(sessionId)
    const currentTokenCount = (session.executionState?.currentTokenCount ?? 0) + tokens
    
    this.updateExecutionState(sessionId, { currentTokenCount })
    
    // Also update total tokens in metadata
    updateSessionMetadata(sessionId, {
      totalTokensUsed: session.metadata.totalTokensUsed + tokens,
    })
  }
  
  incrementToolCalls(sessionId: string): void {
    const session = this.requireSession(sessionId)
    
    updateSessionMetadata(sessionId, {
      totalToolCalls: session.metadata.totalToolCalls + 1,
    })
  }
  
  // Context state
  
  /**
   * Get the current context state for a session.
   * Only counts tokens in the CURRENT context window (after any compaction).
   * Uses real token count from LLM if available and fresh, otherwise estimates.
   */
  getContextState(sessionId: string): ContextState {
    const session = this.requireSession(sessionId)
    const config = loadConfig()
    const maxTokens = config.context.maxTokens
    const execState = session.executionState
    
    // Get messages for current window only
    const currentWindowMessages = this.getCurrentWindowMessages(sessionId)
    const currentMessageCount = currentWindowMessages.length
    
    let currentTokens: number
    
    // Use real token count if we have it and it's fresh (message count matches current window)
    const realTokenCount = execState?.currentTokenCount ?? 0
    const messageCountAtUpdate = execState?.messageCountAtLastUpdate ?? 0
    const isFresh = realTokenCount > 0 && messageCountAtUpdate === currentMessageCount
    
    if (isFresh) {
      // Real count from last LLM call is still valid
      currentTokens = realTokenCount
    } else if (realTokenCount > 0 && messageCountAtUpdate > 0 && messageCountAtUpdate <= currentMessageCount) {
      // We have a real count but messages were added since - estimate the delta
      const newMessages = currentWindowMessages.slice(messageCountAtUpdate)
      const deltaTokens = calculateContextTokens(newMessages)
      currentTokens = realTokenCount + deltaTokens
    } else {
      // No real count available - full estimation of current window only
      currentTokens = calculateContextTokens(currentWindowMessages)
    }
    
    return {
      currentTokens,
      maxTokens,
      compactionCount: execState?.compactionCount ?? 0,
      dangerZone: isInDangerZone(currentTokens, maxTokens),
      canCompact: canCompact(currentTokens, maxTokens),
    }
  }
  
  // Active session
  
  setActiveSession(id: string | null): void {
    this.activeSessionId = id
  }
  
  getActiveSessionId(): string | null {
    return this.activeSessionId
  }
  
  // Events
  
  subscribe(callback: (event: SessionEvent) => void): Unsubscribe {
    return this.events.on('event', callback)
  }
  
  subscribeToSession(sessionId: string, callback: (event: SessionEvent) => void): Unsubscribe {
    return this.events.on(`session:${sessionId}`, callback)
  }
  
  private emit(event: SessionEvent): void {
    this.events.emit('event', event)
    
    // Also emit to session-specific channel
    if ('sessionId' in event) {
      this.events.emit(`session:${event.sessionId}`, event)
    } else if ('session' in event) {
      this.events.emit(`session:${event.session.id}`, event)
    }
  }
}

// Singleton instance
export const sessionManager = new SessionManagerImpl()
