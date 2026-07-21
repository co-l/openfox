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
  updateSessionMetadata,
  updateSessionProvider,
  updateSessionDangerLevel,
  updateSessionRunning,
  updateSessionCachedPrompt,
  updateSessionWorkdir,
  updateSessionBranch,
  getSessionCachedPrompt,
  type DangerLevel,
} from '../db/sessions.js'
import { getProject } from '../db/projects.js'
import {
  ensureWorkspace,
  getDefaultBranch,
  resolveAndValidateSourceBranch,
  validateRef,
  getGitBranch,
  getCommitsBehind,
  runGit,
  workspaceExists,
  getWorkspacesDir,
  deleteWorkspace as deleteWorkspaceDir,
  validateWorkspaceName,
} from '../git/workspace.js'
import { resolve } from 'node:path'
import { SessionNotFoundError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { EventEmitter, type Unsubscribe } from '../utils/async.js'
import { getLspManager as getOrCreateLspManager, shutdownLspManager, type LspManager } from '../lsp/index.js'
import { devServerManager } from '../dev-server/manager.js'
import { getEventStore } from '../events/store.js'
import {
  getSessionState,
  emitSessionInitialized,
  emitModeChanged,
  emitPhaseChanged,
  emitRunningChanged,
  emitUserMessage,
  emitAssistantMessageStart,
  emitCriteriaSet,
  emitCriterionUpdated,
  emitMetadataSet,
  emitContextState,
} from '../events/index.js'
import type { Message, CriterionStatus } from '../../shared/types.js'
import { isInDangerZone, canCompact } from '../context/tokenizer.js'

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
  | {
      type: 'metadata_updated'
      sessionId: string
      key: string
      entries: import('../../shared/types.js').MetadataEntry[]
    }
  | { type: 'message_added'; sessionId: string; message: Message }
  | { type: 'queue_added'; sessionId: string; queueId: string; mode: 'asap' | 'completion'; content: string }
  | { type: 'queue_drained'; sessionId: string; queueId: string }
  | { type: 'queue_cancelled'; sessionId: string; queueId: string }

type SessionEvents = {
  event: [SessionEvent]
  [key: `session:${string}`]: [SessionEvent]
  queue: [{ sessionId: string; queueId: string; mode: 'asap' | 'completion'; content: string }]
  turn_done: [{ sessionId: string }]
}

// ============================================================================
// Session Manager
// ============================================================================

export class SessionManager {
  private events = new EventEmitter<SessionEvents>()
  private activeSessionId: string | null = null
  private providerManager: import('../provider-manager.js').ProviderManager
  private dynamicContextChangedStore = new Map<string, boolean>()
  private debugDumpStore = new Map<string, { cachedPrompt: string; cachedTools: string[]; liveTools: string[] }>()
  private warmedUpSessions = new Set<string>()
  private switchLocks = new Map<string, Promise<unknown>>()
  private workspaceCreationLocks = new Map<string, Promise<void>>()

  constructor(providerManager: import('../provider-manager.js').ProviderManager) {
    this.providerManager = providerManager
  }

  getCurrentModelSettings(
    sessionId?: string,
  ): { temperature?: number; topP?: number; topK?: number; maxTokens?: number; supportsVision?: boolean } | undefined {
    let providerId: string | undefined
    let model: string | undefined

    if (sessionId) {
      const session = this.getSession(sessionId)
      if (session?.providerId && session?.providerModel) {
        providerId = session.providerId
        model = session.providerModel
      }
    }

    if (!providerId || !model) {
      model = this.providerManager.getCurrentModel()
      providerId = this.providerManager.getActiveProviderId()
    }

    if (!model || !providerId) return undefined
    return this.providerManager.getModelSettings(providerId, model)
  }

  getCurrentModelContext(): number {
    return this.providerManager.getCurrentModelContext()
  }

  getModelCompactionThreshold(sessionId: string): number | undefined {
    const session = this.getSession(sessionId)
    const providerId = session?.providerId ?? this.providerManager.getActiveProviderId()
    const modelId = session?.providerModel ?? this.providerManager.getCurrentModel()
    if (!providerId || !modelId) return undefined
    return this.providerManager
      .getProviders()
      .find((provider) => provider.id === providerId)
      ?.models.find((model) => model.id === modelId)?.compactionThreshold
  }

  /**
   * Get the effective working directory for a session.
   * Uses workspace path when active, otherwise the project workdir.
   */
  getEffectiveWorkdir(sessionId: string): string {
    const session = this.requireSession(sessionId)
    return session.workspace ?? session.workdir
  }

  /**
   * Return (effectiveWorkdir, actualBranch) for a session.
   */
  async getActualBranchPair(sessionId: string): Promise<{ workdir: string; branch: string | null }> {
    const effectiveWorkdir = this.getEffectiveWorkdir(sessionId)
    const branch = await getGitBranch(effectiveWorkdir)
    return { workdir: effectiveWorkdir, branch }
  }

  /**
   * Check that the session's persisted branch matches the actual branch on disk.
   * If they differ (and persisted branch exists), returns a warning message.
   */
  async checkBranchConsistency(sessionId: string): Promise<string | null> {
    const session = this.getSession(sessionId)
    if (!session?.branch) return null
    const actualBranch = await getGitBranch(session.workspace ?? session.workdir)
    if (actualBranch && actualBranch !== session.branch) {
      return `Branch mismatch: session expects "${session.branch}" but workspace is on "${actualBranch}". The workspace branch was changed externally.`
    }
    return null
  }

  // ============================================================================
  // Session Lifecycle
  // ============================================================================

  /**
   * Create a new session. Emits session.initialized event.
   * Note: maxTokens is no longer stored in the session - it comes from the current model config
   */
  createSession(
    projectId: string,
    title?: string,
    providerId?: string | null,
    providerModel?: string | null,
    workspace?: string,
  ): Session {
    const project = getProject(projectId)
    if (!project) {
      throw new Error(`Project not found: ${projectId}`)
    }

    // Auto-generate title if not provided
    let sessionTitle = title
    if (!sessionTitle) {
      const existingSessions = dbListSessionsByProject(projectId, 1000, 0)
      sessionTitle = `Session ${existingSessions.sessions.length + 1}`
    }

    const effectiveWorkdir = workspace ?? project.workdir

    logger.debug('Creating session', { projectId, workdir: effectiveWorkdir, title: sessionTitle })

    // Create session in DB (minimal: id, projectId, workdir, title, timestamps)
    const dbSession = dbCreateSession(projectId, effectiveWorkdir, sessionTitle, providerId, providerModel, workspace)

    // Emit session.initialized event to EventStore
    // maxTokens is NOT stored here - it comes from providerManager.getCurrentModelContext() at query time
    const contextWindowId = crypto.randomUUID()
    emitSessionInitialized(dbSession.id, projectId, effectiveWorkdir, contextWindowId, sessionTitle)

    // Build full session object
    const session = this.buildSessionFromDb(dbSession)

    // Persist the current branch asynchronously — the session is valid without it,
    // and checkBranchConsistency will work once it's set.
    getGitBranch(effectiveWorkdir)
      .then((branch) => {
        if (branch) {
          updateSessionBranch(session.id, branch)
          // Emit a session update so clients see the branch on freshly created sessions
          const updatedDb = dbGetSession(session.id)
          if (updatedDb) {
            this.emit({ type: 'session_updated', session: this.buildSessionFromDb(updatedDb) })
          }
        }
      })
      .catch((err) => {
        logger.error('Failed to persist initial branch for session', {
          sessionId: session.id,
          error: err instanceof Error ? err.message : String(err),
        })
      })

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
   * List sessions for a project with pagination.
   */
  listSessionsByProject(projectId: string, limit = 20, offset = 0): { sessions: SessionSummary[]; hasMore: boolean } {
    const project = getProject(projectId)
    if (!project) {
      return { sessions: [], hasMore: false }
    }
    return dbListSessionsByProject(projectId, limit, offset)
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

    // Clear message queue to prevent memory leak
    this.messageQueues.delete(id)

    // Clean up warmup state
    this.warmedUpSessions.delete(id)

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

    const result = dbListSessionsByProject(projectId, 10000, 0)

    result.sessions.forEach((session) => {
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
   * Emit session_updated for the given session.
   * Used by REST handlers after updating sibling session branches.
   */
  emitBranchChange(sessionId: string): void {
    const session = this.getSession(sessionId)
    if (session) {
      this.emit({ type: 'session_updated', session })
    }
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
   * Set danger level. Does NOT emit event - danger level is not part of session state.
   * Just updates DB and returns updated session.
   */
  setDangerLevel(sessionId: string, dangerLevel: DangerLevel): Session {
    this.requireSession(sessionId)
    logger.debug('Setting danger level', { sessionId, dangerLevel })
    updateSessionDangerLevel(sessionId, dangerLevel)
    return this.requireSession(sessionId)
  }

  /**
   * Rename session. Updates title in DB and emits session_updated.
   */
  renameSession(sessionId: string, title: string): Session {
    this.requireSession(sessionId)
    logger.debug('Renaming session', { sessionId, title })
    updateSessionMetadata(sessionId, { title })
    const updatedSession = this.requireSession(sessionId)
    this.emit({ type: 'session_updated', session: updatedSession })
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

    updateSessionRunning(sessionId, isRunning)
    emitRunningChanged(sessionId, isRunning)

    const updatedSession = this.requireSession(sessionId)
    this.emit({ type: 'session_updated', session: updatedSession })
    this.emit({ type: 'running_changed', sessionId, isRunning })

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
  addMessage(sessionId: string, message: Omit<Message, 'id' | 'timestamp'>): Message {
    this.requireSession(sessionId)

    const state = getSessionState(sessionId)
    const contextWindowId = message.contextWindowId ?? state?.currentContextWindowId

    // Build options object without undefined values
    const options: {
      contextWindowId?: string
      isSystemGenerated?: boolean
      messageKind?: 'correction' | 'auto-prompt' | 'context-reset' | 'task-completed' | 'workflow-started' | 'command'
      tokenCount?: number
      attachments?: Attachment[] // Optional image attachments
      subAgentId?: string
      subAgentType?: string
      metadata?: { type: string; name: string; color: string; kind?: 'definition' | 'reminder' }
    } = {}
    if (contextWindowId !== undefined) options.contextWindowId = contextWindowId
    if (message.isSystemGenerated !== undefined) options.isSystemGenerated = message.isSystemGenerated
    if (message.messageKind !== undefined) options.messageKind = message.messageKind
    if (message.tokenCount !== undefined) options.tokenCount = message.tokenCount
    if (message.attachments !== undefined) options.attachments = message.attachments
    if (message.subAgentId !== undefined) options.subAgentId = message.subAgentId
    if (message.subAgentType !== undefined) options.subAgentType = message.subAgentType
    if (message.metadata !== undefined) options.metadata = message.metadata

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
    if (message.metadata !== undefined) result.metadata = message.metadata

    // Emit internal event for subscribers
    this.emit({ type: 'message_added', sessionId, message: result })

    return result
  }

  /**
   * Add an assistant message. Delegates to EventStore.
   */
  addAssistantMessage(sessionId: string, message: Omit<Message, 'id' | 'timestamp' | 'role'>): Message {
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
  updateMessageStats(sessionId: string, messageId: string, _stats: Message['stats']): void {
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
    updates: Partial<Omit<Message, 'id' | 'timestamp' | 'role'>>,
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
        return msg
      })
  }

  /**
   * Set current context size (for token tracking).
   * Emits a context.state event with the real promptTokens from the LLM.
   * maxTokens comes from providerManager.getCurrentModelContext() - the currently selected model's limit.
   */
  setCurrentContextSize(sessionId: string, promptTokens: number, subAgentId?: string): void {
    const state = getSessionState(sessionId, this.providerManager.getCurrentModelContext())
    const maxTokens = this.providerManager.getCurrentModelContext()
    const compactionCount = state?.contextState.compactionCount ?? 0
    const dynamicContextChanged = this.getDynamicContextChanged(sessionId)

    emitContextState(
      sessionId,
      promptTokens,
      maxTokens,
      compactionCount,
      isInDangerZone(promptTokens, maxTokens),
      canCompact(promptTokens, maxTokens),
      subAgentId,
      dynamicContextChanged,
    )

    logger.debug('Context state updated', { sessionId, promptTokens, maxTokens, subAgentId })
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
  addCriterionAttempt(sessionId: string, criterionId: string, attempt: Criterion['attempts'][number]): void {
    const state = getSessionState(sessionId)
    if (!state) return

    const criterion = state.criteria.find((c) => c.id === criterionId)
    if (!criterion) {
      throw new Error(`Criterion not found: ${criterionId}`)
    }

    // Re-emit criteria with new attempt added
    const updatedCriteria = state.criteria.map((c) =>
      c.id === criterionId ? { ...c, attempts: [...c.attempts, attempt] } : c,
    )
    emitCriteriaSet(sessionId, updatedCriteria)
  }

  // ============================================================================
  // Execution State (runtime tracking, not persisted to events)
  // ============================================================================

  /**
   * Add a criterion. Returns the updated criteria list.
   */
  addCriterion(
    sessionId: string,
    criterion: Criterion,
  ): { criteria: Criterion[]; actualId: string } | { error: string } {
    const state = getSessionState(sessionId)
    if (!state) {
      return { error: 'Session not found' }
    }

    // Use provided ID if non-empty, otherwise auto-generate sequential ID
    const actualId = criterion.id || state.criteria.length.toString()
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
    updates: Partial<Pick<Criterion, 'description'>>,
  ): Criterion[] {
    const state = getSessionState(sessionId)
    if (!state) {
      throw new Error('Session not found')
    }

    if (!state.criteria.find((c) => c.id === criterionId)) {
      throw new Error(`Criterion not found: ${criterionId}`)
    }

    const updatedCriteria = state.criteria.map((c) => (c.id === criterionId ? { ...c, ...updates } : c))
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
  // Metadata Operations
  // ============================================================================

  setMetadataEntries(sessionId: string, key: string, entries: import('../../shared/types.js').MetadataEntry[]): void {
    this.requireSession(sessionId)
    emitMetadataSet(sessionId, key, entries)
    this.emit({ type: 'metadata_updated', sessionId, key, entries })
  }

  // ============================================================================
  // Message Queue (runtime state, transient while agent is running)
  // ============================================================================

  private messageQueues = new Map<string, QueuedMessage[]>()

  queueMessage(
    sessionId: string,
    mode: 'asap' | 'completion',
    content?: string,
    attachments?: Attachment[],
    messageKind?: string,
  ): QueuedMessage {
    const queue = this.messageQueues.get(sessionId) ?? []
    const msg: QueuedMessage = {
      queueId: crypto.randomUUID(),
      mode,
      content: content ?? '',
      ...(attachments ? { attachments } : {}),
      ...(messageKind ? { messageKind } : {}),
      queuedAt: new Date().toISOString(),
    }
    queue.push(msg)
    this.messageQueues.set(sessionId, queue)
    this.emit({ type: 'queue_added', sessionId, queueId: msg.queueId, mode, content: content ?? '' })
    return msg
  }

  cancelQueuedMessage(sessionId: string, queueId: string): boolean {
    const queue = this.messageQueues.get(sessionId)
    if (!queue) return false
    const idx = queue.findIndex((m) => m.queueId === queueId)
    if (idx === -1) return false
    queue.splice(idx, 1)
    this.emit({ type: 'queue_cancelled', sessionId, queueId })
    return true
  }

  drainAsapMessages(sessionId: string): QueuedMessage[] {
    const queue = this.messageQueues.get(sessionId)
    if (!queue) return []
    const asap = queue.filter((m) => m.mode === 'asap')
    this.messageQueues.set(
      sessionId,
      queue.filter((m) => m.mode !== 'asap'),
    )
    for (const msg of asap) {
      this.emit({ type: 'queue_drained', sessionId, queueId: msg.queueId })
    }
    return asap
  }

  drainCompletionMessages(sessionId: string): QueuedMessage[] {
    const queue = this.messageQueues.get(sessionId)
    if (!queue) return []
    const completion = queue.filter((m) => m.mode === 'completion')
    this.messageQueues.set(
      sessionId,
      queue.filter((m) => m.mode !== 'completion'),
    )
    for (const msg of completion) {
      this.emit({ type: 'queue_drained', sessionId, queueId: msg.queueId })
    }
    return completion
  }

  getQueueState(sessionId: string): QueuedMessage[] {
    return this.messageQueues.get(sessionId) ?? []
  }

  hasQueuedMessages(sessionId: string): boolean {
    const queue = this.messageQueues.get(sessionId)
    return queue !== undefined && queue.length > 0
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

  isWarmedUp(sessionId: string): boolean {
    return this.warmedUpSessions.has(sessionId)
  }

  markWarmedUp(sessionId: string): void {
    this.warmedUpSessions.add(sessionId)
  }

  resetWarmup(sessionId: string): void {
    this.warmedUpSessions.delete(sessionId)
  }

  setCachedPrompt(
    sessionId: string,
    systemPrompt: string,
    tools: import('../llm/types.js').LLMToolDefinition[],
    hash: string,
  ): void {
    updateSessionCachedPrompt(sessionId, systemPrompt, tools, hash)
    this.resetWarmup(sessionId)
  }

  getCachedPrompt(
    sessionId: string,
  ): { systemPrompt: string; tools: import('../llm/types.js').LLMToolDefinition[]; hash: string } | undefined {
    const result = getSessionCachedPrompt(sessionId)
    return result ?? undefined
  }

  setDynamicContextChanged(sessionId: string, changed: boolean): void {
    this.dynamicContextChangedStore.set(sessionId, changed)
  }

  setDebugDump(sessionId: string, dump: { cachedPrompt: string; cachedTools: string[]; liveTools: string[] }): void {
    this.debugDumpStore.set(sessionId, dump)
  }

  clearDebugDump(sessionId: string): void {
    this.debugDumpStore.delete(sessionId)
  }

  getDynamicContextChanged(sessionId: string): boolean {
    return this.dynamicContextChangedStore.get(sessionId) ?? false
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
    const session = this.getSession(sessionId)
    const providerManager = this.providerManager

    // Get maxTokens from session's provider/model if set, otherwise use global
    let maxTokens: number
    if (session?.providerId && session.providerModel) {
      // Session has explicit provider/model - get context from that
      const providers = providerManager.getProviders()
      const provider = providers.find((p) => p.id === session.providerId)
      if (provider) {
        // Try exact match first
        let modelConfig = provider.models.find((m) => m.id === session.providerModel)
        // If not found, try fuzzy match (handle spaces/dashes/underscores variations)
        if (!modelConfig && session.providerModel) {
          const normalize = (s: string) => s.toLowerCase().replace(/[-_\s]+/g, '')
          const sessionModelNormalized = normalize(session.providerModel)
          modelConfig = provider.models.find((m) => {
            const modelIdNormalized = normalize(m.id)
            // Check if normalized IDs match or one contains the other
            return (
              modelIdNormalized === sessionModelNormalized ||
              modelIdNormalized.includes(sessionModelNormalized) ||
              sessionModelNormalized.includes(modelIdNormalized)
            )
          })
        }
        maxTokens = modelConfig?.contextWindow ?? providerManager.getCurrentModelContext()
      } else {
        maxTokens = providerManager.getCurrentModelContext()
      }
    } else {
      // Use global provider/model
      maxTokens = providerManager.getCurrentModelContext()
    }

    const state = getSessionState(sessionId, maxTokens)
    const dynamicContextChanged = this.getDynamicContextChanged(sessionId)
    const debugDump = this.debugDumpStore.get(sessionId)
    if (!state) {
      return {
        currentTokens: 0,
        maxTokens,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged,
        ...(debugDump ? { debugDump } : {}),
      }
    }
    return { ...state.contextState, dynamicContextChanged, ...(debugDump ? { debugDump } : {}) }
  }

  // ============================================================================
  // LSP Manager
  // ============================================================================

  /**
   * Get the LSP manager for a session.
   * Uses workspace path when active, otherwise the project workdir.
   */
  getLspManager(sessionId: string): LspManager {
    const session = this.requireSession(sessionId)
    const effectiveWorkdir = session.workspace ?? session.workdir
    return getOrCreateLspManager(sessionId, effectiveWorkdir)
  }

  private async applyBranchIfNeeded(
    projectDir: string,
    projectName: string,
    workspaceName: string,
    branch: string,
    sourceBranch?: string,
  ): Promise<void> {
    const wsPath = resolve(await getWorkspacesDir(projectName, projectDir), workspaceName)
    const currentBranch = await getGitBranch(wsPath)
    if (currentBranch !== branch) {
      try {
        await validateRef(wsPath, branch)
        await runGit(wsPath, ['checkout', branch]).catch(async () => {
          const sb = sourceBranch ?? (await getDefaultBranch(projectDir))
          const validated = sourceBranch ? await resolveAndValidateSourceBranch(wsPath, sourceBranch, projectDir) : sb
          await runGit(wsPath, ['checkout', '-b', branch, validated])
        })
      } catch (err) {
        throw new Error(
          `Failed to apply branch "${branch}" to workspace "${workspaceName}": ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  // ============================================================================
  // Workspace Lifecycle
  // ============================================================================

  /**
   * Switch to a workspace. Target can be "original" (project root) or a workspace name.
   * If the workspace doesn't exist yet, it's created first.
   * Emits a single type of event — switching is always "opening" a workspace.
   * Switches are serialized per-session to prevent race conditions.
   */
  async switchWorkspace(sessionId: string, target: string, branch?: string, sourceBranch?: string): Promise<Session> {
    if (target !== 'original') validateWorkspaceName(target)

    const existingLock = this.switchLocks.get(sessionId)
    if (existingLock) await existingLock

    const lockPromise = (async () => {
      const session = this.requireSession(sessionId)
      const project = getProject(session.projectId)
      if (!project) throw new Error(`Project not found: ${session.projectId}`)

      const isBranchChangeOnly =
        target !== 'original' && session.workspace?.split('/').pop() === target && branch !== undefined

      if (target === 'original' && !session.workspace && !branch) return session
      if (target !== 'original' && session.workspace?.split('/').pop() === target && !branch) return session
      if (isBranchChangeOnly) {
        const currentBranch = await getGitBranch(session.workspace ?? session.workdir)
        if (currentBranch === branch) return session
      }

      const previousPath = session.workspace

      if (previousPath && !isBranchChangeOnly) {
        const otherSessionsUsingPath = this.listSessions().filter(
          (s) => s.id !== sessionId && s.workspace === previousPath,
        )
        if (otherSessionsUsingPath.length === 0) {
          try {
            await devServerManager.stop(previousPath)
          } catch (err) {
            logger.error('Error stopping dev server for workspace switch', {
              sessionId,
              workspace: previousPath,
              error: err,
            })
          }
        } else {
          logger.info('Skipping dev server stop — other sessions still use path', {
            path: previousPath,
            otherSessions: otherSessionsUsingPath.map((s) => s.id),
          })
        }
      }

      if (target === 'original') {
        updateSessionWorkdir(sessionId, project.workdir, null)
      } else if (!isBranchChangeOnly) {
        const createLockKey = `${project.name}:${target}`
        const existingCreateLock = this.workspaceCreationLocks.get(createLockKey)
        if (existingCreateLock) await existingCreateLock

        const createLockPromise = (async () => {
          const exists = await workspaceExists(project.name, target, project.workdir)
          if (!exists) {
            await ensureWorkspace(project.workdir, target, project.name, branch, sourceBranch)
          } else if (branch) {
            await this.applyBranchIfNeeded(project.workdir, project.name, target, branch, sourceBranch)
          }
        })()
        this.workspaceCreationLocks.set(createLockKey, createLockPromise)
        try {
          await createLockPromise
        } finally {
          this.workspaceCreationLocks.delete(createLockKey)
        }
        const wsDir = await getWorkspacesDir(project.name, project.workdir)
        const wsPath = resolve(wsDir, target)
        updateSessionWorkdir(sessionId, project.workdir, wsPath)
      } else {
        // Branch-only change on the current workspace — no dev server stop or db update
        await this.applyBranchIfNeeded(project.workdir, project.name, target, branch!, sourceBranch)
      }

      try {
        await shutdownLspManager(sessionId)
      } catch (err) {
        logger.error('Error shutting down LSP for workspace switch', { sessionId, error: err })
      }

      // Read the actual branch we're now on
      const wsDirForBranch = await getWorkspacesDir(project.name, project.workdir)
      const effectiveWorkdir = target === 'original' ? project.workdir : resolve(wsDirForBranch, target)
      const actualBranch = await getGitBranch(effectiveWorkdir)

      if (actualBranch) {
        updateSessionBranch(sessionId, actualBranch)
        // Sync the branch for all other sessions that share this workspace,
        // so checkBranchConsistency works for them too
        const otherSessionsOnWorkspace = this.listSessions().filter(
          (s) => s.id !== sessionId && s.workspace === effectiveWorkdir,
        )
        for (const other of otherSessionsOnWorkspace) {
          updateSessionBranch(other.id, actualBranch)
          const updated = this.getSession(other.id)
          if (updated) this.emit({ type: 'session_updated', session: updated })
        }
      }

      let stalenessHint = ''
      if (target !== 'original' && actualBranch) {
        await runGit(effectiveWorkdir, ['fetch', 'origin', '--no-tags', '--quiet']).catch(() => {})
        const behind = await getCommitsBehind(effectiveWorkdir, actualBranch)
        if (behind !== null && behind > 0) {
          const plural = behind === 1 ? '' : 's'
          stalenessHint = `\n(${behind} commit${plural} behind ${actualBranch} on main workspace — run \`git pull\` to sync)`
        }
      }

      const wsLabel = target === 'original' ? 'original' : target
      const reminderContent = `<system-reminder>\nThis session is now operating in workspace "${wsLabel}" on branch "${actualBranch ?? 'unknown'}" at ${effectiveWorkdir}.${stalenessHint}\nAll file and git operations should use this directory.\n</system-reminder>`
      this.addMessage(sessionId, {
        role: 'user',
        content: reminderContent,
        isSystemGenerated: true,
        messageKind: 'auto-prompt',
        metadata: {
          type: 'workspace',
          name: 'Workspace',
          color: '#22c55e',
          kind: 'definition',
          workspaceName: wsLabel,
          ...(actualBranch ? { branchName: actualBranch } : {}),
        },
      })

      const updated = this.requireSession(sessionId)
      this.emit({ type: 'session_updated', session: updated })
      return updated
    })()

    this.switchLocks.set(sessionId, lockPromise)
    lockPromise.finally(() => {
      if (this.switchLocks.get(sessionId) === lockPromise) this.switchLocks.delete(sessionId)
    })

    return lockPromise
  }

  /**
   * Delete a workspace by name. If the session is currently in that workspace,
   * switches to original first. Throws if target is "original".
   * Refuses deletion if other sessions reference this workspace.
   */
  async deleteWorkspace(sessionId: string, target: string): Promise<Session> {
    if (target === 'original') throw new Error('Cannot delete the original workspace')
    validateWorkspaceName(target)

    const session = this.requireSession(sessionId)
    const project = getProject(session.projectId)
    if (!project) throw new Error(`Project not found: ${session.projectId}`)

    // Check if other sessions reference this workspace
    const otherSessionsUsingIt = this.listSessions().filter(
      (s) => s.id !== sessionId && s.workspace?.split('/').pop() === target,
    )
    if (otherSessionsUsingIt.length > 0) {
      const otherIds = otherSessionsUsingIt.map((s) => s.id).join(', ')
      throw new Error(
        `Workspace "${target}" is in use by other session(s): ${otherIds}. Switch them to original first.`,
      )
    }

    // If currently in the workspace being deleted, switch to original first
    const currentWsName = session.workspace?.split('/').pop()
    if (currentWsName === target) {
      await this.switchWorkspace(sessionId, 'original')
    }

    const wsDir = await getWorkspacesDir(project.name, project.workdir)
    const effectivePath = resolve(wsDir, target)
    try {
      await devServerManager.stop(effectivePath)
    } catch {
      // ignore
    }

    await deleteWorkspaceDir(project.name, target, project.workdir)
    const updated = this.requireSession(sessionId)
    this.emit({ type: 'session_updated', session: updated })
    return updated
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
    const maxTokens = this.providerManager.getCurrentModelContext()
    const eventState = getSessionState(dbSession.id, maxTokens)

    if (!eventState) {
      // No events yet - return defaults from DB
      return {
        ...dbSession,
        mode: 'planner',
        phase: 'plan',
        isRunning: dbSession.isRunning,
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
      return msg
    })

    // Use database is_running as source of truth (more reliable than EventStore which may have missing events)
    const isRunning = dbSession.isRunning

    const cachedPrompt = getSessionCachedPrompt(dbSession.id)

    return {
      ...dbSession,
      mode: eventState.mode,
      phase: eventState.phase,
      isRunning,
      messages,
      criteria: eventState.criteria,
      metadataEntries: eventState.metadataEntries,
      contextWindows: [], // Derived from events, not stored separately
      executionState:
        eventState.cachedSystemPrompt || cachedPrompt
          ? {
              iteration: 0,
              readFiles: {},
              consecutiveFailures: 0,
              currentTokenCount: 0,
              messageCountAtLastUpdate: messages.length,
              compactionCount: 0,
              startedAt: new Date().toISOString(),
              lastActivityAt: new Date().toISOString(),
              ...(cachedPrompt?.systemPrompt ? { cachedSystemPrompt: cachedPrompt.systemPrompt } : {}),
              ...(eventState.cachedSystemPrompt && !cachedPrompt?.systemPrompt
                ? { cachedSystemPrompt: eventState.cachedSystemPrompt }
                : {}),
              ...(cachedPrompt?.hash ? { dynamicContextHash: cachedPrompt.hash } : {}),
              ...(eventState.dynamicContextHash && !cachedPrompt?.hash
                ? { dynamicContextHash: eventState.dynamicContextHash }
                : {}),
            }
          : null,
    }
  }
}
