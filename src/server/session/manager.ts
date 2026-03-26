/**
 * Session Manager
 *
 * Manages session lifecycle (create, delete, list) and provides access to session state.
 * All session state is derived from EventStore - this is a thin wrapper.
 *
 * State changes should go through the events/session.ts API directly,
 * not through SessionManager.
 */

import type {
  Session,
  SessionSummary,
  SessionMode,
  SessionPhase,
  Criterion,
  ContextState,
  Attachment,
} from '../../shared/types.js'
import type { QueuedMessage } from '../../shared/protocol.js'
import {
  createSession as dbCreateSession,
  getSession as dbGetSession,
  listSessions as dbListSessions,
  listSessionsByProject as dbListSessionsByProject,
  deleteSession as dbDeleteSession,
  updateSessionSummary,
  updateSessionMetadata,
  updateSessionProvider,
} from '../db/sessions.js'
import { getProject } from '../db/projects.js'
import { SessionNotFoundError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { EventEmitter, type Unsubscribe } from '../utils/async.js'
import { getLspManager as getOrCreateLspManager, shutdownLspManager, type LspManager } from '../lsp/index.js'
import { getEventStore } from '../events/store.js'
import {
  getSessionState,
  emitSessionInitialized,
  emitModeChanged,
  emitPhaseChanged,
  emitRunningChanged,
  emitUserMessage,
  emitAssistantMessageStart,
  emitMessageDone,
  emitCriteriaSet,
  emitCriterionUpdated,
  emitContextCompacted,
  emitContextState,
  getCurrentWindowMessages as getWindowMessages,
  type FoldedSessionState,
} from '../events/index.js'
import type { Message, CriterionStatus } from '../../shared/types.js'
import { isInDangerZone, canCompact } from '../context/tokenizer.js'
import { getRuntimeConfig } from '../runtime-config.js'

// ============================================================================
// Event Types (for backward compatibility with existing subscribers)
// ============================================================================

export type SessionEvent =
  | { type: 'session_created'; session: Session }
  | { type: 'session_updated'; session: Session }
  | { type: 'session_deleted'; sessionId: string }
  | { type: 'mode_changed'; sessionId: string; from: SessionMode; to: SessionMode }
  | { type: 'phase_changed'; sessionId: string; phase: SessionPhase }
  | { type: 'running_changed'; sessionId: string; isRunning: boolean }
  | { type: 'criteria_updated'; sessionId: string; criteria: Criterion[] }
  | { type: 'message_added'; sessionId: string; message: Message }

type SessionEvents = {
  event: [SessionEvent]
  [key: `session:${string}`]: [SessionEvent]
}

// ============================================================================
// Session Manager
// ============================================================================

export class SessionManager {
  private events = new EventEmitter<SessionEvents>()
  private activeSessionId: string | null = null

  // ============================================================================
  // Session Lifecycle
  // ============================================================================

  /**
   * Create a new session. Emits session.initialized event.
   */
  createSession(projectId: string, title?: string, providerId?: string | null, providerModel?: string | null): Session {
    const project = getProject(projectId)
    if (!project) {
      throw new Error(`Project not found: ${projectId}`)
    }

    // Auto-generate title if not provided
    let sessionTitle = title
    if (!sessionTitle) {
      const existingSessions = dbListSessionsByProject(projectId, project.workdir)
      sessionTitle = `Session ${existingSessions.length + 1}`
    }

    logger.debug('Creating session', { projectId, workdir: project.workdir, title: sessionTitle })

    // Create session in DB (minimal: id, projectId, workdir, title, timestamps)
    const dbSession = dbCreateSession(projectId, project.workdir, sessionTitle, providerId, providerModel)

    // Emit session.initialized event to EventStore
    const contextWindowId = crypto.randomUUID()
    emitSessionInitialized(dbSession.id, projectId, project.workdir, contextWindowId, sessionTitle)

    // Build full session object
    const session = this.buildSessionFromDb(dbSession)

    this.emit({ type: 'session_created', session })

    return session
  }

  /**
   * Get a session by ID. Returns null if not found.
   * Session state is derived from EventStore.
   */
  getSession(id: string): Session | null {
    const dbSession = dbGetSession(id)
    if (!dbSession) {
      return null
    }
    return this.buildSessionFromDb(dbSession)
  }

  /**
   * Get a session by ID. Throws if not found.
   */
  requireSession(id: string): Session {
    const session = this.getSession(id)
    if (!session) {
      throw new SessionNotFoundError(id)
    }
    return session
  }

  /**
   * List all sessions (summary only).
   */
  listSessions(): SessionSummary[] {
    return dbListSessions()
  }

  /**
   * List sessions for a project.
   */
  listSessionsByProject(projectId: string): SessionSummary[] {
    const project = getProject(projectId)
    if (!project) {
      return []
    }
    return dbListSessionsByProject(projectId, project.workdir)
  }

  /**
   * Delete a session and all its events.
   */
  deleteSession(id: string): void {
    logger.debug('Deleting session', { id })

    // Shutdown LSP manager
    shutdownLspManager(id).catch((err) => {
      logger.error('Error shutting down LSP manager', { sessionId: id, error: err })
    })

    // Delete events first
    const eventStore = getEventStore()
    eventStore.deleteSession(id)

    // Delete session from DB
    dbDeleteSession(id)

    if (this.activeSessionId === id) {
      this.activeSessionId = null
    }

    this.emit({ type: 'session_deleted', sessionId: id })
  }

  /**
   * Get a project by ID.
   */
  getProject(projectId: string) {
    return getProject(projectId)
  }

  /**
   * Delete all sessions for a project.
   */
  deleteAllSessions(projectId: string, workdir: string): void {
    logger.debug('Deleting all sessions for project', { projectId, workdir })

    const sessions = dbListSessionsByProject(projectId, workdir)

    sessions.forEach((session) => {
      this.deleteSession(session.id)
    })
  }

  // ============================================================================
  // State Changes (emit events + notify subscribers)
  // ============================================================================

  /**
   * Change session mode. Emits mode.changed event.
   */
  setMode(sessionId: string, toMode: SessionMode): Session {
    const session = this.requireSession(sessionId)
    const fromMode = session.mode

    if (fromMode === toMode) {
      return session
    }

    logger.debug('Changing session mode', { sessionId, from: fromMode, to: toMode })

    emitModeChanged(sessionId, toMode, false)

    const updatedSession = this.requireSession(sessionId)

    this.emit({ type: 'mode_changed', sessionId, from: fromMode, to: toMode })
    this.emit({ type: 'session_updated', session: updatedSession })

    return updatedSession
  }

  /**
   * Change session phase. Emits phase.changed event.
   */
  setPhase(sessionId: string, phase: SessionPhase): Session {
    const session = this.requireSession(sessionId)

    if (session.phase === phase) {
      return session
    }

    logger.debug('Changing session phase', { sessionId, from: session.phase, to: phase })

    emitPhaseChanged(sessionId, phase)

    const updatedSession = this.requireSession(sessionId)

    this.emit({ type: 'phase_changed', sessionId, phase })

    return updatedSession
  }

  /**
   * Set session running state. Emits running.changed event.
   */
  setRunning(sessionId: string, isRunning: boolean): Session {
    const session = this.requireSession(sessionId)

    if (session.isRunning === isRunning) {
      return session
    }

    logger.debug('Setting session running state', { sessionId, isRunning })

    emitRunningChanged(sessionId, isRunning)

    const updatedSession = this.requireSession(sessionId)
    this.emit({ type: 'session_updated', session: updatedSession })
    this.emit({ type: 'running_changed', sessionId, isRunning })

    return updatedSession
  }

  /**
   * Set session summary. Updates DB directly (metadata, not event).
   */
  setSummary(sessionId: string, summary: string): Session {
    logger.debug('Setting session summary', { sessionId, summaryLength: summary.length })

    updateSessionSummary(sessionId, summary)

    const updatedSession = this.requireSession(sessionId)
    this.emit({ type: 'session_updated', session: updatedSession })

    return updatedSession
  }

  /**
   * Set session provider/model. Updates DB directly.
   */
  setSessionProvider(sessionId: string, providerId: string | null, providerModel: string | null): Session {
    logger.debug('Setting session provider', { sessionId, providerId, providerModel })

    updateSessionProvider(sessionId, providerId, providerModel)

    const updatedSession = this.requireSession(sessionId)
    this.emit({ type: 'session_updated', session: updatedSession })

    return updatedSession
  }

  // ============================================================================
  // Session Metadata (DB operations)
  // ============================================================================

  /**
   * Add to the cumulative token usage.
   */
  addTokensUsed(sessionId: string, tokens: number): void {
    const session = this.requireSession(sessionId)
    updateSessionMetadata(sessionId, {
      totalTokensUsed: session.metadata.totalTokensUsed + tokens,
    })
  }

  /**
   * Increment tool call counter.
   */
  incrementToolCalls(sessionId: string): void {
    const session = this.requireSession(sessionId)
    updateSessionMetadata(sessionId, {
      totalToolCalls: session.metadata.totalToolCalls + 1,
    })
  }

  // ============================================================================
  // Message Operations (delegates to EventStore)
  // ============================================================================

  /**
   * Add a message. Delegates to EventStore.
   */
  addMessage(
    sessionId: string,
    message: Omit<Message, 'id' | 'timestamp'>
  ): Message {
    this.requireSession(sessionId)

    const state = getSessionState(sessionId)
    const contextWindowId = message.contextWindowId ?? state?.currentContextWindowId

    // Build options object without undefined values
    const options: {
      contextWindowId?: string
      isSystemGenerated?: boolean
      messageKind?: 'correction' | 'auto-prompt' | 'context-reset' | 'task-completed' | 'command'
      tokenCount?: number
      attachments?: Attachment[] // Optional image attachments
      subAgentId?: string
      subAgentType?: string
    } = {}
    if (contextWindowId !== undefined) options.contextWindowId = contextWindowId
    if (message.isSystemGenerated !== undefined) options.isSystemGenerated = message.isSystemGenerated
    if (message.messageKind !== undefined) options.messageKind = message.messageKind
    if (message.tokenCount !== undefined) options.tokenCount = message.tokenCount
    if (message.attachments !== undefined) options.attachments = message.attachments
    if (message.subAgentId !== undefined) options.subAgentId = message.subAgentId
    if (message.subAgentType !== undefined) options.subAgentType = message.subAgentType

    // Emit message events
    const messageId = emitUserMessage(sessionId, message.content, options)

    // Build result without undefined values
    const result: Message = {
      id: messageId,
      role: message.role,
      content: message.content,
      timestamp: new Date().toISOString(),
    }
    if (contextWindowId !== undefined) result.contextWindowId = contextWindowId
    if (message.isSystemGenerated !== undefined) result.isSystemGenerated = message.isSystemGenerated
    if (message.messageKind !== undefined) result.messageKind = message.messageKind
    if (message.attachments !== undefined) result.attachments = message.attachments
    if (message.subAgentId !== undefined) result.subAgentId = message.subAgentId
    if (message.subAgentType !== undefined) result.subAgentType = message.subAgentType

    // Emit internal event for subscribers
    this.emit({ type: 'message_added', sessionId, message: result })

    return result
  }

  /**
   * Add an assistant message. Delegates to EventStore.
   */
  addAssistantMessage(
    sessionId: string,
    message: Omit<Message, 'id' | 'timestamp' | 'role'>
  ): Message {
    this.requireSession(sessionId)

    const state = getSessionState(sessionId)
    const contextWindowId = message.contextWindowId ?? state?.currentContextWindowId

    // Build options object without undefined values
    const options: {
      contextWindowId?: string
      subAgentId?: string
      subAgentType?: string
    } = {}
    if (contextWindowId !== undefined) options.contextWindowId = contextWindowId
    if (message.subAgentId !== undefined) options.subAgentId = message.subAgentId
    if (message.subAgentType !== undefined) options.subAgentType = message.subAgentType

    // Emit message start event
    const messageId = emitAssistantMessageStart(sessionId, options)

    // Build result without undefined values
    const result: Message = {
      id: messageId,
      role: 'assistant',
      content: message.content ?? '',
      timestamp: new Date().toISOString(),
    }
    if (contextWindowId !== undefined) result.contextWindowId = contextWindowId
    if (message.subAgentId !== undefined) result.subAgentId = message.subAgentId
    if (message.subAgentType !== undefined) result.subAgentType = message.subAgentType
    if (message.isStreaming !== undefined) result.isStreaming = message.isStreaming
    if (message.thinkingContent !== undefined) result.thinkingContent = message.thinkingContent

    // Emit internal event for subscribers
    this.emit({ type: 'message_added', sessionId, message: result })

    return result
  }

  /**
   * Update message stats. Delegates to EventStore (emits message.done if needed).
   */
  updateMessageStats(sessionId: string, messageId: string, stats: Message['stats']): void {
    this.requireSession(sessionId)
    // Stats are included in message.done event, which should already have been emitted
    // This is a no-op in the new model - stats come from LLM streaming
    logger.debug('updateMessageStats called (no-op in event model)', { sessionId, messageId })
  }

  /**
   * Update a message. Delegates to EventStore.
   */
  updateMessage(
    sessionId: string,
    messageId: string,
    updates: Partial<Omit<Message, 'id' | 'timestamp' | 'role'>>
  ): void {
    this.requireSession(sessionId)
    // In the event model, messages are immutable after message.done
    // Some updates like isCompactionSummary should be set in message.start
    logger.debug('updateMessage called (limited support in event model)', { sessionId, messageId, updates })
  }

  /**
   * Get messages for the current context window.
   */
  getCurrentWindowMessages(sessionId: string): Message[] {
    const state = getSessionState(sessionId)
    if (!state) return []

    return state.messages
      .filter((m) => m.contextWindowId === state.currentContextWindowId)
      .map((m) => {
        const msg: Message = {
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: new Date(m.timestamp).toISOString(),
        }
        if (m.thinkingContent !== undefined) msg.thinkingContent = m.thinkingContent
        if (m.toolCalls !== undefined) msg.toolCalls = m.toolCalls
        if (m.segments !== undefined) msg.segments = m.segments
        if (m.stats !== undefined) msg.stats = m.stats
        if (m.partial !== undefined) msg.partial = m.partial
        if (m.isStreaming !== undefined) msg.isStreaming = m.isStreaming
        if (m.contextWindowId !== undefined) msg.contextWindowId = m.contextWindowId
        if (m.isSystemGenerated !== undefined) msg.isSystemGenerated = m.isSystemGenerated
        if (m.messageKind !== undefined) msg.messageKind = m.messageKind
        if (m.isCompactionSummary !== undefined) msg.isCompactionSummary = m.isCompactionSummary
        if (m.promptContext !== undefined) msg.promptContext = m.promptContext
        return msg
      })
  }

  /**
   * Compact context. Delegates to EventStore.
   */
  compactContext(sessionId: string, summary: string, tokenCountAtClose: number): void {
    const state = getSessionState(sessionId)
    if (!state) {
      throw new Error('Session not found')
    }

    const closedWindowId = state.currentContextWindowId
    const newWindowId = crypto.randomUUID()

    emitContextCompacted(sessionId, closedWindowId, newWindowId, tokenCountAtClose, 0, summary)
    emitUserMessage(sessionId, `Previous context summary:\n${summary}`, {
      contextWindowId: newWindowId,
      isSystemGenerated: true,
      messageKind: 'auto-prompt',
      isCompactionSummary: true,
    })
  }

  /**
   * Set current context size (for token tracking).
   * Emits a context.state event with the real promptTokens from the LLM.
   */
  setCurrentContextSize(sessionId: string, promptTokens: number): void {
    const config = getRuntimeConfig()
    const maxTokens = config.context.maxTokens
    const state = getSessionState(sessionId)
    const compactionCount = state?.contextState.compactionCount ?? 0

    emitContextState(
      sessionId,
      promptTokens,
      maxTokens,
      compactionCount,
      isInDangerZone(promptTokens, maxTokens),
      canCompact(promptTokens, maxTokens)
    )

    logger.debug('Context state updated', { sessionId, promptTokens, maxTokens })
  }

  // ============================================================================
  // Criteria Operations (delegates to EventStore)
  // ============================================================================

  /**
   * Set criteria. Delegates to EventStore.
   */
  setCriteria(sessionId: string, criteria: Criterion[]): void {
    this.requireSession(sessionId)
    emitCriteriaSet(sessionId, criteria)
    this.emit({ type: 'criteria_updated', sessionId, criteria })
  }

  /**
   * Update criterion status. Delegates to EventStore.
   */
  updateCriterionStatus(sessionId: string, criterionId: string, status: CriterionStatus): void {
    this.requireSession(sessionId)
    emitCriterionUpdated(sessionId, criterionId, status)
  }

  /**
   * Reset all criteria verification attempts.
   */
  resetAllCriteriaAttempts(sessionId: string): void {
    const state = getSessionState(sessionId)
    if (!state) return

    // Reset attempts by re-emitting criteria with cleared attempts
    const resetCriteria = state.criteria.map((c) => ({
      ...c,
      attempts: [],
    }))
    emitCriteriaSet(sessionId, resetCriteria)
  }

  /**
   * Add a criterion attempt.
   */
  addCriterionAttempt(
    sessionId: string,
    criterionId: string,
    attempt: Criterion['attempts'][number]
  ): void {
    const state = getSessionState(sessionId)
    if (!state) return

    const criterion = state.criteria.find((c) => c.id === criterionId)
    if (!criterion) {
      throw new Error(`Criterion not found: ${criterionId}`)
    }

    // Re-emit criteria with new attempt added
    const updatedCriteria = state.criteria.map((c) =>
      c.id === criterionId
        ? { ...c, attempts: [...c.attempts, attempt] }
        : c
    )
    emitCriteriaSet(sessionId, updatedCriteria)
  }

  // ============================================================================
  // Execution State (runtime tracking, not persisted to events)
  // ============================================================================

  /**
   * Record that a file was modified.
   */
  addModifiedFile(sessionId: string, filePath: string): void {
    // In event model, this could be tracked via file.modified events
    // For now, this is a no-op - modifications are tracked per-tool
    logger.debug('addModifiedFile called', { sessionId, filePath })
  }

  /**
   * Add a criterion. Returns the updated criteria list.
   */
  addCriterion(sessionId: string, criterion: Criterion): { criteria: Criterion[]; actualId: string } | { error: string } {
    const state = getSessionState(sessionId)
    if (!state) {
      return { error: 'Session not found' }
    }

    // If ID already exists, generate a unique one
    let actualId = criterion.id
    if (state.criteria.some((c) => c.id === criterion.id)) {
      let suffix = 1
      while (state.criteria.some((c) => c.id === `${criterion.id}-${suffix}`)) {
        suffix++
      }
      actualId = `${criterion.id}-${suffix}`
    }

    const updatedCriteria = [...state.criteria, { ...criterion, id: actualId }]
    emitCriteriaSet(sessionId, updatedCriteria)

    return { criteria: updatedCriteria, actualId }
  }

  /**
   * Update criterion description.
   */
  updateCriterionFull(
    sessionId: string,
    criterionId: string,
    updates: Partial<Pick<Criterion, 'description'>>
  ): Criterion[] {
    const state = getSessionState(sessionId)
    if (!state) {
      throw new Error('Session not found')
    }

    if (!state.criteria.find((c) => c.id === criterionId)) {
      throw new Error(`Criterion not found: ${criterionId}`)
    }

    const updatedCriteria = state.criteria.map((c) =>
      c.id === criterionId ? { ...c, ...updates } : c
    )
    emitCriteriaSet(sessionId, updatedCriteria)

    return updatedCriteria
  }

  /**
   * Remove a criterion.
   */
  removeCriterion(sessionId: string, criterionId: string): Criterion[] {
    const state = getSessionState(sessionId)
    if (!state) {
      throw new Error('Session not found')
    }

    if (!state.criteria.find((c) => c.id === criterionId)) {
      throw new Error(`Criterion not found: ${criterionId}`)
    }

    const updatedCriteria = state.criteria.filter((c) => c.id !== criterionId)
    emitCriteriaSet(sessionId, updatedCriteria)

    return updatedCriteria
  }

  // ============================================================================
  // Message Queue (runtime state, transient while agent is running)
  // ============================================================================

  private messageQueues = new Map<string, QueuedMessage[]>()

  queueMessage(sessionId: string, mode: 'asap' | 'completion', content: string, attachments?: Attachment[]): QueuedMessage {
    const queue = this.messageQueues.get(sessionId) ?? []
    const msg: QueuedMessage = {
      queueId: crypto.randomUUID(),
      mode,
      content,
      ...(attachments ? { attachments } : {}),
      queuedAt: new Date().toISOString(),
    }
    queue.push(msg)
    this.messageQueues.set(sessionId, queue)
    return msg
  }

  cancelQueuedMessage(sessionId: string, queueId: string): boolean {
    const queue = this.messageQueues.get(sessionId)
    if (!queue) return false
    const idx = queue.findIndex(m => m.queueId === queueId)
    if (idx === -1) return false
    queue.splice(idx, 1)
    return true
  }

  drainAsapMessages(sessionId: string): QueuedMessage[] {
    const queue = this.messageQueues.get(sessionId)
    if (!queue) return []
    const asap = queue.filter(m => m.mode === 'asap')
    this.messageQueues.set(sessionId, queue.filter(m => m.mode !== 'asap'))
    return asap
  }

  drainCompletionMessages(sessionId: string): QueuedMessage[] {
    const queue = this.messageQueues.get(sessionId)
    if (!queue) return []
    const completion = queue.filter(m => m.mode === 'completion')
    this.messageQueues.set(sessionId, queue.filter(m => m.mode !== 'completion'))
    return completion
  }

  getQueueState(sessionId: string): QueuedMessage[] {
    return this.messageQueues.get(sessionId) ?? []
  }

  clearMessageQueue(sessionId: string): void {
    this.messageQueues.delete(sessionId)
  }

  // ============================================================================
  // File Tracking (runtime state, stored in memory per session)
  // ============================================================================

  private readFilesCache = new Map<string, Record<string, { hash: string; readAt: string }>>()

  /**
   * Record that a file was read.
   */
  recordFileRead(sessionId: string, filePath: string, contentHash: string): void {
    const cache = this.readFilesCache.get(sessionId) ?? {}
    cache[filePath] = { hash: contentHash, readAt: new Date().toISOString() }
    this.readFilesCache.set(sessionId, cache)
  }

  /**
   * Get read files cache.
   */
  getReadFiles(sessionId: string): Record<string, { hash: string; readAt: string }> {
    return this.readFilesCache.get(sessionId) ?? {}
  }

  /**
   * Update file hash after write.
   */
  updateFileHash(sessionId: string, filePath: string, contentHash: string): void {
    const cache = this.readFilesCache.get(sessionId) ?? {}
    const existingEntry = cache[filePath]
    cache[filePath] = {
      hash: contentHash,
      readAt: existingEntry?.readAt ?? new Date().toISOString(),
    }
    this.readFilesCache.set(sessionId, cache)
  }

  /**
   * Record a tool failure.
   */
  recordToolFailure(sessionId: string, tool: string, reason: string): void {
    // In event model, this could be tracked via events
    // For now, log it
    logger.debug('recordToolFailure called', { sessionId, tool, reason })
  }

  /**
   * Reset tool failures.
   */
  resetToolFailures(sessionId: string): void {
    logger.debug('resetToolFailures called', { sessionId })
  }

  /**
   * Update execution state.
   */
  updateExecutionState(sessionId: string, updates: Record<string, unknown>): void {
    // In event model, execution state is derived from events
    logger.debug('updateExecutionState called', { sessionId, updates })
  }

  /**
   * @deprecated Use addMessage + compactContext instead
   */
  compactMessages(sessionId: string, _messageIds: string[], summary: string): Message {
    // Emit a system message with the compacted summary
    const messageId = emitUserMessage(sessionId, `[COMPACTED HISTORY]\n${summary}`, {
      isSystemGenerated: true,
    })

    return {
      id: messageId,
      role: 'system',
      content: `[COMPACTED HISTORY]\n${summary}`,
      timestamp: new Date().toISOString(),
      isCompacted: true,
    }
  }

  /**
   * @deprecated Use addTokensUsed instead
   */
  incrementTokenCount(sessionId: string, tokens: number): void {
    this.addTokensUsed(sessionId, tokens)
  }

  // ============================================================================
  // Context State
  // ============================================================================

  /**
   * Get the current context state for a session.
   */
  getContextState(sessionId: string): ContextState {
    const state = getSessionState(sessionId)
    if (!state) {
      const config = getRuntimeConfig()
      return {
        currentTokens: 0,
        maxTokens: config.context.maxTokens,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
      }
    }
    return state.contextState
  }

  // ============================================================================
  // LSP Manager
  // ============================================================================

  /**
   * Get the LSP manager for a session.
   */
  getLspManager(sessionId: string): LspManager {
    const session = this.requireSession(sessionId)
    return getOrCreateLspManager(sessionId, session.workdir)
  }

  // ============================================================================
  // Active Session
  // ============================================================================

  setActiveSession(id: string | null): void {
    this.activeSessionId = id
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId
  }

  // ============================================================================
  // Event Subscription
  // ============================================================================

  subscribe(callback: (event: SessionEvent) => void): Unsubscribe {
    return this.events.on('event', callback)
  }

  subscribeToSession(sessionId: string, callback: (event: SessionEvent) => void): Unsubscribe {
    return this.events.on(`session:${sessionId}`, callback)
  }

  private emit(event: SessionEvent): void {
    this.events.emit('event', event)

    if ('sessionId' in event) {
      this.events.emit(`session:${event.sessionId}`, event)
    } else if ('session' in event) {
      this.events.emit(`session:${event.session.id}`, event)
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Build a full Session object from DB session + EventStore state
   */
  private buildSessionFromDb(dbSession: Session): Session {
    const eventState = getSessionState(dbSession.id)

    if (!eventState) {
      // No events yet - return defaults
      return {
        ...dbSession,
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
        messages: [],
        criteria: [],
        contextWindows: [],
        executionState: null,
      }
    }

    // Map SnapshotMessage[] to Message[]
    const messages = eventState.messages.map((m) => {
      const msg: import('../../shared/types.js').Message = {
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: new Date(m.timestamp).toISOString(),
      }
      if (m.thinkingContent !== undefined) msg.thinkingContent = m.thinkingContent
      if (m.toolCalls !== undefined) msg.toolCalls = m.toolCalls
      if (m.segments !== undefined) msg.segments = m.segments
      if (m.stats !== undefined) msg.stats = m.stats
      if (m.partial !== undefined) msg.partial = m.partial
      if (m.isStreaming !== undefined) msg.isStreaming = m.isStreaming
      if (m.subAgentId !== undefined) msg.subAgentId = m.subAgentId
      if (m.subAgentType !== undefined) msg.subAgentType = m.subAgentType
      if (m.isSystemGenerated !== undefined) msg.isSystemGenerated = m.isSystemGenerated
      if (m.messageKind !== undefined) msg.messageKind = m.messageKind
      if (m.contextWindowId !== undefined) msg.contextWindowId = m.contextWindowId
      if (m.isCompactionSummary !== undefined) msg.isCompactionSummary = m.isCompactionSummary
      if (m.promptContext !== undefined) msg.promptContext = m.promptContext
      return msg
    })

    return {
      ...dbSession,
      mode: eventState.mode,
      phase: eventState.phase,
      isRunning: eventState.isRunning,
      messages,
      criteria: eventState.criteria,
      contextWindows: [], // Derived from events, not stored separately
      executionState: null, // No longer using execution state
    }
  }
}

// Singleton for gradual migration
export const sessionManager = new SessionManager()
