import type {
  Session,
  SessionSummary,
  SessionPhase,
  Message,
  Criterion,
  ExecutionState,
} from '@openfox/shared'
import {
  createSession as dbCreateSession,
  getSession as dbGetSession,
  updateSessionPhase,
  updateSessionMetadata,
  listSessions as dbListSessions,
  deleteSession as dbDeleteSession,
  addMessage as dbAddMessage,
  getMessages,
  deleteMessages,
  setCriteria as dbSetCriteria,
  getCriteria,
  updateCriterion as dbUpdateCriterion,
  setExecutionState as dbSetExecutionState,
  getExecutionState,
  clearExecutionState,
} from '../db/sessions.js'
import { assertTransition, checkPhaseRequirements } from './state.js'
import { SessionNotFoundError, InvalidPhaseTransitionError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { EventEmitter, type Unsubscribe } from '../utils/async.js'

// ============================================================================
// Event Types
// ============================================================================

export type SessionEvent =
  | { type: 'session_created'; session: Session }
  | { type: 'session_updated'; session: Session }
  | { type: 'session_deleted'; sessionId: string }
  | { type: 'phase_changed'; sessionId: string; from: SessionPhase; to: SessionPhase }
  | { type: 'message_added'; sessionId: string; message: Message }
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
  
  createSession(workdir: string, title?: string): Session {
    logger.info('Creating session', { workdir, title })
    const session = dbCreateSession(workdir, title)
    
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
  
  deleteSession(id: string): void {
    logger.info('Deleting session', { id })
    dbDeleteSession(id)
    
    if (this.activeSessionId === id) {
      this.activeSessionId = null
    }
    
    this.emit({ type: 'session_deleted', sessionId: id })
  }
  
  // Phase transitions
  
  transition(sessionId: string, toPhase: SessionPhase): Session {
    const session = this.requireSession(sessionId)
    const fromPhase = session.phase
    
    logger.info('Transitioning session phase', { sessionId, from: fromPhase, to: toPhase })
    
    // Check if transition is valid
    assertTransition(fromPhase, toPhase)
    
    // Check requirements
    const requirements = checkPhaseRequirements(toPhase, {
      messageCount: session.messages.length,
      criteriaCount: session.criteria.length,
      criteriaAddressed: session.criteria.filter(c => 
        c.status.type === 'passed' || c.status.type === 'failed'
      ).length,
      validationPassed: session.criteria.every(c => c.status.type === 'passed'),
    })
    
    if (!requirements.canEnter) {
      throw new InvalidPhaseTransitionError(fromPhase, toPhase + `: ${requirements.reason}`)
    }
    
    // Perform transition
    updateSessionPhase(sessionId, toPhase)
    
    // Initialize execution state if entering executing phase
    if (toPhase === 'executing' && fromPhase !== 'validating') {
      const now = new Date().toISOString()
      const state: ExecutionState = {
        iteration: (session.executionState?.iteration ?? 0) + 1,
        modifiedFiles: [],
        consecutiveFailures: 0,
        currentTokenCount: 0,
        compactionCount: 0,
        startedAt: now,
        lastActivityAt: now,
      }
      dbSetExecutionState(sessionId, state)
    }
    
    // Clear execution state if going to idle or completed
    if (toPhase === 'idle' || toPhase === 'completed') {
      clearExecutionState(sessionId)
    }
    
    const updatedSession = this.requireSession(sessionId)
    
    this.emit({ type: 'phase_changed', sessionId, from: fromPhase, to: toPhase })
    this.emit({ type: 'session_updated', session: updatedSession })
    
    return updatedSession
  }
  
  // Messages
  
  addMessage(sessionId: string, message: Omit<Message, 'id' | 'timestamp'>): Message {
    this.requireSession(sessionId)
    
    const savedMessage = dbAddMessage(sessionId, message)
    
    this.emit({ type: 'message_added', sessionId, message: savedMessage })
    
    // If this is the first user message and we're idle, transition to planning
    const session = this.requireSession(sessionId)
    if (session.phase === 'idle' && message.role === 'user') {
      this.transition(sessionId, 'planning')
    }
    
    return savedMessage
  }
  
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
  
  // Execution state
  
  updateExecutionState(sessionId: string, updates: Partial<ExecutionState>): void {
    const session = this.requireSession(sessionId)
    
    const currentState = session.executionState ?? {
      iteration: 1,
      modifiedFiles: [],
      consecutiveFailures: 0,
      currentTokenCount: 0,
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
