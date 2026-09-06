import { WebSocketServer, WebSocket } from 'ws'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import type { Server } from 'node:http'
import type { ServerMessage } from '../../shared/protocol.js'
import type { GitDiffFile } from '../../shared/protocol.js'
import { createServerMessage } from '../../shared/protocol.js'
import { createSessionStateMessage } from './protocol.js'
import { handleTerminalMessage, unsubscribeAllFromTerminal } from './terminal.js'
import type { Config } from '../config.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { SessionManager } from '../session/index.js'
import { getEventStore, combineEventsWithSnapshot } from '../events/index.js'
import { getMaxVisibleItems } from '../db/settings.js'

import type { Message, Provider, ProviderBackend, StatsIdentity, Attachment } from '../../shared/types.js'
import type { ProviderManager } from '../provider-manager.js'
import { runChatTurn } from '../chat/orchestrator.js'
import { interruptLLMRetryWait, hasRecentLLMFailure } from '../chat/stream-pure.js'

import { launchWorkflowRun } from '../runner/launch.js'
import {
  initAutoLaunch,
  scheduleAutoLaunch,
  cancelAutoLaunch,
  getAutoLaunchMessage,
  hasAutoLaunchPending,
} from '../workflows/autolaunch.js'
import type { AutoLaunchFavorite } from '../workflows/autolaunch.js'
import { resolveFavoriteWorkflow } from '../workflows/favorite.js'
import {
  findTaskIdBySession,
  getTask as dbGetTaskById,
  setTaskWorkflowChoice as dbSetTaskWorkflowChoice,
} from '../db/tasks.js'
import { appendCompactionPrompt } from '../context/compactor.js'
import { computeSessionHash, applyDynamicContext, computeUnifiedDiff } from '../chat/dynamic-context.js'
import { provideAnswer } from '../tools/index.js'
import { resolveAutoActionTimeoutSeconds } from '../utils/auto-action-timeout.js'
import { initAutoAnswer, cancelAutoAnswersForSession } from '../tools/index.js'
import { logger } from '../utils/logger.js'
import { devServerManager } from '../dev-server/manager.js'
import { onProcessEvent } from '../tools/background-process/manager.js'
import { buildMessagesFromStoredEvents, foldPendingConfirmations } from '../events/folding.js'
import { getPendingQuestionsForSession } from '../tools/index.js'
import { generateSessionNameForSession, needsNameGeneration } from '../session/name-generator.js'
import { getSessionMessageCount } from '../utils/session-utils.js'
import { getGlobalConfigDir } from '../../cli/paths.js'
import { serverT } from '../i18n.js'
import type { Translation } from '../../shared/i18n/index.js'

const MSG_INVALID_MESSAGE_FORMAT: Translation = { en: 'Invalid message format', fr: 'Format de message invalide' }
const MSG_NO_ACTIVE_SESSION: Translation = { en: 'No active session', fr: 'Aucune session active' }
const MSG_SESSION_NOT_FOUND: Translation = { en: 'Session not found', fr: 'Session introuvable' }
const MSG_SESSION_IS_RUNNING: Translation = {
  en: 'Session is already running',
  fr: 'La session est déjà en cours d’exécution',
}
const MSG_UNKNOWN_ERROR: Translation = { en: 'Unknown error', fr: 'Erreur inconnue' }

// Resolved once initial MCP connections settle — checkDynamic awaits this
let resolveMcpReady: (() => void) | null = null
const mcpReadyPromise = new Promise<void>((resolve) => {
  resolveMcpReady = resolve
})

export function signalMcpReady(): void {
  resolveMcpReady?.()
}

import { getAuthConfig, isValidToken } from '../auth.js'
import { gitSpawnEnv } from '../git/env.js'
import {
  parseClientMessage,
  serializeServerMessage,
  createErrorMessage,
  createSessionRunningMessage,
  createChatMessageMessage,
  createChatErrorMessage,
  createContextStateMessage,
  isSessionLoadPayload,
  isAskAnswerPayload,
  storedEventToServerMessage,
  createQueueStateMessage,
  createGitStatusMessage,
} from './protocol.js'

function moduleGitBranch(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      env: gitSpawnEnv(),
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
    let stdout = ''
    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })
    proc.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim())
      } else {
        resolve(null)
      }
    })
    proc.on('error', () => resolve(null))
  })
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function moduleGitDiff(cwd: string): Promise<{ hash: string; files: GitDiffFile[] }> {
  return new Promise((resolve) => {
    const env = gitSpawnEnv()
    const diffProc = spawn('git', ['diff', '--ignore-submodules=none', '--name-status', 'HEAD'], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const statusProc = spawn('git', ['status', '--porcelain', '--ignore-submodules=none'], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let diffStdout = ''
    let statusStdout = ''
    let diffExited = false
    let statusExited = false
    let diffCode: number | null = null
    let statusCode: number | null = null

    const processResults = () => {
      if (!diffExited || !statusExited) return

      const raw = diffStdout + statusStdout
      const hash = raw ? hashContent(raw) : ''
      const files: GitDiffFile[] = []

      if (diffCode === 0) {
        for (const line of diffStdout.split('\n')) {
          if (!line.trim()) continue
          const [statusChar, ...pathParts] = line.split('\t')
          const path = pathParts.join('\t') || statusChar || ''
          if (!path) continue
          const status = statusChar === 'A' ? 'added' : statusChar === 'D' ? 'deleted' : 'modified'
          files.push({ path, status, additions: 0, deletions: 0 })
        }
      }

      if (statusCode === 0) {
        for (const line of statusStdout.split('\n')) {
          if (!line.startsWith('?? ')) continue
          const path = line.slice(3).trim()
          if (!path) continue
          files.push({ path, status: 'added', additions: 0, deletions: 0 })
        }
      }

      resolve({ hash, files })
    }

    diffProc.stdout.on('data', (data: Buffer) => {
      diffStdout += data.toString()
    })
    statusProc.stdout.on('data', (data: Buffer) => {
      statusStdout += data.toString()
    })

    diffProc.on('close', (code) => {
      diffExited = true
      diffCode = code
      processResults()
    })
    statusProc.on('close', (code) => {
      statusExited = true
      statusCode = code
      processResults()
    })
    diffProc.on('error', () => {
      diffExited = true
      diffCode = 1
      processResults()
    })
    statusProc.on('error', () => {
      statusExited = true
      statusCode = 1
      processResults()
    })
  })
}

const moduleWorkdirLastHash = new Map<string, string>()
const moduleWorkdirInterval = new Map<string, ReturnType<typeof setInterval>>()
const gitPollInterval = parseInt(process.env['OPENFOX_GIT_POLL_INTERVAL'] ?? '', 10) || 10_000
let moduleClients: Map<WebSocket, ClientConnection> | null = null
let moduleEnqueueSend: ((client: ClientConnection, data: string, seq: number) => void) | null = null

function moduleGitPoll(workdir: string) {
  ;(async () => {
    try {
      const branch = await moduleGitBranch(workdir)
      const { hash, files } = await moduleGitDiff(workdir)
      const lastHash = moduleWorkdirLastHash.get(workdir)
      if (hash !== lastHash) {
        moduleWorkdirLastHash.set(workdir, hash)
        const msg = createGitStatusMessage(branch, files)
        const activeClients = moduleClients
        const sendFn = moduleEnqueueSend
        if (!activeClients || !sendFn) return
        for (const [ws, client] of activeClients) {
          if (client.activeWorkdir === workdir && ws.readyState === WebSocket.OPEN) {
            const seq = client.lastSentSeq + 1
            sendFn(client, serializeServerMessage({ ...msg, sessionId: client.activeSessionId ?? '' }), seq)
          }
        }
      }
    } catch {
      /* skip */
    }
  })()
}

function moduleStartGitPolling(workdir: string) {
  if (moduleWorkdirInterval.has(workdir)) return
  const interval = setInterval(() => moduleGitPoll(workdir), gitPollInterval)
  moduleWorkdirInterval.set(workdir, interval)
}

function moduleStopGitPolling(workdir: string) {
  const interval = moduleWorkdirInterval.get(workdir)
  if (interval !== undefined) {
    clearInterval(interval)
    moduleWorkdirInterval.delete(workdir)
    moduleWorkdirLastHash.delete(workdir)
  }
}

function resolveStatsIdentity(
  llmClient: LLMClientWithModel,
  getActiveProvider?: () => Provider | undefined,
): StatsIdentity {
  const provider = getActiveProvider?.()
  const model = llmClient.getModel()
  const backend = provider?.backend ?? (llmClient.getBackend() === 'unknown' ? 'unknown' : llmClient.getBackend())
  const reasoningEffort = llmClient.getReasoningEffort?.()

  return {
    providerId: provider?.id ?? `provider:${model}`,
    providerName: provider?.name ?? 'Unknown Provider',
    backend,
    model,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  }
}

function addUserMessageAndBroadcast(
  sessionManager: SessionManager,
  sessionId: string,
  message: { content: string; attachments?: Attachment[]; messageKind?: string | undefined },
  broadcastFn: (sessionId: string, msg: ServerMessage) => void,
): ReturnType<SessionManager['addMessage']> {
  const userMessage = sessionManager.addMessage(sessionId, {
    role: 'user',
    content: message.content,
    ...(message.attachments ? { attachments: message.attachments } : {}),
    ...(message.messageKind ? { messageKind: message.messageKind as Exclude<Message['messageKind'], undefined> } : {}),
  })
  broadcastFn(sessionId, createChatMessageMessage(userMessage))
  return userMessage
}

function processQueueAndRestartTurn(
  sessionManager: SessionManager,
  sessionId: string,
  drainFn: (
    sessionId: string,
  ) => Array<{ content: string; attachments?: Attachment[]; messageKind?: string; queueId?: string }>,
  queueMode: 'asap' | 'completion',
  broadcastFn: (sessionId: string, msg: ServerMessage) => void,
  activeAgents: Map<string, AbortController>,
  startTurnFn: (sessionId: string, controller: AbortController) => void,
  queueMessageFn?: (
    sessionId: string,
    mode: 'asap' | 'completion',
    content: string,
    attachments?: Attachment[],
    messageKind?: string,
  ) => void,
): boolean {
  const messages = drainFn(sessionId)
  const next = messages[0]
  if (!next) return false

  for (const remaining of messages.slice(1)) {
    if (queueMessageFn) {
      queueMessageFn(
        sessionId,
        queueMode,
        remaining.content,
        remaining.attachments,
        remaining.messageKind as 'command' | undefined,
      )
    } else {
      sessionManager.queueMessage(sessionId, queueMode, remaining.content, remaining.attachments)
    }
  }
  broadcastFn(sessionId, createQueueStateMessage(sessionManager.getQueueState(sessionId)))

  addUserMessageAndBroadcast(
    sessionManager,
    sessionId,
    {
      content: next.content,
      ...(next.attachments ? { attachments: next.attachments } : {}),
      ...(next.messageKind ? { messageKind: next.messageKind } : {}),
    },
    broadcastFn,
  )

  const newController = new AbortController()
  activeAgents.set(sessionId, newController)
  startTurnFn(sessionId, newController)
  return true
}

// Track active agent AbortControllers by sessionId
const activeAgents = new Map<string, AbortController>()
const abortedSessions = new Set<string>()

interface ClientConnection {
  ws: WebSocket
  activeSessionId: string | null
  activeWorkdir: string | null
  globalSubscription: (() => void) | null
  sendQueue: Array<{ data: string; seq: number }>
  isSending: boolean
  lastSentSeq: number
}

const MAX_SEND_QUEUE_SIZE = 1000 // Maximum messages to queue before dropping

/**
 * WebSocket Message Ordering Implementation
 *
 * This module implements ordered message delivery to prevent race conditions
 * when multiple events are emitted in rapid succession.
 *
 * Key Design Decisions:
 *
 * 1. Per-Client Send Queue: Each WebSocket client has its own FIFO queue
 *    that ensures messages are sent in strict order, preventing the
 *    "garbled UI" issue where messages arrive out of order.
 *
 * 2. Single Event Source: Only EventStore global subscription is used.
 *    SessionManager legacy events are NOT forwarded to prevent duplicates.
 *    All session state changes go through EventStore (mode.changed,
 *    phase.changed, running.changed, etc.).
 *
 * 3. Sequence Numbers: Messages include sequence numbers for ordering:
 *    - EventStore events: Use storedEvent.seq (database sequence)
 *    - Generated messages: Use client.lastSentSeq + 1
 *    Sequence numbers may have gaps due to event deletion or multiple
 *    sessions, but are always monotonically increasing per client.
 *
 * 4. Queue Size Limit: MAX_SEND_QUEUE_SIZE prevents memory leaks on
 *    slow or disconnected clients. Messages are dropped if queue is full.
 *
 * @see https://github.com/conrad/openfox/issues/XXX
 */

export function createWebSocketServer(
  httpServer: Server,
  _config: Config,
  getLLMClient: () => LLMClientWithModel,
  getActiveProvider: (() => Provider | undefined) | undefined,
  sessionManager: SessionManager,
  providerManager?: ProviderManager,
  getMcpServers?: () => import('../mcp/types.js').McpServerState[],
): WebSocketServerExports {
  const wss = new WebSocketServer({ server: httpServer })
  const clients = new Map<WebSocket, ClientConnection>()
  moduleClients = clients

  // Per-session LLM client cache: sessionId -> { cacheKey, client }
  const sessionLLMClients = new Map<string, { key: string; client: LLMClientWithModel }>()

  function getSessionLLMClient(sessionId: string): LLMClientWithModel {
    const effective = sessionManager.resolveEffectiveProviderModel(sessionId)
    if (!effective.providerId || !effective.model || !providerManager) {
      return getLLMClient()
    }

    const resolvedModel = providerManager.resolveModel(effective.providerId, effective.model)
    const effectiveModel = resolvedModel ?? effective.model
    const cacheKey = `${effective.providerId}:${effectiveModel}:${effective.reasoningEffort ?? ''}`
    const cached = sessionLLMClients.get(sessionId)
    if (cached && cached.key === cacheKey) {
      return cached.client
    }

    // Look up the provider to get URL, apiKey, backend
    const provider = providerManager.getProviders().find((p) => p.id === effective.providerId)
    if (!provider) {
      // Provider is gone — fall back to global. Only clear the STICKY preference
      // when the preference itself references the deleted provider.
      logger.warn('Session references missing provider, falling back to global', {
        sessionId,
        providerId: effective.providerId,
      })
      const session = sessionManager.getSession(sessionId)
      if (session?.providerId === effective.providerId) {
        sessionManager.setSessionProvider(sessionId, null, null, false, null)
        sessionManager.setSessionProviderActive(sessionId, true)
      }
      sessionLLMClients.delete(sessionId)
      return getLLMClient()
    }

    // Let ProviderManager create the session client so provider-specific
    // transports (for example External Provider custom) and auth context are preserved.
    const client = providerManager.createClient(effective.providerId, effectiveModel, effective.reasoningEffort)
    if (!client) {
      logger.warn('Could not create session provider client, falling back to global', {
        sessionId,
        providerId: effective.providerId,
        model: effective.model,
      })
      return getLLMClient()
    }

    const concreteModel = client.getModel()
    const session = sessionManager.getSession(sessionId)
    // Only normalize the stored preference when the EFFECTIVE model is sourced
    // from that preference (model-name resolution, e.g. 'auto' → concrete). When
    // the effective model comes from an agent override, never write it back —
    // it would silently clobber the user's sticky pick.
    if (
      session?.providerId === effective.providerId &&
      session.providerModel === effective.model &&
      session.providerModel !== concreteModel
    ) {
      sessionManager.setSessionProvider(
        sessionId,
        effective.providerId,
        concreteModel,
        undefined,
        effective.reasoningEffort,
      )
    }
    sessionLLMClients.set(sessionId, {
      key: `${effective.providerId}:${concreteModel}:${effective.reasoningEffort ?? ''}`,
      client,
    })
    return client
  }

  function getSessionStatsIdentity(sessionId: string): StatsIdentity {
    const effective = sessionManager.resolveEffectiveProviderModel(sessionId)
    if (!effective.providerId || !providerManager) {
      return resolveStatsIdentity(getLLMClient(), getActiveProvider)
    }

    const provider = providerManager.getProviders().find((p) => p.id === effective.providerId)
    const client = getSessionLLMClient(sessionId)
    const reasoningEffort = client.getReasoningEffort?.()
    return {
      providerId: provider?.id ?? effective.providerId,
      providerName: provider?.name ?? 'Unknown Provider',
      backend: (provider?.backend ?? client.getBackend()) as ProviderBackend,
      model: client.getModel(),
      ...(reasoningEffort ? { reasoningEffort } : {}),
    }
  }

  const isSubscribedToSession = (client: ClientConnection, sessionId: string) => {
    return client.activeSessionId === sessionId
  }

  // Ordered send queue implementation for FIFO message delivery
  function enqueueSend(client: ClientConnection, data: string, seq: number): void {
    // Drop message if queue is too large (prevents memory leak on slow clients)
    if (client.sendQueue.length >= MAX_SEND_QUEUE_SIZE) {
      logger.warn('WebSocket send queue full, dropping message', {
        queueSize: client.sendQueue.length,
        sessionId: client.activeSessionId,
      })
      return
    }
    client.sendQueue.push({ data, seq })
    processSendQueue(client)
  }
  moduleEnqueueSend = enqueueSend

  function processSendQueue(client: ClientConnection): void {
    if (client.isSending || client.sendQueue.length === 0) {
      return
    }

    client.isSending = true
    const item = client.sendQueue.shift()!

    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(item.data, (err) => {
        if (err) {
          logger.debug('WebSocket send error', { error: err })
        }
        client.isSending = false
        client.lastSentSeq = item.seq
        processSendQueue(client)
      })
    } else {
      client.isSending = false
      processSendQueue(client)
    }
  }

  const llmForSession = (sessionId: string): LLMClientWithModel => getSessionLLMClient?.(sessionId) ?? getLLMClient()

  const statsForSession = (sessionId: string): StatsIdentity =>
    getSessionStatsIdentity?.(sessionId) ?? resolveStatsIdentity(getLLMClient(), getActiveProvider)

  function cleanupAfterTurn(
    sessionId: string,
    controller: AbortController,
    sendFn: (sessionId: string, msg: ServerMessage) => void,
    setRunningOnEarlyReturn: boolean,
  ) {
    if (activeAgents.get(sessionId) !== controller) {
      return
    }
    activeAgents.delete(sessionId)

    if (abortedSessions.has(sessionId)) {
      abortedSessions.delete(sessionId)
      sessionManager.clearMessageQueue(sessionId)
      const contextState = sessionManager.getContextState(sessionId)
      sendFn(sessionId, createContextStateMessage(contextState))
      return
    }

    const processed = processQueueAndRestartTurn(
      sessionManager,
      sessionId,
      (sid) => sessionManager.drainAsapMessages(sid),
      'asap',
      sendFn,
      activeAgents,
      startTurnWithCompletionChain,
      (sid, mode, content, attachments, messageKind) =>
        sessionManager.queueMessage(sid, mode, content, attachments, messageKind as 'command' | undefined),
    )
    if (processed) {
      if (setRunningOnEarlyReturn) sessionManager.setRunning(sessionId, false)
      return
    }

    const processedCompletion = processQueueAndRestartTurn(
      sessionManager,
      sessionId,
      (sid) => sessionManager.drainCompletionMessages(sid),
      'completion',
      sendFn,
      activeAgents,
      startTurnWithCompletionChain,
    )
    if (processedCompletion) {
      if (setRunningOnEarlyReturn) sessionManager.setRunning(sessionId, false)
      return
    }

    sessionManager.clearMessageQueue(sessionId)
    // runChatTurn in startTurnWithCompletionChain already sets isRunning=false in finally.
    // For the runner orchestrator path (which bypasses runChatTurn), the caller's
    // .finally() block handles setRunning(false) explicitly.
    const contextState = sessionManager.getContextState(sessionId)
    sendFn(sessionId, createContextStateMessage(contextState))
  }

  function startTurnWithCompletionChain(sessionId: string, controller: AbortController) {
    runChatTurn({
      sessionManager,
      sessionId,
      llmClient: llmForSession(sessionId),
      getSessionLLMClient: () => llmForSession(sessionId),
      statsIdentity: statsForSession(sessionId),
      signal: controller.signal,
      onMessage: (msg) => broadcastForSession(sessionId, msg),
    })
      .catch((error) => {
        if (error instanceof Error && error.message === 'Aborted') {
          return
        }
        logger.error('Chat turn error', { error })
      })
      .finally(() => {
        try {
          cleanupAfterTurn(sessionId, controller, broadcastForSession, false)
        } catch {
          // Session may have been deleted during execution
        }
      })
  }

  // Note: SessionManager subscription removed - EventStore global subscription (below)
  // is the single source of truth for all session events including running.changed

  // Broadcast all (dev server events, cross-session confirmations)
  const broadcastAll = (msg: ServerMessage) => {
    const serialized = serializeServerMessage(msg)
    for (const [clientWs, client] of clients) {
      if (clientWs.readyState === WebSocket.OPEN) {
        const seq = client.lastSentSeq + 1
        enqueueSend(client, serialized, seq)
      }
    }
  }

  const broadcastForSession = (sessionId: string, msg: ServerMessage) => {
    const session = sessionManager.getSession(sessionId)
    const projectId = session?.projectId
    for (const [clientWs, client] of clients) {
      if (clientWs.readyState !== WebSocket.OPEN) continue
      if (!isSubscribedToSession(client, sessionId)) continue
      const seq = client.lastSentSeq + 1
      enqueueSend(client, serializeServerMessage({ ...msg, sessionId }), seq)
    }
    // Broadcast confirmations and their resolution to non-subscribed clients within the same project
    if ((msg.type === 'chat.path_confirmation' || msg.type === 'session.confirmation_resolved') && projectId) {
      for (const [clientWs, client] of clients) {
        if (clientWs.readyState !== WebSocket.OPEN) continue
        if (isSubscribedToSession(client, sessionId)) continue
        const clientProjectId = client.activeSessionId
          ? sessionManager.getSession(client.activeSessionId)?.projectId
          : undefined
        if (clientProjectId !== projectId) continue
        const seq = client.lastSentSeq + 1
        const crossSessionType =
          msg.type === 'chat.path_confirmation' ? 'session.confirmation_pending' : 'session.confirmation_resolved'
        enqueueSend(client, serializeServerMessage({ type: crossSessionType, sessionId, payload: msg.payload }), seq)
      }
    }
  }

  const broadcastForProject = (projectId: string, sessionId: string, msg: ServerMessage) => {
    for (const [clientWs, client] of clients) {
      if (clientWs.readyState !== WebSocket.OPEN) continue
      const clientProjectId = client.activeSessionId
        ? sessionManager.getSession(client.activeSessionId)?.projectId
        : undefined
      if (clientProjectId !== projectId) continue
      const seq = client.lastSentSeq + 1
      enqueueSend(client, serializeServerMessage({ ...msg, sessionId }), seq)
    }
  }

  // ============================================================================
  // Favorite-workflow auto-launch countdown
  // ============================================================================

  const fireAutoLaunch = (sessionId: string, favorite: AutoLaunchFavorite): void => {
    // Defensive re-check: something may have started since scheduling (e.g. a
    // retry turn) — never hijack an in-flight run.
    if (!isStartBuildingState(sessionId)) {
      logger.debug('Auto-launch skipped: no longer at the start-building choice point', { sessionId })
      return
    }
    const existing = activeAgents.get(sessionId)
    if (existing) {
      logger.warn('Auto-launch aborting existing agent before starting favorite workflow', { sessionId })
      existing.abort()
    }
    const controller = new AbortController()
    activeAgents.set(sessionId, controller)
    launchWorkflowRun(
      {
        sessionManager,
        sessionId,
        controller,
        llmClient: llmForSession(sessionId),
        getSessionLLMClient: () => llmForSession(sessionId),
        statsIdentity: statsForSession(sessionId),
        broadcastForSession: (sid, msg) => broadcastForSession(sid, msg),
        onFinished: () => cleanupAfterTurn(sessionId, controller, sendForSessionSink, true),
      },
      { workflowId: favorite.id, scope: favorite.scope, autoLaunched: true },
    )
  }

  const sendForSessionSink = (sessionId: string, msg: ServerMessage) => {
    broadcastForSession(sessionId, msg)
  }

  const autoActionDelayMs = (projectId?: string): number => resolveAutoActionTimeoutSeconds(projectId) * 1000

  initAutoLaunch({
    broadcast: (sessionId, msg) => broadcastForSession(sessionId, msg),
    fire: fireAutoLaunch,
    resolveDelayMs: autoActionDelayMs,
  })

  initAutoAnswer({
    broadcast: (sessionId, msg) => broadcastForSession(sessionId, msg),
    resolveDelayMs: autoActionDelayMs,
  })

  // The session is idle at the post-planner "start building" choice point —
  // same shape the frontend gates its workflow buttons on.
  const isStartBuildingState = (sessionId: string): boolean => {
    const session = sessionManager.getSession(sessionId)
    if (!session || session.isRunning) return false
    // A settled `plan` run leaves the phase done — that's exactly the chained
    // start-building point; any other done session is not a choice point.
    const latest = sessionManager.getLatestWorkflowExecution(sessionId)
    const planSettled = latest?.workflowId === 'plan' && latest.status === 'completed'
    if (session.phase === 'done' && !planSettled) return false
    const eventStore = getEventStore()
    const { snapshot, events: eventsSinceSnapshot } = eventStore.getEventsSinceSnapshot(sessionId)
    const events = combineEventsWithSnapshot(sessionId, snapshot, eventsSinceSnapshot)
    const messages = buildMessagesFromStoredEvents(events).messages
    if (!messages.some((m) => m.role === 'assistant')) return false
    const criteria = session.metadataEntries?.['criteria'] ?? []
    if (!criteria.some((c) => c.status === 'pending')) return false
    const exec = sessionManager.getDisplayWorkflowExecution(sessionId)
    return exec?.status !== 'running' && exec?.status !== 'waiting'
  }

  // Debounced: waits for the run-settled + criteria state to converge, then
  // verifies every start-building condition still holds server-side.
  const scheduleTimers = new Map<string, ReturnType<typeof setTimeout>>()
  function scheduleAutoLaunchIfEligible(sessionId: string): void {
    if (hasAutoLaunchPending(sessionId)) return
    const existingTimer = scheduleTimers.get(sessionId)
    if (existingTimer) clearTimeout(existingTimer)
    scheduleTimers.set(
      sessionId,
      setTimeout(() => {
        scheduleTimers.delete(sessionId)
        void (async () => {
          try {
            if (!isStartBuildingState(sessionId)) return
            const session = sessionManager.getSession(sessionId)
            if (!session) return
            // A workflow already picked for the linked board task wins over the
            // favorite: the user (or a pick button) explicitly decided.
            const linkedTaskId = findTaskIdBySession(sessionId)
            const linkedTask = linkedTaskId ? dbGetTaskById(linkedTaskId) : null
            if (linkedTask?.workflowChoice) return
            // Auto-launch while no build has run yet in this session: a settled
            // plan run is exactly the choice point to chain into; any other
            // execution means the user already decided manually.
            const latest = sessionManager.getLatestWorkflowExecution(sessionId)
            if (latest && latest.workflowId !== 'plan') return
            const configDir = getGlobalConfigDir(_config.mode ?? 'production')
            const favorite = await resolveFavoriteWorkflow(configDir, session.projectId, session.workdir)
            if (!favorite) return
            // Re-check after the async catalog read — the user may have acted.
            if (!isStartBuildingState(sessionId)) return
            scheduleAutoLaunch(sessionId, favorite, session.projectId)
          } catch (err) {
            logger.debug('Auto-launch scheduling skipped', {
              sessionId,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        })()
      }, 1000),
    )
    scheduleTimers.get(sessionId)?.unref?.()
  }

  sessionManager.subscribe((event) => {
    if ('sessionId' in event && event.sessionId) {
      if (event.type === 'running_changed' && !event.isRunning) {
        scheduleAutoLaunchIfEligible(event.sessionId)
      } else if (
        event.type === 'criteria_updated' ||
        event.type === 'metadata_updated' ||
        event.type === 'phase_changed'
      ) {
        cancelAutoLaunch(event.sessionId)
        scheduleAutoLaunchIfEligible(event.sessionId)
      } else if (event.type === 'queue_added' || event.type === 'message_added') {
        cancelAutoLaunch(event.sessionId)
      } else if (event.type === 'session_deleted') {
        cancelAutoLaunch(event.sessionId)
      }
    }
  })

  // Global dev server event listeners — broadcast to all WS clients
  devServerManager.onOutput((workdir, chunk) => {
    broadcastAll(
      createServerMessage('devServer.output', {
        workdir,
        stream: chunk.stream,
        content: chunk.content,
      }),
    )
  })

  devServerManager.onStateChange((workdir, state, errorMessage, url, inspectProxyPort) => {
    broadcastAll(
      createServerMessage('devServer.state', {
        workdir,
        state,
        errorMessage,
        url,
        inspectProxyPort,
      }),
    )
  })

  // Session update events — broadcast session.state to session-specific clients
  sessionManager.subscribe((event) => {
    if (event.type === 'session_updated') {
      const updatedSession = event.session
      const eventStore = getEventStore()
      const { snapshot, events: eventsSinceSnapshot } = eventStore.getEventsSinceSnapshot(updatedSession.id)
      const events = combineEventsWithSnapshot(updatedSession.id, snapshot, eventsSinceSnapshot)

      const maxVisible = getMaxVisibleItems()
      const { messages, hiddenCount } = buildMessagesFromStoredEvents(events, maxVisible || undefined)
      const pendingConfirmations = foldPendingConfirmations(events)
      const pendingQuestions = getPendingQuestionsForSession(updatedSession.id)
      const activeWorkflowExecution = sessionManager.getDisplayWorkflowExecution(updatedSession.id)

      // Update activeWorkdir when workspace changed so git polling picks up the right dir
      const effectiveWorkdir = updatedSession.workspace ?? updatedSession.workdir

      for (const [, client] of clients) {
        if (client.activeSessionId === updatedSession.id && client.activeWorkdir !== effectiveWorkdir) {
          const prevWorkdir = client.activeWorkdir
          client.activeWorkdir = effectiveWorkdir
          if (prevWorkdir) {
            const hasOtherClients = [...clients.values()].some((c) => c !== client && c.activeWorkdir === prevWorkdir)
            if (!hasOtherClients) {
              moduleStopGitPolling(prevWorkdir)
            }
          }
        }
      }
      if (effectiveWorkdir) moduleStartGitPolling(effectiveWorkdir)

      // Broadcast session.state immediately — synchronous, no await
      broadcastForSession(
        updatedSession.id,
        createSessionStateMessage(
          updatedSession,
          messages,
          pendingConfirmations,
          pendingQuestions,
          undefined,
          undefined,
          hiddenCount,
          activeWorkflowExecution ?? undefined,
        ),
      )

      // Always send git.status after a session update to sync workspace/branch in the UI,
      // even when the workspace path hasn't changed (e.g. branch-only change).
      if (effectiveWorkdir) {
        ;(async () => {
          const branch = await moduleGitBranch(effectiveWorkdir)
          if (!branch) return
          const { files } = await moduleGitDiff(effectiveWorkdir)
          broadcastForSession(updatedSession.id, createGitStatusMessage(branch, files))
        })()
      }
    }
  })

  // Background process event listeners — broadcast to session-specific clients
  onProcessEvent((_processId, msg) => {
    const sessionId = msg.sessionId
    if (!sessionId) return
    // Route to clients subscribed to this session
    for (const [clientWs, client] of clients) {
      if (client.activeSessionId === sessionId) {
        if (clientWs.readyState === WebSocket.OPEN) {
          const seq = client.lastSentSeq + 1
          enqueueSend(client, serializeServerMessage(msg), seq)
        }
      }
    }
  })

  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`)
    const token = url.searchParams.get('token')

    const authConfig = getAuthConfig()
    if (authConfig?.strategy === 'network' && authConfig.encryptedPassword) {
      if (!token || !(await isValidToken(token))) {
        setTimeout(() => {
          ws.close(4000, 'Unauthorized')
        }, 100)
        return
      }
    }

    logger.debug('WebSocket client connected')
    clients.set(ws, {
      ws,
      activeSessionId: null,
      activeWorkdir: null,
      globalSubscription: null,
      sendQueue: [],
      isSending: false,
      lastSentSeq: 0,
    })

    // Subscribe to ALL session events (global subscription)
    const eventStore = getEventStore()
    const { iterator: globalIterator, unsubscribe: globalUnsubscribe } = eventStore.subscribeAll()
    clients.get(ws)!.globalSubscription = globalUnsubscribe

    // Start streaming all events to this client
    ;(async () => {
      try {
        for await (const storedEvent of globalIterator) {
          if (ws.readyState !== WebSocket.OPEN) break
          const serverMsg = storedEventToServerMessage(storedEvent)
          if (serverMsg) {
            const client = clients.get(ws)!
            enqueueSend(
              client,
              serializeServerMessage({ ...serverMsg, seq: storedEvent.seq, sessionId: storedEvent.sessionId }),
              storedEvent.seq,
            )
          }
        }
      } catch (error) {
        logger.debug('Global event subscription ended', { error })
      }
    })()

    ws.on('message', async (data) => {
      const message = parseClientMessage(data.toString())

      if (!message) {
        const client = clients.get(ws)!
        const seq = client.lastSentSeq + 1
        enqueueSend(
          client,
          serializeServerMessage(createErrorMessage('INVALID_MESSAGE', serverT(MSG_INVALID_MESSAGE_FORMAT))),
          seq,
        )
        return
      }

      // Handle terminal messages separately
      if (message.type.startsWith('terminal.')) {
        handleTerminalMessage(ws, message as unknown as Parameters<typeof handleTerminalMessage>[1])
        return
      }

      const client = clients.get(ws)!

      try {
        await handleClientMessage(
          ws,
          client,
          message,
          getLLMClient,
          getActiveProvider,
          sessionManager,
          broadcastForSession,
          providerManager,
          getSessionLLMClient,
          getSessionStatsIdentity,
          llmForSession,
          statsForSession,
          startTurnWithCompletionChain,
          cleanupAfterTurn,
          enqueueSend,
          getMcpServers,
        )
      } catch (error) {
        logger.error('Error handling client message', { error, type: message.type })
        const client = clients.get(ws)!
        const seq = client.lastSentSeq + 1
        enqueueSend(
          client,
          serializeServerMessage(
            createErrorMessage(
              'INTERNAL_ERROR',
              error instanceof Error ? error.message : serverT(MSG_UNKNOWN_ERROR),
              message.id,
            ),
          ),
          seq,
        )
      }
    })

    ws.on('close', () => {
      logger.debug('WebSocket client disconnected')
      const client = clients.get(ws)
      const disconnectedWorkdir = client?.activeWorkdir ?? null
      // Unsubscribe from global all-session subscription
      if (client?.globalSubscription) {
        client.globalSubscription()
      }
      // Unsubscribe from all terminal sessions
      unsubscribeAllFromTerminal(ws)
      clients.delete(ws)
      // Stop polling if no remaining clients for this workdir
      if (disconnectedWorkdir) {
        const hasRemaining = [...clients.values()].some((c) => c.activeWorkdir === disconnectedWorkdir)
        if (!hasRemaining) {
          moduleStopGitPolling(disconnectedWorkdir)
        }
      }
    })

    ws.on('error', (error) => {
      logger.error('WebSocket error', { error })
    })
  })

  return {
    wss,
    abortSession: (sessionId: string) => {
      abortedSessions.add(sessionId)
      const controller = activeAgents.get(sessionId)
      if (controller) {
        activeAgents.delete(sessionId)
        controller.abort()
        return true
      }
      return false
    },
    close: (cb?: () => void) => wss.close(cb as (err?: Error) => void),
    broadcastForSession,
    broadcastForProject,
    broadcastAll,
  }
}

export interface WebSocketServerExports {
  wss: WebSocketServer
  abortSession: (sessionId: string) => boolean
  close: (cb?: () => void) => void
  broadcastForSession: (sessionId: string, msg: ServerMessage) => void
  broadcastForProject: (projectId: string, sessionId: string, msg: ServerMessage) => void
  broadcastAll: (msg: ServerMessage) => void
}

async function handleClientMessage(
  ws: WebSocket,
  client: ClientConnection,
  message: { id: string; type: string; payload: unknown },
  _getLLMClient: () => LLMClientWithModel,
  _getActiveProvider: (() => Provider | undefined) | undefined,
  sessionManager: SessionManager,
  _broadcastForSession: (sessionId: string, msg: ServerMessage) => void,
  _providerManager: ProviderManager | undefined,
  _getSessionLLMClient: ((sessionId: string) => LLMClientWithModel) | undefined,
  _getSessionStatsIdentity: ((sessionId: string) => StatsIdentity) | undefined,
  llmForSession: (sessionId: string) => LLMClientWithModel,
  statsForSession: (sessionId: string) => StatsIdentity,
  _startTurnWithCompletionChain: (sessionId: string, controller: AbortController) => void,
  cleanupAfterTurn: (
    sessionId: string,
    controller: AbortController,
    sendFn: (sessionId: string, msg: ServerMessage) => void,
    setRunningOnEarlyReturn: boolean,
  ) => void,
  enqueueSendFn: (client: ClientConnection, data: string, seq: number) => void,
  getMcpServers?: () => import('../mcp/types.js').McpServerState[],
): Promise<void> {
  const send = (msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) {
      const seq = client.lastSentSeq + 1
      enqueueSendFn(client, serializeServerMessage(msg), seq)
    }
  }

  const sendForSession = (sessionId: string, msg: ServerMessage) => {
    send({ ...msg, sessionId })
  }

  const ensureEventStoreSubscription = (_sessionId: string) => {
    // No-op: clients now receive ALL events via global subscription
    // Per-session subscriptions were removed to prevent duplicate events
  }

  switch (message.type) {
    // =========================================================================
    // DEPRECATED: All CRUD operations moved to REST API
    // If you see this error, update your code to use REST endpoints instead.
    // See docs/REST-API.md for details.
    // =========================================================================

    case 'project.create':
    case 'project.create-with-dir':
    case 'project.list':
    case 'project.load':
    case 'project.update':
    case 'project.delete':
    case 'settings.get':
    case 'settings.set':
    case 'session.create':
    case 'session.list':
    case 'session.delete':
    case 'session.deleteAll':
    case 'session.setProvider':
      send(
        createErrorMessage(
          'DEPRECATED_MESSAGE_TYPE',
          `${message.type} removed. Use REST API instead. See docs/REST-API.md`,
          message.id,
        ),
      )
      return

    // =========================================================================
    // Session Load - Sets active session for event routing
    // Note: Data loading is done via REST API: GET /api/sessions/:id
    // This WebSocket message is ONLY to tell the server which session is active
    // so it can route real-time events correctly.
    // =========================================================================
    case 'session.load': {
      if (!isSessionLoadPayload(message.payload)) {
        send(
          createErrorMessage(
            'INVALID_PAYLOAD',
            serverT({ en: 'Invalid session.load payload', fr: 'Payload de session.load invalide' }),
            message.id,
          ),
        )
        return
      }

      const session = sessionManager.getSession(message.payload.sessionId)
      if (!session) {
        send(createErrorMessage('NOT_FOUND', serverT(MSG_SESSION_NOT_FOUND), message.id))
        return
      }

      // Tab model: set active session for event routing
      client.activeSessionId = session.id
      const effectiveWorkdir = sessionManager.getEffectiveWorkdir(session.id)
      client.activeWorkdir = effectiveWorkdir

      // Send initial git status immediately
      if (effectiveWorkdir) {
        const branch = await moduleGitBranch(effectiveWorkdir)
        const { files } = await moduleGitDiff(effectiveWorkdir)
        const msg = createGitStatusMessage(branch, files)
        send(msg)
        if (branch) moduleStartGitPolling(effectiveWorkdir)
      }

      ensureEventStoreSubscription(session.id)

      // Sync any pending favorite-workflow auto-launch countdown (reload/reconnect)
      const pendingAutoLaunch = getAutoLaunchMessage(session.id)
      if (pendingAutoLaunch) send({ ...pendingAutoLaunch, sessionId: session.id })

      // Frontend should use REST API to fetch session data
      send({ type: 'ack', payload: { sessionId: session.id }, id: message.id })

      // Send context.state
      const sendContextState = () => {
        const contextState = sessionManager.getContextState(session.id)
        send(createContextStateMessage(contextState))
      }
      sendContextState()

      // Re-detect dynamic context changes on load (survives server restart)
      // Also send MCP server state once MCP is ready
      const cachedHash = sessionManager.getCachedPrompt(session.id)?.hash
      ;(async () => {
        try {
          await mcpReadyPromise

          // Send current MCP server state
          if (getMcpServers) {
            const servers = getMcpServers()
            if (servers.length > 0) {
              send(createServerMessage('mcp.servers.changed', { servers }))
            }
          }

          if (cachedHash) {
            const modelName = session.providerModel ?? _providerManager?.getCurrentModel()
            const currentHash = await computeSessionHash(sessionManager, session.id, modelName)
            if (currentHash !== cachedHash) {
              sessionManager.setDynamicContextChanged(session.id, true)
              sendContextState()
            } else if (sessionManager.getDynamicContextChanged(session.id)) {
              sessionManager.setDynamicContextChanged(session.id, false)
              sendContextState()
            }
          }
        } catch {
          // Non-critical — banners and MCP state just won't be sent
        }
      })()
      break
    }

    // =========================================================================
    // Context Management
    // =========================================================================

    case 'context.compact': {
      const payload = message.payload as { sessionId?: string } | undefined
      const sessionId = payload?.sessionId ?? client.activeSessionId
      if (!sessionId) {
        send(createErrorMessage('NO_SESSION', serverT(MSG_NO_ACTIVE_SESSION), message.id))
        return
      }

      const session = sessionManager.requireSession(sessionId)

      // Check if session is running
      if (session.isRunning) {
        send(
          createErrorMessage(
            'SESSION_RUNNING',
            serverT({
              en: 'Cannot compact while session is running',
              fr: 'Impossible de compacter pendant que la session est en cours',
            }),
            message.id,
          ),
        )
        return
      }

      // Acknowledge immediately
      send({ type: 'ack', payload: {}, id: message.id })

      // Create AbortController so manual compaction is abortable via abortSession()
      const controller = new AbortController()
      const existingController = activeAgents.get(sessionId)
      if (existingController) {
        logger.warn('Aborting existing agent before compaction', { sessionId })
        existingController.abort()
      }
      activeAgents.set(sessionId, controller)

      // Append compaction prompt to event store (shared helper, same as agent-loop.ts auto-compaction trigger)
      appendCompactionPrompt(sessionId, (event) => getEventStore().append(sessionId, event))

      // Run through the agent loop — same path as auto-compaction and normal turns
      runChatTurn({
        sessionManager,
        sessionId,
        llmClient: llmForSession(sessionId),
        getSessionLLMClient: () => llmForSession(sessionId),
        statsIdentity: statsForSession(sessionId),
        signal: controller.signal,
        onMessage: (msg) => _broadcastForSession(sessionId, msg),
        initialCompacting: true,
      })
        .then(() => {
          const newContextState = sessionManager.getContextState(sessionId)
          sendForSession(sessionId, createContextStateMessage(newContextState))
        })
        .catch((error) => {
          if (error instanceof Error && error.message === 'Aborted') return
          logger.error('Compaction failed', { error, sessionId })
          const reason = error instanceof Error ? error.message : serverT(MSG_UNKNOWN_ERROR)
          sendForSession(
            sessionId,
            createChatErrorMessage(
              serverT({ en: 'Compaction failed: {{reason}}', fr: 'Échec de la compaction : {{reason}}' }, { reason }),
              true,
            ),
          )
        })
        .finally(() => {
          try {
            // Clean up activeAgents
            if (activeAgents.get(sessionId) === controller) {
              activeAgents.delete(sessionId)
            }

            if (abortedSessions.has(sessionId)) {
              abortedSessions.delete(sessionId)
              sessionManager.clearMessageQueue(sessionId)
            }

            // runChatTurn sets isRunning=true but its finally only appends to EventStore.
            // We must update the DB and broadcast so the QueueProcessor can process
            // subsequent messages.
            sessionManager.setRunning(sessionId, false)
            sendForSession(sessionId, createSessionRunningMessage(false))

            // Send fresh context state
            const contextState = sessionManager.getContextState(sessionId)
            sendForSession(sessionId, createContextStateMessage(contextState))
          } catch {
            // Session may have been deleted during execution
          }
        })

      break
    }

    case 'context.checkDynamic': {
      if (!client.activeSessionId) {
        send(createErrorMessage('NO_SESSION', serverT(MSG_NO_ACTIVE_SESSION), message.id))
        return
      }

      const sessionId = client.activeSessionId

      ;(async () => {
        try {
          await mcpReadyPromise
          const session = sessionManager.requireSession(sessionId)
          const modelName = session.providerModel ?? _providerManager?.getCurrentModel()
          const currentHash = await computeSessionHash(sessionManager, sessionId, modelName)
          const cachedHash = sessionManager.getCachedPrompt(sessionId)?.hash

          if (cachedHash) {
            if (currentHash !== cachedHash) {
              logger.debug('checkDynamic: hash mismatch', {
                sessionId,
                cachedHash,
                currentHash,
              })
              if (!sessionManager.getDynamicContextChanged(sessionId)) {
                sessionManager.setDynamicContextChanged(sessionId, true)
                const newContextState = sessionManager.getContextState(sessionId)
                sendForSession(sessionId, createContextStateMessage(newContextState))
              }
            } else if (sessionManager.getDynamicContextChanged(sessionId)) {
              sessionManager.setDynamicContextChanged(sessionId, false)
              const newContextState = sessionManager.getContextState(sessionId)
              sendForSession(sessionId, createContextStateMessage(newContextState))
            }
          }

          send({ type: 'ack', payload: {}, id: message.id })
        } catch (error) {
          logger.error('Failed to check dynamic context', { error, sessionId })
          send({ type: 'ack', payload: {}, id: message.id })
        }
      })()

      break
    }

    case 'context.applyDynamic.preview': {
      const payload = message.payload as { sessionId?: string } | undefined
      const sessionId = payload?.sessionId ?? client.activeSessionId
      if (!sessionId) {
        send(createErrorMessage('NO_SESSION', serverT(MSG_NO_ACTIVE_SESSION), message.id))
        return
      }

      const session = sessionManager.requireSession(sessionId)

      try {
        const { buildCachedPrompt, computePreviewToolDiff } = await import('../chat/dynamic-context.js')
        const allAgents = await import('../agents/registry.js')
        const agentDef =
          allAgents.findAgentById(session.mode, await allAgents.loadAllAgentsDefault()) ??
          allAgents.findAgentById('planner', await allAgents.loadAllAgentsDefault())!
        const modelName = session.providerModel ?? _providerManager?.getCurrentModel()
        const {
          systemPrompt: newPrompt,
          tools: newTools,
          hash: newHash,
        } = await buildCachedPrompt(sessionManager, sessionId, agentDef, modelName)

        const oldCached = sessionManager.getCachedPrompt(sessionId)
        const oldPrompt = oldCached?.systemPrompt

        // Compute unified diff
        const diff = oldPrompt ? computeUnifiedDiff(oldPrompt, newPrompt) : []

        // Baseline: cached tools if present, else the unfiltered registry
        // (all MCP tools, no session overrides) so tool add/remove is visible
        // even before a cached prompt exists.
        const { getToolRegistryForAgent } = await import('../tools/index.js')
        const unfilteredTools = getToolRegistryForAgent(agentDef).definitions
        const toolDiff = computePreviewToolDiff(oldCached?.tools, unfilteredTools, newTools)

        send({
          type: 'context.preview',
          payload: {
            oldPrompt,
            newPrompt,
            oldHash: oldCached?.hash,
            newHash,
            diff,
            ...(toolDiff.length > 0 ? { toolDiff } : {}),
          },
          id: message.id,
        })
      } catch (error) {
        logger.error('Failed to preview dynamic context', {
          error: error instanceof Error ? error.message : 'Unknown error',
          sessionId,
        })
        const reason = error instanceof Error ? error.message : serverT(MSG_UNKNOWN_ERROR)
        send(
          createErrorMessage(
            'ERROR',
            serverT({ en: 'Failed to preview: {{reason}}', fr: 'Échec de l’aperçu : {{reason}}' }, { reason }),
            message.id,
          ),
        )
      }

      break
    }

    case 'context.applyDynamic': {
      const payload = message.payload as { sessionId?: string } | undefined
      const sessionId = payload?.sessionId ?? client.activeSessionId
      if (!sessionId) {
        send(createErrorMessage('NO_SESSION', serverT(MSG_NO_ACTIVE_SESSION), message.id))
        return
      }

      const session = sessionManager.requireSession(sessionId)

      if (session.isRunning) {
        send(
          createErrorMessage(
            'SESSION_RUNNING',
            serverT({
              en: 'Cannot apply dynamic context while session is running',
              fr: 'Impossible d’appliquer le contexte dynamique pendant que la session est en cours',
            }),
            message.id,
          ),
        )
        return
      }

      ;(async () => {
        try {
          const modelName = session.providerModel ?? _providerManager?.getCurrentModel()
          await applyDynamicContext(sessionManager, sessionId, modelName)

          const newContextState = sessionManager.getContextState(sessionId)
          sendForSession(sessionId, createContextStateMessage(newContextState))
          send({ type: 'ack', payload: {}, id: message.id })
        } catch (error) {
          logger.error('Failed to apply dynamic context', { error, sessionId })
          const reason = error instanceof Error ? error.message : serverT(MSG_UNKNOWN_ERROR)
          sendForSession(
            sessionId,
            createChatErrorMessage(
              serverT(
                {
                  en: 'Failed to apply dynamic context: {{reason}}',
                  fr: 'Échec d’application du contexte dynamique : {{reason}}',
                },
                { reason },
              ),
              true,
            ),
          )
          send({ type: 'ack', payload: {}, id: message.id })
        }
      })()

      break
    }

    // =========================================================================
    // Runner (Auto-Loop)
    // =========================================================================

    case 'runner.launch': {
      const launchPayloadEarly = message.payload as
        { workflowId?: string; resumeFrom?: string; sessionId?: string } | undefined
      const sessionId = launchPayloadEarly?.sessionId ?? client.activeSessionId
      if (!sessionId) {
        send(createErrorMessage('NO_SESSION', serverT(MSG_NO_ACTIVE_SESSION), message.id))
        return
      }

      // A manual pick (or any explicit launch) kills the pending auto-launch.
      cancelAutoLaunch(sessionId)

      // Persisting a manual workflow pick for the linked board task: at the
      // post-plan choice point this is the user's explicit decision, so it
      // replaces the default build on In Progress and suppresses the favorite
      // countdown (schedule check below reads workflow_choice).
      {
        const pickedWorkflowId = (message.payload as { workflowId?: string } | undefined)?.workflowId
        if (pickedWorkflowId) {
          try {
            const linkedTaskId = findTaskIdBySession(sessionId)
            const linkedTask = linkedTaskId ? dbGetTaskById(linkedTaskId) : null
            const latestExec = sessionManager.getLatestWorkflowExecution(sessionId)
            const atPlanChoicePoint = !latestExec || latestExec.workflowId === 'plan'
            if (linkedTask && linkedTask.status !== 'done' && atPlanChoicePoint) {
              // The bar PUTs the choice before launching; only write when the
              // value actually changed to avoid double version bumps.
              if (linkedTask.workflowChoice !== pickedWorkflowId) {
                dbSetTaskWorkflowChoice(linkedTask.id, pickedWorkflowId)
              }
            }
          } catch {
            // Board persistence must never block a launch.
          }
        }
      }

      const session = sessionManager.requireSession(sessionId)

      // If running, queue for later processing instead of rejecting
      if (session.isRunning) {
        const launchPayload = message.payload as
          { workflowId?: string; content?: string; attachments?: unknown[] } | undefined
        const content = launchPayload?.content ?? ''
        const attachments = launchPayload?.attachments as Attachment[] | undefined
        const workflowId = launchPayload?.workflowId

        // Build message content with workflow context
        let fullContent = content
        if (workflowId) {
          const workflowInfo = `// Workflow: ${workflowId}`
          fullContent = content ? `${workflowInfo}\n\n${content}` : workflowInfo
        }

        // Queue as ASAP message - will be processed at next turn boundary
        sessionManager.queueMessage(sessionId, 'asap', fullContent, attachments, 'workflow-launch')

        // Return success with queue state, tagged with the target session so
        // the client attributes the queue feedback to the launching pane.
        const queueState = sessionManager.getQueueState(sessionId)
        sendForSession(sessionId, {
          type: 'queue.state',
          payload: { success: true, queueState },
          id: message.id,
        })
        return
      }

      // Skip criteria check when resuming from a user step
      if (!launchPayloadEarly?.resumeFrom) {
        const pendingCriteria = session.criteria.filter((c) => c.status.type !== 'passed')
        if (!launchPayloadEarly?.workflowId && pendingCriteria.length === 0) {
          send(
            createErrorMessage(
              'NO_WORK',
              serverT({ en: 'No pending criteria to work on', fr: 'Aucun critère en attente sur lequel travailler' }),
              message.id,
            ),
          )
          return
        }
      }

      // Check if session is blocked - user intervention resets it
      if (session.phase === 'blocked') {
        logger.info('User launched runner - resetting blocked state', { sessionId })
        // setPhase emits phase.changed event
        sessionManager.setPhase(sessionId, 'build')
      }

      // Parse launch payload
      const launchPayload = message.payload as
        | {
            content?: string
            attachments?: unknown[]
            workflowId?: string
            scope?: string
            subGroup?: string
            resumeFrom?: string
            stepOutput?: Record<string, string>
            params?: Record<string, string>
            userChoice?: string
          }
        | undefined
      const launchAttachments = launchPayload?.attachments as Attachment[] | undefined
      const hasUserContent =
        launchPayload?.content && typeof launchPayload.content === 'string' && launchPayload.content.trim()
      const hasUserAttachments = launchAttachments && launchAttachments.length > 0
      const hasUserMessage = hasUserContent || hasUserAttachments
      const isResume = !!launchPayload?.resumeFrom

      // Create AbortController for this run (abort existing if any - defense in depth)
      // The running-state lifecycle (setRunning + session.running messages) is
      // owned by the shared launcher below.
      const controller = new AbortController()
      const existingController = activeAgents.get(sessionId)
      if (existingController) {
        logger.warn('Aborting existing agent before starting new one', { sessionId })
        existingController.abort()
      }
      activeAgents.set(sessionId, controller)

      // Acknowledge immediately
      send({ type: 'ack', payload: {}, id: message.id })

      // Ensure client is subscribed to EventStore (tab model - additive)
      ensureEventStoreSubscription(sessionId)

      // Run orchestrator asynchronously
      logger.info('Runner launching', { sessionId, isResume })

      // Generate session name if this is the first interaction (fire-and-forget)
      if (!isResume && launchPayload?.workflowId && _providerManager) {
        const session = sessionManager.getSession(sessionId)
        const messageCount = getSessionMessageCount(sessionId)
        if (session && needsNameGeneration(session.metadata?.title, messageCount)) {
          const nameHint =
            launchPayload.workflowId +
            (launchPayload?.params && Object.keys(launchPayload.params).length > 0
              ? ': ' +
                Object.entries(launchPayload.params)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(', ')
              : '')
          generateSessionNameForSession(
            sessionId,
            nameHint,
            {
              sessionManager,
              providerManager: _providerManager,
              broadcastForSession: _broadcastForSession,
              eventStore: getEventStore(),
            },
            controller.signal,
          )
        }
      }

      launchWorkflowRun(
        {
          sessionManager,
          sessionId,
          controller,
          llmClient: llmForSession(sessionId),
          getSessionLLMClient: () => llmForSession(sessionId),
          statsIdentity: statsForSession(sessionId),
          broadcastForSession: (sid, msg) => _broadcastForSession(sid, msg),
          onFinished: () => cleanupAfterTurn(sessionId, controller, sendForSession, true),
        },
        {
          ...(launchPayload?.workflowId ? { workflowId: launchPayload.workflowId } : {}),
          ...(launchPayload?.subGroup ? { subGroup: launchPayload.subGroup } : {}),
          ...(launchPayload?.scope
            ? { scope: launchPayload.scope as import('../../shared/types.js').WorkflowLaunchScope }
            : {}),
          ...(isResume && launchPayload?.resumeFrom ? { resumeFrom: launchPayload.resumeFrom } : {}),
          ...(isResume && launchPayload?.stepOutput ? { stepOutput: launchPayload.stepOutput } : {}),
          ...(isResume && launchPayload?.userChoice ? { userChoice: launchPayload.userChoice } : {}),
          ...(launchPayload?.params ? { params: launchPayload.params } : {}),
          ...(hasUserMessage
            ? {
                content: hasUserContent ? launchPayload!.content! : '',
                ...(hasUserAttachments ? { attachments: launchAttachments! } : {}),
              }
            : {}),
        },
      )

      break
    }

    // =========================================================================
    // Path Confirmation
    // =========================================================================

    case 'path.confirm': {
      send(
        createErrorMessage(
          'DEPRECATED',
          'path.confirm removed. Use REST API: POST /api/sessions/:id/confirm-path',
          message.id,
        ),
      )
      break
    }

    // =========================================================================
    // Ask User
    // =========================================================================

    case 'ask.answer': {
      if (!client.activeSessionId) {
        send(createErrorMessage('NO_SESSION', serverT(MSG_NO_ACTIVE_SESSION), message.id))
        return
      }

      if (!isAskAnswerPayload(message.payload)) {
        send(
          createErrorMessage(
            'INVALID_PAYLOAD',
            serverT({ en: 'Invalid ask.answer payload', fr: 'Payload ask.answer invalide' }),
            message.id,
          ),
        )
        return
      }

      const { callId, answer, skip } = message.payload as { callId: string; answer: string; skip?: boolean }
      const found = provideAnswer(callId, answer, skip)

      if (!found) {
        send(
          createErrorMessage(
            'NOT_FOUND',
            serverT({ en: 'No pending question with that ID', fr: 'Aucune question en attente avec cet ID' }),
            message.id,
          ),
        )
        return
      }

      logger.debug('Ask user answer received', {
        sessionId: client.activeSessionId,
        callId,
        answerLength: answer.length,
      })

      // Just acknowledge - the Promise resolution will resume tool execution automatically.
      send({ type: 'ack', payload: {}, id: message.id })
      break
    }

    // =========================================================================
    // Workflow
    // =========================================================================

    // =========================================================================
    // Favorite-workflow auto-launch: cancel the pending countdown (first
    // keystroke in the chat input, or the countdown's close button)
    // =========================================================================
    case 'workflow.cancel_autolaunch': {
      const payload = message.payload as { sessionId?: string } | undefined
      const sessionId = payload?.sessionId ?? client.activeSessionId
      if (sessionId) cancelAutoLaunch(sessionId)
      send({ type: 'ack', payload: {}, id: message.id })
      break
    }

    // =========================================================================
    // Ask-user auto-answer: cancel every pending countdown in the session
    // (first keystroke in the chat input takes over for the user)
    // =========================================================================
    case 'chat.cancel_autoanswer': {
      const payload = message.payload as { sessionId?: string } | undefined
      const sessionId = payload?.sessionId ?? client.activeSessionId
      if (sessionId) cancelAutoAnswersForSession(sessionId)
      send({ type: 'ack', payload: {}, id: message.id })
      break
    }

    case 'workflow.exit': {
      const payload = message.payload as { sessionId?: string } | undefined
      const exitSessionId = payload?.sessionId ?? client.activeSessionId
      if (!exitSessionId) {
        send(createErrorMessage('NO_SESSION', serverT(MSG_NO_ACTIVE_SESSION), message.id))
        return
      }

      const exitSession = sessionManager.getSession(exitSessionId)
      if (!exitSession) {
        send(createErrorMessage('NOT_FOUND', serverT(MSG_SESSION_NOT_FOUND), message.id))
        return
      }

      // Cancel the active workflow execution regardless of state
      const activeExec = sessionManager.getActiveWorkflowExecution(exitSessionId)
      if (activeExec) {
        sessionManager.cancelWorkflow(
          exitSessionId,
          activeExec.id,
          activeExec.workflowId,
          activeExec.workflowName,
          activeExec.workflowColor,
        )
      } else {
        // Fallback: just change phase
        sessionManager.setPhase(exitSessionId, 'build')
      }

      // Abort any running agent turn
      const controller = activeAgents.get(exitSessionId)
      if (controller) {
        activeAgents.delete(exitSessionId)
        controller.abort()
      }

      // Ensure running state is cleared
      if (exitSession.isRunning) {
        sessionManager.setRunning(exitSessionId, false)
      }

      send({ type: 'ack', payload: {}, id: message.id })
      break
    }

    // =========================================================================
    // LLM Retry
    // =========================================================================

    case 'chat.llm_retry_now': {
      const payload = message.payload as import('../../shared/protocol.js').ChatLLMRetryNowPayload | undefined
      const retrySessionId = payload?.sessionId ?? client.activeSessionId
      if (!retrySessionId) {
        send(createErrorMessage('NO_SESSION', serverT(MSG_NO_ACTIVE_SESSION), message.id))
        return
      }
      // Interrupt the in-flight backoff wait — the stream's next attempt starts immediately
      const interrupted = interruptLLMRetryWait(retrySessionId)
      send({ type: 'ack', payload: { interrupted }, id: message.id })
      break
    }

    case 'chat.retry': {
      const payload = message.payload as import('../../shared/protocol.js').ChatRetryPayload | undefined
      const retrySessionId = payload?.sessionId ?? client.activeSessionId
      if (!retrySessionId) {
        send(createErrorMessage('NO_SESSION', serverT(MSG_NO_ACTIVE_SESSION), message.id))
        return
      }

      // An explicit retry means the user took over — stop any pending countdown.
      cancelAutoLaunch(retrySessionId)
      const retrySession = sessionManager.getSession(retrySessionId)
      if (!retrySession) {
        send(createErrorMessage('NOT_FOUND', serverT(MSG_SESSION_NOT_FOUND), message.id))
        return
      }
      if (retrySession.isRunning) {
        send(createErrorMessage('SESSION_RUNNING', serverT(MSG_SESSION_IS_RUNNING), message.id))
        return
      }
      // Only allow a retry when the last turn actually failed (definitive LLM
      // failure recorded within the retry window) — never an unsolicited turn.
      if (!hasRecentLLMFailure(retrySessionId, 30 * 60_000)) {
        send(
          createErrorMessage(
            'NO_FAILED_TURN',
            serverT({ en: 'No failed turn to retry', fr: 'Aucun tour échoué à relancer' }),
            message.id,
          ),
        )
        return
      }
      // The workflow resume path owns retries for blocked/running workflow
      // executions — a plain turn would fight the workflow state machine
      const latestExec = sessionManager.getLatestWorkflowExecution(retrySessionId)
      if (
        latestExec &&
        (latestExec.status === 'blocked' || latestExec.status === 'running' || latestExec.status === 'waiting')
      ) {
        send(
          createErrorMessage(
            'WORKFLOW_ACTIVE',
            serverT({ en: 'A workflow run is active', fr: 'Un run de workflow est actif' }),
            message.id,
          ),
        )
        return
      }

      // User intervention resets a blocked phase
      if (retrySession.phase === 'blocked') {
        sessionManager.setPhase(retrySessionId, 'build')
      }

      // Re-run the last turn WITHOUT re-adding the user message — the context is
      // already in history, untouched by the failed attempt.
      const controller = new AbortController()
      const existingController = activeAgents.get(retrySessionId)
      if (existingController) {
        logger.warn('Aborting existing agent before retrying turn', { sessionId: retrySessionId })
        existingController.abort()
      }
      activeAgents.set(retrySessionId, controller)

      send({ type: 'ack', payload: {}, id: message.id })
      _startTurnWithCompletionChain(retrySessionId, controller)
      break
    }

    default: {
      send(
        createErrorMessage(
          'UNKNOWN_MESSAGE',
          serverT(
            { en: 'Unknown message type: {{type}}', fr: 'Type de message inconnu : {{type}}' },
            { type: message.type },
          ),
          message.id,
        ),
      )
    }
  }
}
