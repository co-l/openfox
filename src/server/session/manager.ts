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
  listSessionsLimited as dbListSessionsLimited,
  listHomeSessions as dbListHomeSessions,
  deleteSession as dbDeleteSession,
  updateSessionMetadata,
  updateSessionProvider,
  updateSessionProviderActive,
  updateSessionPinnedEffort,
  updateSessionDangerLevel,
  updateSessionRunning,
  updateSessionCachedPrompt,
  updateSessionWorkdir,
  updateSessionBranch,
  updateSessionMessageCount,
  setSessionMessageCount,
  getSessionCachedPrompt,
  createWorkflowExecution,
  updateWorkflowExecutionStatus,
  getActiveWorkflowExecution as dbGetActiveWorkflowExecution,
  getLatestWorkflowExecution as dbGetLatestWorkflowExecution,
  clearWorkflowExecution,
  type DangerLevel,
} from '../db/sessions.js'
import { getProject } from '../db/projects.js'
import {
  ensureWorkspace,
  resolveAndValidateSourceBranch,
  validateRef,
  getGitBranch,
  getCommitsBehind,
  runGit,
  workspaceExists,
  getWorkspacesDir,
  checkoutBranchFromSharedSource,
  deleteWorkspace as deleteWorkspaceDir,
  validateWorkspaceName,
} from '../git/workspace.js'
import { resolve } from 'node:path'
import { SessionNotFoundError, WorkspaceInUseError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { EventEmitter, type Unsubscribe } from '../utils/async.js'
import { getLspManager as getOrCreateLspManager, shutdownLspManager, type LspManager } from '../lsp/index.js'
import { devServerManager } from '../dev-server/manager.js'
import { resolveLLMClientForAgent, getAgentModelOverride } from '../agents/model-overrides.js'
import { parseDefaultModelSelection } from '../provider-manager.js'
import { getEventStore } from '../events/store.js'
import {
  getSessionState,
  emitSessionInitialized,
  emitModeChanged,
  emitPhaseChanged,
  emitRunningChanged,
  emitWorkflowExecutionChanged,
  emitUserMessage,
  emitAssistantMessageStart,
  emitCriteriaSet,
  emitCriterionUpdated,
  emitMetadataSet,
  emitContextState,
  getCurrentContextWindowId,
} from '../events/index.js'
import type { Message, CriterionStatus } from '../../shared/types.js'
import { isInDangerZone, canCompact } from '../context/tokenizer.js'
import { serverT } from '../i18n.js'

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

// A workspace's origin is the original local repo (a --shared clone). Pushing a
// branch the original repo has checked out is refused (receive.denyCurrentBranch),
// so the recipe always lands on a temporary branch — unconditional and
// deterministic. After the work is merged back into the original repo the
// workspace is deleted (it can be recreated at any time), then the remote is
// reached from the original repo.
const WORKSPACE_COMMIT_RECIPE = `
To land changes from this workspace when the user asks to commit and push:
1. Commit your work.
2. Push to the original repo on a temporary branch (its origin is the local repo itself): \`git push origin HEAD:<feature-slug>\`
3. Switch back to the original project: \`workspace switch original\`
4. Merge the temporary branch and delete it: \`git merge --ff-only <feature-slug> && git branch -d <feature-slug>\`
5. Verify the work is present in the original repo.
6. Delete the workspace — it can be recreated at any time: \`workspace delete <name> force=true\`
7. Push to the remote from the original repo: \`git push origin <branch>\``

// ============================================================================
// Session Manager
// ============================================================================

export class SessionManager {
  private events = new EventEmitter<SessionEvents>()
  private activeSessionId: string | null = null
  private providerManager: import('../provider-manager.js').ProviderManager
  private dynamicContextChangedStore = new Map<string, boolean>()
  private debugDumpStore = new Map<string, { cachedPrompt: string; cachedTools: string[]; liveTools: string[] }>()
  private announcedPromptHashStore = new Map<string, string>()
  private announcedToolFingerprintStore = new Map<string, string>()
  private warmedUpSessions = new Set<string>()
  // Sessions already warned about an unresolvable provider — getContextState runs on every
  // turn, and the warning is only worth one line per session.
  private unknownProviderWarned = new Set<string>()
  private switchLocks = new Map<string, Promise<unknown>>()
  private workspaceCreationLocks = new Map<string, Promise<void>>()

  constructor(providerManager: import('../provider-manager.js').ProviderManager) {
    this.providerManager = providerManager
  }

  getProviderManager(): import('../provider-manager.js').ProviderManager {
    return this.providerManager
  }

  /**
   * Create an LLM client for a specific agent, respecting its model override.
   *
   * If the agent has a model override stored in settings, creates a dedicated
   * client for that provider+model. Falls back to the global client if no
   * override is set or the provider no longer exists.
   *
   * A session-pinned effort ("Keep current reasoning effort") wins over the
   * override's own effort, mirroring resolveEffectiveProviderModel.
   *
   * @param preferredFallback - When provided, used as fallback instead of
   *   providerManager.getLLMClient(). This is important in mock/test mode
   *   where the caller already has a mock client that should be preserved.
   */
  createClientForAgent(
    sessionId: string,
    agentId: string,
    preferredFallback?: import('../llm/client.js').LLMClientWithModel,
  ): import('../llm/client.js').LLMClientWithModel {
    const fallback = preferredFallback ?? this.providerManager.getLLMClient()
    const pinnedEffort = dbGetSession(sessionId)?.providerPinnedEffort ?? undefined
    const resolved = resolveLLMClientForAgent(agentId, fallback, this.providerManager, pinnedEffort)
    if (resolved.warning) {
      logger.warn('Agent model override unavailable, falling back', {
        agentId,
        warning: resolved.warning,
      })
    }
    return resolved.client
  }

  /**
   * Resolve the effective provider/model for a session.
   *
   * Precedence: agent model override > session preference > global default.
   * The session preference is the user's sticky manual pick (written only by an
   * explicit pick) — agent overrides and the effective model are never written
   * into it. The global default comes from config (pure), never from the provider
   * manager's active state, so a stale override never lingers.
   *
   * The reasoning effort follows the same source: the agent override's effort,
   * the session pick's effort, or undefined (falls back to the model default).
   * A session-pinned effort ("Keep current reasoning effort" on an agent/workflow
   * switch) overrides the effort of agent overrides and session-stored values
   * WITHOUT replacing the provider/model.
   *
   * When `agentId` is omitted, the current session mode's agent override applies.
   */
  resolveEffectiveProviderModel(
    sessionId: string,
    agentId?: string,
  ): { providerId: string | null; model: string | null; reasoningEffort?: string } {
    const dbSession = dbGetSession(sessionId)
    const pinnedEffort = dbSession?.providerPinnedEffort ?? undefined
    // An explicit manual pick that is currently ACTIVE wins over any agent
    // override. Selecting an override agent deactivates it (the agent's override
    // is the label truth); a fresh pick or a non-override agent reactivates it.
    // An active pin ("Keep current reasoning effort") is the most recent explicit
    // intent and wins even over the manual pick.
    if (
      dbSession?.providerManual &&
      dbSession?.providerManualActive &&
      dbSession.providerId &&
      dbSession.providerModel
    ) {
      const effort = pinnedEffort ?? dbSession.providerReasoningEffort
      return {
        providerId: dbSession.providerId,
        model: dbSession.providerModel,
        ...(effort ? { reasoningEffort: effort } : {}),
      }
    }
    const mode = agentId ?? dbSession?.mode ?? undefined
    const override = mode ? getAgentModelOverride(mode) : undefined
    if (override) {
      const effort = pinnedEffort ?? override.reasoningEffort
      return {
        providerId: override.providerId,
        model: override.model,
        ...(effort ? { reasoningEffort: effort } : {}),
      }
    }
    if (dbSession?.providerId && dbSession?.providerModel) {
      const effort = pinnedEffort ?? dbSession.providerReasoningEffort
      return {
        providerId: dbSession.providerId,
        model: dbSession.providerModel,
        ...(effort ? { reasoningEffort: effort } : {}),
      }
    }
    const { providerId, model } = parseDefaultModelSelection(this.providerManager.getDefaultModelSelection())
    if (providerId && model) {
      return {
        providerId,
        model,
        ...(pinnedEffort ? { reasoningEffort: pinnedEffort } : {}),
      }
    }
    return { providerId: null, model: null }
  }

  getCurrentModelSettings(
    sessionId?: string,
    agentId?: string,
  ): { temperature?: number; topP?: number; topK?: number; maxTokens?: number; supportsVision?: boolean } | undefined {
    let providerId: string | undefined
    let model: string | undefined
    let reasoningEffort: string | undefined

    if (sessionId) {
      const effective = this.resolveEffectiveProviderModel(sessionId, agentId)
      providerId = effective.providerId ?? undefined
      model = effective.model ?? undefined
      reasoningEffort = effective.reasoningEffort
    }

    if (!providerId || !model) {
      model = this.providerManager.getCurrentModel()
      providerId = this.providerManager.getActiveProviderId()
    }

    if (!model || !providerId) return undefined

    // The thinking mode must mirror the effort actually sent to the provider:
    // "none" turns thinking off (chat_template_kwargs enable_thinking=false),
    // anything else keeps it on. Without an explicit effort the model's
    // configured default (thinkingLevel) decides — forcing thinking on for a
    // model whose default is off makes Qwen3-style models burn their output
    // budget on reasoning and return empty/garbled responses.
    const effort = this.providerManager.resolveModelEffort(providerId, model, reasoningEffort)
    const mode = effort === 'none' ? 'non-thinking' : 'thinking'
    return this.providerManager.getModelSettings(providerId, model, mode)
  }

  getCurrentModelContext(sessionId?: string, agentId?: string): number {
    if (sessionId) {
      const { providerId, model } = this.resolveEffectiveProviderModel(sessionId, agentId)
      const sessionContext = this.resolveModelContext(providerId, model)
      if (sessionContext !== undefined) return sessionContext
    }
    return this.providerManager.getCurrentModelContext()
  }

  /**
   * Resolve the context window for a session's own provider/model, if set.
   * Exact match first, then fuzzy match (spaces/dashes/underscores variations).
   * Returns undefined when the session has no model or no matching config —
   * callers fall back to the global default context.
   */
  private resolveModelContext(
    providerId: string | null | undefined,
    providerModel: string | null | undefined,
  ): number | undefined {
    if (!providerId || !providerModel) return undefined

    const provider = this.providerManager.getProviders().find((p) => p.id === providerId)
    if (!provider) return undefined

    let modelConfig = provider.models.find((m) => m.id === providerModel)
    if (!modelConfig) {
      const normalize = (s: string) => s.toLowerCase().replace(/[-_\s]+/g, '')
      const sessionModelNormalized = normalize(providerModel)
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
    return modelConfig?.contextWindow
  }

  getModelCompactionThreshold(sessionId: string, agentId?: string): number | undefined {
    const { providerId, model } = this.resolveEffectiveProviderModel(sessionId, agentId)
    if (!providerId || !model) return undefined
    return this.providerManager
      .getProviders()
      .find((provider) => provider.id === providerId)
      ?.models.find((modelConfig) => modelConfig.id === model)?.compactionThreshold
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
   * Get the project root working directory for a session.
   * Ignores any active workspace — session.workdir is always the project root,
   * which is where project-scoped .openfox/ content (agents, skills, commands,
   * workflows) lives and is managed from.
   */
  getProjectWorkdir(sessionId: string): string {
    const session = this.requireSession(sessionId)
    return session.workdir
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

    // Persist the current branch asynchronously — the session is valid without it.
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
   * Fork a session from a specific message.
   * Creates a new session with all messages up to (and including) the target message,
   * preserving the conversation history. Copies the cached system prompt to avoid
   * recomputation and marks the new session as warmed up for KV cache benefits.
   *
   * @param originalSessionId - Source session ID
   * @param messageId - Target message ID to fork at
   * @param title - Optional title for the new session (default: "Fork of <original title>")
   * @returns The new session
   * @throws Error if the original session or message is not found
   */
  forkSession(originalSessionId: string, messageId: string, title?: string): Session {
    const originalSession = this.requireSession(originalSessionId)

    const projectId = originalSession.projectId
    const effectiveTitle = title ?? `Fork of ${originalSession.metadata?.title ?? 'Untitled'}`

    const state = getSessionState(originalSessionId)
    if (!state) throw new Error(`Session ${originalSessionId} has no state`)

    const msgIndex = state.messages.findIndex((m) => m.id === messageId)
    if (msgIndex === -1) throw new Error(`Message ${messageId} not found`)

    const newSession = this.createSession(
      projectId,
      effectiveTitle,
      originalSession.providerId,
      originalSession.providerModel,
      originalSession.workspace,
    )
    const newWindowId = getCurrentContextWindowId(newSession.id) ?? crypto.randomUUID()

    const messages = state.messages.slice(0, msgIndex + 1)

    const snapshot: import('../events/types.js').SessionSnapshot = {
      mode: state.mode,
      phase: state.phase,
      isRunning: false,
      messages: messages.map((m) => ({
        ...m,
        timestamp: typeof m.timestamp === 'string' ? new Date(m.timestamp).getTime() : m.timestamp,
        contextWindowId: newWindowId,
      })),
      criteria: state.criteria,
      metadataEntries: state.metadataEntries,
      contextState: {
        currentTokens: 0,
        maxTokens: state.contextState.maxTokens,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      },
      currentContextWindowId: newWindowId,
      todos: state.todos,
      readFiles: state.readFiles,
      snapshotSeq: 0,
      snapshotAt: Date.now(),
      sessionInit: {
        projectId: originalSession.projectId,
        workdir: originalSession.workdir,
        contextWindowId: newWindowId,
      },
    }

    const eventStore = getEventStore()
    eventStore.append(newSession.id, { type: 'turn.snapshot', data: snapshot })
    updateSessionMessageCount(newSession.id, messages.length)

    const cached = getSessionCachedPrompt(originalSessionId)
    if (cached) {
      updateSessionCachedPrompt(newSession.id, cached.systemPrompt, cached.tools, cached.hash, cached.promptHash)
      this.markWarmedUp(newSession.id)
    }

    this.emit({ type: 'session_updated', session: this.requireSession(newSession.id) })

    return this.requireSession(newSession.id)
  }

  /**
   * Import a session from an export document into a target project.
   *
   * The cached layout (system prompt, tools, hash) is restored verbatim so the
   * provider-side prefix cache stays valid, and the event history is replayed
   * as-is. Drift between the original environment's cached layout and the
   * target environment (system prompt, tools) is announced via injected
   * <system-reminder> messages, followed by an import marker reminder.
   *
   * @param projectId - Target project (the session is created there)
   * @param rawPayload - Exported session document (validated)
   * @returns The imported session
   * @throws Error for invalid payloads or unknown project
   */
  async importSession(projectId: string, rawPayload: unknown): Promise<Session> {
    const { parseSessionExport, IMPORTED_SESSION_REMINDER, SESSION_EXPORT_VERSION } = await import('./export-import.js')
    const { injectContextDriftReminders, getToolSetFingerprint } = await import('../chat/dynamic-context.js')
    const { loadAllAgentsDefault, resolveDefaultAgentId } = await import('../agents/registry.js')

    const payload = parseSessionExport(rawPayload)
    if (payload.version !== SESSION_EXPORT_VERSION) {
      throw new Error(`Unsupported session export version: ${payload.version}`)
    }

    const project = getProject(projectId)
    if (!project) {
      throw new Error(`Project not found: ${projectId}`)
    }

    if (!payload.events.some((event) => event.type === 'session.initialized')) {
      throw new Error('Invalid session export: missing session.initialized event')
    }

    // Provider resolution: keep the exported sticky pick when the provider
    // exists in the target environment. When it does not, match by backend +
    // base URL so the same inference server is reused even under a different
    // provider label (team scenario). Only when neither matches do we fall
    // back to the environment defaults.
    const providers = this.providerManager.getProviders()
    const providerId = payload.session.providerId ?? null
    const providerModel = payload.session.providerModel ?? null
    let resolvedProviderId: string | null = null
    let resolvedProviderModel: string | null = null
    if (providerId && providers.some((p) => p.id === providerId)) {
      resolvedProviderId = providerId
      resolvedProviderModel = providerModel
    } else if (providerId && payload.source?.providerBackend && payload.source.providerUrl) {
      const normalizeUrl = (url: string) => url.replace(/\/+$/, '')
      const sourceBackend = payload.source.providerBackend
      const sourceUrl = normalizeUrl(payload.source.providerUrl)
      const urlMatch = providers.find(
        (p) =>
          p.backend === sourceBackend &&
          p.url !== undefined &&
          normalizeUrl(p.url) === sourceUrl &&
          providerModel !== null &&
          p.models.some((m) => m.id === providerModel || m.apiModelId === providerModel),
      )
      if (urlMatch) {
        resolvedProviderId = urlMatch.id
        resolvedProviderModel = providerModel
      }
    }

    const session = dbCreateSession(
      projectId,
      project.workdir,
      payload.session.title,
      resolvedProviderId,
      resolvedProviderModel,
    )

    const eventStore = getEventStore()
    eventStore.importEvents(session.id, payload.events as unknown as import('../events/types.js').StoredEvent[])

    // Mode fallback: the restored source mode is only kept when the agent
    // exists in the target environment; otherwise fall back to the project's
    // default agent.
    const agents = await loadAllAgentsDefault(project.workdir)
    const restoredMode = getSessionState(session.id)?.mode ?? session.mode
    if (!agents.some((agent) => agent.metadata.id === restoredMode)) {
      this.setMode(session.id, resolveDefaultAgentId(projectId))
    }

    if (payload.cachedLayout) {
      updateSessionCachedPrompt(
        session.id,
        payload.cachedLayout.systemPrompt,
        payload.cachedLayout.tools,
        payload.cachedLayout.hash,
        payload.cachedLayout.promptHash,
      )
      this.setAnnouncedPromptHash(session.id, payload.cachedLayout.promptHash ?? payload.cachedLayout.hash)
      this.setAnnouncedToolFingerprint(session.id, getToolSetFingerprint(payload.cachedLayout.tools))
      // The imported prefix is a known-good cache prefix — mark the session
      // warmed up so it behaves like a forked session.
      this.markWarmedUp(session.id)
    }

    // Announce any drift between the original environment's cached layout and
    // the target environment (system prompt, tools) exactly once.
    await injectContextDriftReminders(this, session.id)

    // Import marker: the latest system reminders are authoritative.
    emitUserMessage(session.id, IMPORTED_SESSION_REMINDER, {
      isSystemGenerated: true,
      messageKind: 'auto-prompt',
      metadata: { type: 'session-import', name: 'Session Imported', color: '#6b7280', kind: 'reminder' },
    })

    const state = getSessionState(session.id)
    if (state) {
      setSessionMessageCount(session.id, state.messages.length)
    }

    this.emit({ type: 'session_created', session: this.requireSession(session.id) })

    return this.requireSession(session.id)
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
   * Lightweight homepage list: the N most recently updated sessions per
   * project, summaries only (no prompt extraction, no snapshot parsing).
   */
  listHomeSessions(sessionsPerProject = 5): SessionSummary[] {
    return dbListHomeSessions(sessionsPerProject)
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
   * Most recently updated sessions across all projects, bounded with
   * pagination. Used by the legacy global list refresh when a limit is
   * explicitly requested (the homepage itself uses listHomeSessions).
   */
  listSessionsLimited(limit = 20, offset = 0): { sessions: SessionSummary[]; hasMore: boolean } {
    return dbListSessionsLimited(limit, offset)
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
    this.announcedPromptHashStore.delete(id)
    this.announcedToolFingerprintStore.delete(id)
    this.unknownProviderWarned.delete(id)

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

    // The agent's override is the label truth: selecting an agent with an
    // override deactivates the manual pick (so the override wins); selecting a
    // non-override agent reactivates it. The preference itself is never touched.
    this.setSessionProviderActive(sessionId, !getAgentModelOverride(toMode))

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
  setSessionProvider(
    sessionId: string,
    providerId: string | null,
    providerModel: string | null,
    providerManual?: boolean,
    reasoningEffort?: string | null,
  ): Session {
    logger.debug('Setting session provider', { sessionId, providerId, providerModel, reasoningEffort })

    updateSessionProvider(sessionId, providerId, providerModel, providerManual, reasoningEffort)
    // A fresh manual pick (or a reset) supersedes any pinned effort.
    if (providerId === null || providerManual === true) {
      this.clearSessionPinnedEffort(sessionId)
    }
    // The pin changed, so a later unresolvable one is worth warning about again.
    this.unknownProviderWarned.delete(sessionId)

    const updatedSession = this.requireSession(sessionId)
    this.emit({ type: 'session_updated', session: updatedSession })

    return updatedSession
  }

  /**
   * Pin a reasoning effort for the session ("Keep current reasoning effort" on an
   * agent/workflow switch). Overrides agent override efforts without touching the
   * provider/model resolution. Passing null clears the pin.
   */
  setSessionPinnedEffort(sessionId: string, effort: string | null): Session {
    logger.debug('Setting session pinned effort', { sessionId, effort })

    updateSessionPinnedEffort(sessionId, effort)

    const updatedSession = this.requireSession(sessionId)
    this.emit({ type: 'session_updated', session: updatedSession })

    return updatedSession
  }

  clearSessionPinnedEffort(sessionId: string): void {
    updateSessionPinnedEffort(sessionId, null)
  }

  /**
   * Toggle whether the manual pick is currently active (does NOT emit — used as
   * part of larger operations such as mode switches, which emit their own event).
   * Selecting an agent with a model override deactivates the manual pick so the
   * agent's override (its label) wins; a fresh pick or a non-override agent
   * reactivates it.
   */
  setSessionProviderActive(sessionId: string, active: boolean): void {
    logger.debug('Setting session provider manual-active', { sessionId, active })
    updateSessionProviderActive(sessionId, active)
  }

  // ============================================================================
  // Workflow Execution
  // ============================================================================

  /**
   * Start a new workflow execution. Cancels any existing active execution first,
   * then inserts a new row and emits events.
   */
  startWorkflow(
    sessionId: string,
    executionId: string,
    workflowId: string,
    workflowName: string,
    workflowColor: string | undefined,
    params: Record<string, string>,
    subGroup?: string,
  ): void {
    // Cancel any existing active workflow execution before starting a new one
    const existing = this.getActiveWorkflowExecution(sessionId)
    if (existing) {
      this.cancelWorkflow(sessionId, existing.id, existing.workflowId, existing.workflowName, existing.workflowColor)
    }

    createWorkflowExecution(executionId, sessionId, workflowId, workflowName, workflowColor, params, subGroup)
    emitWorkflowExecutionChanged(sessionId, executionId, workflowId, workflowName, workflowColor, 'running')
    const updatedSession = this.requireSession(sessionId)
    this.emit({ type: 'session_updated', session: updatedSession })
  }

  /**
   * Update the current step of a running workflow execution.
   */
  updateWorkflowStep(
    sessionId: string,
    executionId: string,
    stepId: string,
    stepName: string,
    workflowId: string,
    workflowName: string,
    workflowColor: string | undefined,
  ): void {
    updateWorkflowExecutionStatus(executionId, 'running', stepId, stepName)
    emitWorkflowExecutionChanged(
      sessionId,
      executionId,
      workflowId,
      workflowName,
      workflowColor,
      'running',
      stepId,
      stepName,
    )
    const updatedSession = this.requireSession(sessionId)
    this.emit({ type: 'session_updated', session: updatedSession })
  }

  /**
   * Pause at a user step. Sets status to 'waiting' and records step output.
   */
  waitAtStep(
    sessionId: string,
    executionId: string,
    stepId: string,
    stepName: string,
    stepOutput: Record<string, string>,
    workflowId: string,
    workflowName: string,
    workflowColor: string | undefined,
    pendingChoices?: import('../../shared/types.js').UserStepChoice[],
  ): void {
    updateWorkflowExecutionStatus(executionId, 'waiting', stepId, stepName, stepOutput, pendingChoices)
    emitWorkflowExecutionChanged(
      sessionId,
      executionId,
      workflowId,
      workflowName,
      workflowColor,
      'waiting',
      stepId,
      stepName,
      pendingChoices,
    )
    this.setPhase(sessionId, 'waiting')
    const updatedSession = this.requireSession(sessionId)
    this.emit({ type: 'session_updated', session: updatedSession })
  }

  /**
   * Resume a paused (waiting) or blocked workflow execution. Flips it back to
   * 'running' and returns the saved params and step output.
   */
  resumeWorkflow(
    sessionId: string,
    executionId: string,
    workflowId: string,
    workflowName: string,
    workflowColor: string | undefined,
  ): { params: Record<string, string>; stepOutput: Record<string, string> } | null {
    const row = dbGetLatestWorkflowExecution(sessionId)
    if (!row || row.id !== executionId) return null
    if (row.status !== 'waiting' && row.status !== 'blocked') return null
    // Clear pending choices — they only apply to the paused step being resumed
    updateWorkflowExecutionStatus(executionId, 'running', undefined, undefined, undefined, [])
    emitWorkflowExecutionChanged(
      sessionId,
      executionId,
      workflowId,
      workflowName,
      workflowColor,
      'running',
      row.current_step_id ?? undefined,
      row.current_step_name ?? undefined,
      [],
    )
    const updatedSession = this.requireSession(sessionId)
    this.emit({ type: 'session_updated', session: updatedSession })
    return {
      params: JSON.parse(row.params ?? '{}') as Record<string, string>,
      stepOutput: JSON.parse(row.step_output ?? '{}') as Record<string, string>,
    }
  }

  /**
   * Mark workflow as completed and clean up.
   */
  completeWorkflow(
    sessionId: string,
    executionId: string,
    workflowId: string,
    workflowName: string,
    workflowColor: string | undefined,
  ): void {
    updateWorkflowExecutionStatus(executionId, 'completed', undefined, undefined, undefined, [])
    clearWorkflowExecution(executionId)
    emitWorkflowExecutionChanged(
      sessionId,
      executionId,
      workflowId,
      workflowName,
      workflowColor,
      'completed',
      undefined,
      undefined,
      [],
    )
    this.setPhase(sessionId, 'done')
    const updatedSession = this.requireSession(sessionId)
    this.emit({ type: 'session_updated', session: updatedSession })
  }

  /**
   * Cancel/exit a workflow execution.
   */
  cancelWorkflow(
    sessionId: string,
    executionId: string,
    workflowId: string,
    workflowName: string,
    workflowColor: string | undefined,
  ): void {
    updateWorkflowExecutionStatus(executionId, 'cancelled', undefined, undefined, undefined, [])
    clearWorkflowExecution(executionId)
    emitWorkflowExecutionChanged(
      sessionId,
      executionId,
      workflowId,
      workflowName,
      workflowColor,
      'cancelled',
      undefined,
      undefined,
      [],
    )
    this.setPhase(sessionId, 'build')
    const updatedSession = this.requireSession(sessionId)
    this.emit({ type: 'session_updated', session: updatedSession })
  }

  /**
   * Mark workflow as blocked.
   */
  blockWorkflow(
    sessionId: string,
    executionId: string,
    workflowId: string,
    workflowName: string,
    workflowColor: string | undefined,
  ): void {
    updateWorkflowExecutionStatus(executionId, 'blocked', undefined, undefined, undefined, [])
    clearWorkflowExecution(executionId)
    emitWorkflowExecutionChanged(
      sessionId,
      executionId,
      workflowId,
      workflowName,
      workflowColor,
      'blocked',
      undefined,
      undefined,
      [],
    )
    this.setPhase(sessionId, 'blocked')
    const updatedSession = this.requireSession(sessionId)
    this.emit({ type: 'session_updated', session: updatedSession })
  }

  /**
   * Get the active workflow execution for a session, mapped to the shared type.
   */
  getActiveWorkflowExecution(sessionId: string): import('../../shared/types.js').WorkflowExecution | null {
    const row = dbGetActiveWorkflowExecution(sessionId)
    if (!row) return null
    return {
      id: row.id,
      sessionId: row.session_id,
      workflowId: row.workflow_id,
      workflowName: row.workflow_name,
      ...(row.workflow_color ? { workflowColor: row.workflow_color } : {}),
      status: row.status as import('../../shared/types.js').WorkflowExecutionStatus,
      ...(row.current_step_id ? { currentStepId: row.current_step_id } : {}),
      ...(row.current_step_name ? { currentStepName: row.current_step_name } : {}),
      stepOutput: JSON.parse(row.step_output ?? '{}') as Record<string, string>,
      params: JSON.parse(row.params ?? '{}') as Record<string, string>,
      ...(row.sub_group ? { subGroup: row.sub_group } : {}),
      ...(row.pending_choices
        ? { pendingChoices: JSON.parse(row.pending_choices) as import('../../shared/types.js').UserStepChoice[] }
        : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  /**
   * Latest workflow execution for a session regardless of status, mapped to the
   * shared type. Used to locate a blocked execution when the user retries its
   * step — blocked rows are excluded from getActiveWorkflowExecution.
   */
  getLatestWorkflowExecution(sessionId: string): import('../../shared/types.js').WorkflowExecution | null {
    const row = dbGetLatestWorkflowExecution(sessionId)
    if (!row) return null
    return {
      id: row.id,
      sessionId: row.session_id,
      workflowId: row.workflow_id,
      workflowName: row.workflow_name,
      ...(row.workflow_color ? { workflowColor: row.workflow_color } : {}),
      status: row.status as import('../../shared/types.js').WorkflowExecutionStatus,
      ...(row.current_step_id ? { currentStepId: row.current_step_id } : {}),
      ...(row.current_step_name ? { currentStepName: row.current_step_name } : {}),
      stepOutput: JSON.parse(row.step_output ?? '{}') as Record<string, string>,
      params: JSON.parse(row.params ?? '{}') as Record<string, string>,
      ...(row.sub_group ? { subGroup: row.sub_group } : {}),
      ...(row.pending_choices
        ? { pendingChoices: JSON.parse(row.pending_choices) as import('../../shared/types.js').UserStepChoice[] }
        : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  /**
   * The execution a client should render: the active run, or a blocked one
   * awaiting a user-triggered retry. Completed/cancelled runs are not
   * surfaced — the UI only acts on running/waiting/blocked.
   */
  getDisplayWorkflowExecution(sessionId: string): import('../../shared/types.js').WorkflowExecution | null {
    const active = this.getActiveWorkflowExecution(sessionId)
    if (active) return active
    const latest = this.getLatestWorkflowExecution(sessionId)
    if (latest && latest.status === 'blocked') return latest
    return null
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
   * Stores promptTokens + completionTokens so the tracked size reflects the
   * true context occupancy — the last call's output is re-fed into the next
   * request as an assistant message, so it must count toward the budget.
   * maxTokens comes from the session model's context window (falling back to
   * the currently selected model's limit).
   */
  setCurrentContextSize(sessionId: string, promptTokens: number, completionTokens = 0, subAgentId?: string): void {
    const state = getSessionState(sessionId, this.getCurrentModelContext(sessionId))
    const maxTokens = this.getCurrentModelContext(sessionId)
    const currentTokens = promptTokens + completionTokens
    // Sub-agent runs happen in a fresh, never-compacted scoped context, so
    // their context.state must never inherit the main session's count.
    const compactionCount = subAgentId ? 0 : (state?.contextState.compactionCount ?? 0)
    const dynamicContextChanged = this.getDynamicContextChanged(sessionId)

    emitContextState(
      sessionId,
      currentTokens,
      maxTokens,
      compactionCount,
      isInDangerZone(currentTokens, maxTokens),
      canCompact(currentTokens, maxTokens),
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
  recordFileRead(sessionId: string, filePath: string, contentHash: string, relPath?: string): void {
    const cache = this.readFilesCache.get(sessionId) ?? {}
    cache[filePath] = {
      hash: contentHash,
      readAt: new Date().toISOString(),
      ...(relPath ? { relPath } : {}),
    }
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
  updateFileHash(sessionId: string, filePath: string, contentHash: string, relPath?: string): void {
    const cache = this.readFilesCache.get(sessionId) ?? {}
    const existingEntry = cache[filePath]
    cache[filePath] = {
      hash: contentHash,
      readAt: existingEntry?.readAt ?? new Date().toISOString(),
      ...(relPath ? { relPath } : {}),
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
    promptHash?: string,
  ): void {
    updateSessionCachedPrompt(sessionId, systemPrompt, tools, hash, promptHash)
    this.resetWarmup(sessionId)
  }

  getCachedPrompt(
    sessionId: string,
  ):
    | { systemPrompt: string; tools: import('../llm/types.js').LLMToolDefinition[]; hash: string; promptHash?: string }
    | undefined {
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
   * The instructions/skills/model hash last announced to the model via a
   * system-prompt-change reminder. Drives exactly-once prompt-drift reminders.
   */
  getAnnouncedPromptHash(sessionId: string): string | undefined {
    return this.announcedPromptHashStore.get(sessionId)
  }

  setAnnouncedPromptHash(sessionId: string, hash: string): void {
    this.announcedPromptHashStore.set(sessionId, hash)
  }

  /**
   * The tool fingerprint last announced to the model via a tool-change
   * reminder. Drives exactly-once tool-drift reminders WITHOUT mutating the
   * cached prefix (the cached tools stay frozen until a manual rebase).
   */
  getAnnouncedToolFingerprint(sessionId: string): string | undefined {
    return this.announcedToolFingerprintStore.get(sessionId)
  }

  setAnnouncedToolFingerprint(sessionId: string, fingerprint: string): void {
    this.announcedToolFingerprintStore.set(sessionId, fingerprint)
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
    const providerManager = this.providerManager

    // Get maxTokens from the session's effective model if resolvable, otherwise use global
    const { providerId, model } = this.resolveEffectiveProviderModel(sessionId)
    let maxTokens = providerManager.getCurrentModelContext()
    if (providerId && model) {
      const resolved = this.resolveModelContext(providerId, model)
      if (resolved !== undefined) {
        maxTokens = resolved
      } else {
        // The pinned provider/model is gone: the context window below is the
        // global one, not the one this session was configured with, so the
        // reported budget is a guess.
        if (!this.unknownProviderWarned.has(sessionId)) {
          this.unknownProviderWarned.add(sessionId)
          logger.warn('Session references an unknown provider, falling back to the global context window', {
            sessionId,
            providerId,
          })
        }
      }
    }

    const state = getSessionState(sessionId, maxTokens)
    const dynamicContextChanged = this.getDynamicContextChanged(sessionId)
    const debugDump = this.debugDumpStore.get(sessionId)
    const warmCache = !!this.getCachedPrompt(sessionId)
    if (!state) {
      return {
        currentTokens: 0,
        maxTokens,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged,
        ...(warmCache ? { warmCache } : {}),
        ...(debugDump ? { debugDump } : {}),
      }
    }
    return {
      ...state.contextState,
      dynamicContextChanged,
      ...(warmCache ? { warmCache } : {}),
      ...(debugDump ? { debugDump } : {}),
    }
  }

  // ============================================================================
  // LSP Manager
  // ============================================================================

  /**
   * Get the LSP manager for a session.
   * Uses workspace path when active, otherwise the project workdir.
   */
  getLspManager(sessionId: string): LspManager {
    const effectiveWorkdir = this.getEffectiveWorkdir(sessionId)
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
          try {
            if (sourceBranch) {
              const validated = await resolveAndValidateSourceBranch(wsPath, sourceBranch, projectDir)
              await runGit(wsPath, ['checkout', '-b', branch, validated])
            } else {
              await checkoutBranchFromSharedSource(wsPath, branch)
            }
          } catch (innerErr) {
            throw new Error(
              serverT(
                {
                  en: 'Failed to create branch "{{branch}}" in workspace "{{workspace}}": {{reason}}',
                  fr: 'Échec de création de la branche « {{branch}} » dans le workspace « {{workspace}} » : {{reason}}',
                },
                {
                  branch,
                  workspace: workspaceName,
                  reason: innerErr instanceof Error ? innerErr.message : String(innerErr),
                },
              ),
            )
          }
        })
      } catch (err) {
        throw new Error(
          serverT(
            {
              en: 'Failed to apply branch "{{branch}}" to workspace "{{workspace}}": {{reason}}',
              fr: 'Échec d’application de la branche « {{branch}} » au workspace « {{workspace}} » : {{reason}}',
            },
            {
              branch,
              workspace: workspaceName,
              reason: err instanceof Error ? err.message : String(err),
            },
          ),
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
        const currentBranch = await getGitBranch(this.getEffectiveWorkdir(sessionId))
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
            // Inherit the session's current branch so a fresh workspace does
            // not silently drop it onto the clone's default (main/develop).
            const inheritedBranch =
              branch ?? (await getGitBranch(this.getEffectiveWorkdir(sessionId))) ?? session.branch ?? undefined
            await ensureWorkspace(project.workdir, target, project.name, inheritedBranch, sourceBranch)
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
        // Sync the branch for all other sessions that share this workspace
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
      const commitHint = target === 'original' ? '' : WORKSPACE_COMMIT_RECIPE
      const reminderContent = `<system-reminder>\nThis session is now operating in workspace "${wsLabel}" on branch "${actualBranch ?? 'unknown'}" at ${effectiveWorkdir}.${stalenessHint}\nAll file and git operations should use this directory.${commitHint}\n</system-reminder>`
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
    // The .finally() chain returns a new promise that propagates the original
    // rejection. Attach .catch() so the cleanup never surfaces as an unhandled
    // rejection when lockPromise rejects — the caller already observes the
    // rejection via the returned promise.
    lockPromise
      .finally(() => {
        if (this.switchLocks.get(sessionId) === lockPromise) this.switchLocks.delete(sessionId)
      })
      .catch(() => {})

    return lockPromise
  }

  /**
   * Delete a workspace by name. If the session is currently in that workspace,
   * switches to original first. Throws if target is "original".
   * Refuses deletion if other sessions reference this workspace.
   */
  async deleteWorkspace(sessionId: string, target: string, force = false): Promise<Session> {
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
      if (force) {
        // Switch all conflicting sessions to original first
        for (const other of otherSessionsUsingIt) {
          try {
            await this.switchWorkspace(other.id, 'original')
          } catch (err) {
            throw new Error(
              `Failed to switch session ${other.id} to original: ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        }
      } else {
        const conflictingSessionIds = otherSessionsUsingIt.map((s) => s.id)
        throw new WorkspaceInUseError(
          `Workspace "${target}" is in use by other session(s): ${conflictingSessionIds.join(', ')}. Switch them to original first, or retry with force=true.`,
          conflictingSessionIds,
        )
      }
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
    const maxTokens =
      this.resolveModelContext(dbSession.providerId, dbSession.providerModel) ??
      this.providerManager.getCurrentModelContext()
    const eventState = getSessionState(dbSession.id, maxTokens, dbSession.mode)

    if (!eventState) {
      // No events yet - return defaults from DB
      return {
        ...dbSession,
        mode: dbSession.mode,
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
