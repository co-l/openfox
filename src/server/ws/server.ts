import { WebSocketServer, WebSocket } from 'ws'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import type { Server } from 'node:http'
import type { ServerMessage } from '../../shared/protocol.js'
import type { GitDiffFile } from '../../shared/protocol.js'
import { createServerMessage } from '../../shared/protocol.js'
import { handleTerminalMessage, unsubscribeAllFromTerminal } from './terminal.js'
import type { Config } from '../config.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { SessionManager } from '../session/index.js'
import { getEventStore } from '../events/index.js'

import type { Message, Provider, ProviderBackend, StatsIdentity, Attachment } from '../../shared/types.js'
import type { ProviderManager } from '../provider-manager.js'
import { runChatTurn } from '../chat/orchestrator.js'

import { runOrchestrator } from '../runner/index.js'
import { appendCompactionPrompt } from '../context/compactor.js'
import { computeSessionHash, applyDynamicContext } from '../chat/dynamic-context.js'
import { provideAnswer } from '../tools/index.js'
import { logger } from '../utils/logger.js'
import { devServerManager } from '../dev-server/manager.js'
import { onProcessEvent } from '../tools/background-process/manager.js'

// Resolved once initial MCP connections settle — checkDynamic awaits this
let resolveMcpReady: (() => void) | null = null
const mcpReadyPromise = new Promise<void>((resolve) => {
  resolveMcpReady = resolve
})

export function signalMcpReady(): void {
  resolveMcpReady?.()
}

import { getAuthConfig, isValidToken } from '../auth.js'
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
    const diffProc = spawn('git', ['diff', '--name-status', 'HEAD'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const statusProc = spawn('git', ['status', '--porcelain'], {
      cwd,
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

  return {
    providerId: provider?.id ?? `provider:${model}`,
    providerName: provider?.name ?? 'Unknown Provider',
    backend,
    model,
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
): WebSocketServerExports {
  const wss = new WebSocketServer({ server: httpServer })
  const clients = new Map<WebSocket, ClientConnection>()
  moduleClients = clients

  // Per-session LLM client cache: sessionId -> { cacheKey, client }
  const sessionLLMClients = new Map<string, { key: string; client: LLMClientWithModel }>()

  function getSessionLLMClient(sessionId: string): LLMClientWithModel {
    const session = sessionManager.getSession(sessionId)
    if (!session?.providerId || !session?.providerModel || !providerManager) {
      return getLLMClient()
    }

    const resolvedModel = providerManager.resolveModel(session.providerId, session.providerModel)
    const effectiveModel = resolvedModel ?? session.providerModel
    const cacheKey = `${session.providerId}:${effectiveModel}`
    const cached = sessionLLMClients.get(sessionId)
    if (cached && cached.key === cacheKey) {
      return cached.client
    }

    // Look up the provider to get URL, apiKey, backend
    const provider = providerManager.getProviders().find((p) => p.id === session.providerId)
    if (!provider) {
      // Provider was deleted — clear preference and fall back to global
      logger.warn('Session references deleted provider, falling back to global', {
        sessionId,
        providerId: session.providerId,
      })
      sessionManager.setSessionProvider(sessionId, null, null)
      sessionLLMClients.delete(sessionId)
      return getLLMClient()
    }

    // Let ProviderManager create the session client so provider-specific
    // transports (for example External Provider custom) and auth context are preserved.
    const client = providerManager.createClient(session.providerId, effectiveModel)
    if (!client) {
      logger.warn('Could not create session provider client, falling back to global', {
        sessionId,
        providerId: session.providerId,
        model: session.providerModel,
      })
      return getLLMClient()
    }

    const concreteModel = client.getModel()
    if (session.providerModel !== concreteModel) {
      sessionManager.setSessionProvider(sessionId, session.providerId, concreteModel)
    }
    sessionLLMClients.set(sessionId, { key: `${session.providerId}:${concreteModel}`, client })
    return client
  }

  function getSessionStatsIdentity(sessionId: string): StatsIdentity {
    const session = sessionManager.getSession(sessionId)
    if (!session?.providerId || !providerManager) {
      return resolveStatsIdentity(getLLMClient(), getActiveProvider)
    }

    const provider = providerManager.getProviders().find((p) => p.id === session.providerId)
    const client = getSessionLLMClient(sessionId)
    return {
      providerId: provider?.id ?? session.providerId!,
      providerName: provider?.name ?? 'Unknown Provider',
      backend: (provider?.backend ?? client.getBackend()) as ProviderBackend,
      model: client.getModel(),
    }
  }

  const isSubscribedToSession = (client: ClientConnection, sessionId: string) => {
    return client.activeSessionId === sessionId
  }

  const broadcastForSession = (sessionId: string, msg: ServerMessage) => {
    for (const [clientWs, client] of clients) {
      if (isSubscribedToSession(client, sessionId) && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(serializeServerMessage({ ...msg, sessionId }))
      }
    }
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

  // Broadcast dev server events to all connected clients
  const broadcastAll = (msg: ServerMessage) => {
    const serialized = serializeServerMessage(msg)
    for (const [clientWs, client] of clients) {
      if (clientWs.readyState === WebSocket.OPEN) {
        const seq = client.lastSentSeq + 1
        enqueueSend(client, serialized, seq)
      }
    }
  }

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

  devServerManager.onStateChange((workdir, state, errorMessage) => {
    broadcastAll(
      createServerMessage('devServer.state', {
        workdir,
        state,
        errorMessage,
      }),
    )
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
          serializeServerMessage(createErrorMessage('INVALID_MESSAGE', 'Invalid message format')),
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
        )
      } catch (error) {
        logger.error('Error handling client message', { error, type: message.type })
        const client = clients.get(ws)!
        const seq = client.lastSentSeq + 1
        enqueueSend(
          client,
          serializeServerMessage(
            createErrorMessage('INTERNAL_ERROR', error instanceof Error ? error.message : 'Unknown error', message.id),
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
    broadcastAll,
  }
}

export interface WebSocketServerExports {
  wss: WebSocketServer
  abortSession: (sessionId: string) => boolean
  close: (cb?: () => void) => void
  broadcastForSession: (sessionId: string, msg: ServerMessage) => void
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
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid session.load payload', message.id))
        return
      }

      const session = sessionManager.getSession(message.payload.sessionId)
      if (!session) {
        send(createErrorMessage('NOT_FOUND', 'Session not found', message.id))
        return
      }

      // Tab model: set active session for event routing
      client.activeSessionId = session.id
      const effectiveWorkdir = session.worktree ?? session.workdir
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

      // Acknowledge without sending full session data
      // Frontend should use REST API to fetch session data
      send({ type: 'ack', payload: { sessionId: session.id }, id: message.id })

      // Send context.state
      const sendContextState = () => {
        const contextState = sessionManager.getContextState(session.id)
        send(createContextStateMessage(contextState))
      }
      sendContextState()

      // Re-detect dynamic context changes on load (survives server restart)
      const cachedHash = sessionManager.getCachedPrompt(session.id)?.hash
      if (cachedHash) {
        ;(async () => {
          try {
            await mcpReadyPromise
            const currentHash = await computeSessionHash(sessionManager, session.id)
            if (currentHash !== cachedHash) {
              sessionManager.setDynamicContextChanged(session.id, true)
              sendContextState()
            } else if (sessionManager.getDynamicContextChanged(session.id)) {
              sessionManager.setDynamicContextChanged(session.id, false)
              sendContextState()
            }
          } catch {
            // Non-critical — banner just won't appear on reload
          }
        })()
      }
      break
    }

    // =========================================================================
    // Context Management
    // =========================================================================

    case 'context.compact': {
      if (!client.activeSessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }

      const session = sessionManager.requireSession(client.activeSessionId)
      const sessionId = client.activeSessionId

      // Check if session is running
      if (session.isRunning) {
        send(createErrorMessage('SESSION_RUNNING', 'Cannot compact while session is running', message.id))
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
          sendForSession(
            sessionId,
            createChatErrorMessage(
              `Compaction failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }

      const sessionId = client.activeSessionId

      ;(async () => {
        try {
          await mcpReadyPromise
          const currentHash = await computeSessionHash(sessionManager, sessionId)
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

    case 'context.applyDynamic': {
      if (!client.activeSessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }

      const sessionId = client.activeSessionId
      const session = sessionManager.requireSession(sessionId)

      if (session.isRunning) {
        send(createErrorMessage('SESSION_RUNNING', 'Cannot apply dynamic context while session is running', message.id))
        return
      }

      ;(async () => {
        try {
          await applyDynamicContext(sessionManager, sessionId)

          const newContextState = sessionManager.getContextState(sessionId)
          sendForSession(sessionId, createContextStateMessage(newContextState))
          send({ type: 'ack', payload: {}, id: message.id })
        } catch (error) {
          logger.error('Failed to apply dynamic context', { error, sessionId })
          sendForSession(
            sessionId,
            createChatErrorMessage(
              `Failed to apply dynamic context: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
      if (!client.activeSessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }

      const session = sessionManager.requireSession(client.activeSessionId)

      // If running, queue for later processing instead of rejecting
      if (session.isRunning) {
        const launchPayload = message.payload as
          | { workflowId?: string; content?: string; attachments?: unknown[] }
          | undefined
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
        sessionManager.queueMessage(client.activeSessionId, 'asap', fullContent, attachments, 'workflow-launch')

        // Return success with queue state
        const queueState = sessionManager.getQueueState(client.activeSessionId)
        send({
          type: 'queue.state',
          payload: { success: true, queueState },
          id: message.id,
        })
        return
      }

      // Check if there are pending criteria (skip when a specific workflow is
      // requested — the workflow's own startCondition handles validation)
      const launchPayloadEarly = message.payload as { workflowId?: string } | undefined
      const pendingCriteria = session.criteria.filter((c) => c.status.type !== 'passed')
      if (!launchPayloadEarly?.workflowId && pendingCriteria.length === 0) {
        send(createErrorMessage('NO_WORK', 'No pending criteria to work on', message.id))
        return
      }

      const sessionId = client.activeSessionId

      // Check if session is blocked - user intervention resets it
      if (session.phase === 'blocked') {
        logger.info('User launched runner - resetting blocked state', { sessionId })
        // setPhase emits phase.changed event
        sessionManager.setPhase(sessionId, 'build')
      }

      // Parse launch payload
      const launchPayload = message.payload as
        | { content?: string; attachments?: unknown[]; workflowId?: string; subGroup?: string }
        | undefined
      const launchAttachments = launchPayload?.attachments as Attachment[] | undefined
      const hasUserContent =
        launchPayload?.content && typeof launchPayload.content === 'string' && launchPayload.content.trim()
      const hasUserAttachments = launchAttachments && launchAttachments.length > 0
      const hasUserMessage = hasUserContent || hasUserAttachments

      // Mark session as running (emits running.changed event)
      sessionManager.setRunning(sessionId, true)
      sendForSession(sessionId, createSessionRunningMessage(true))

      // Create AbortController for this run (abort existing if any - defense in depth)
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
      logger.info('Runner launching', { sessionId, pendingCriteria: pendingCriteria.length })

      runOrchestrator({
        sessionManager,
        sessionId,
        llmClient: llmForSession(sessionId),
        statsIdentity: statsForSession(sessionId),
        injectWorkflowKickoff: !hasUserMessage,
        ...(launchPayload?.workflowId ? { workflowId: launchPayload.workflowId } : {}),
        ...(launchPayload?.subGroup ? { subGroup: launchPayload.subGroup } : {}),
        ...(hasUserMessage
          ? {
              userMessage: {
                content: hasUserContent ? launchPayload!.content! : '',
                ...(hasUserAttachments ? { attachments: launchAttachments! } : {}),
              },
            }
          : {}),
        signal: controller.signal,
        onMessage: (msg) => sendForSession(sessionId, msg), // For path confirmation dialogs
      })
        .catch((error) => {
          // Don't create error message for controlled abort
          if (error instanceof Error && error.message === 'Aborted') {
            return
          }
          logger.error('Runner error', { error, sessionId })
          // Error events are handled inside runOrchestrator and appended to EventStore
        })
        .finally(() => {
          try {
            // Runner orchestrator bypasses runChatTurn, so isRunning must be cleared here
            sessionManager.setRunning(sessionId, false)
            sendForSession(sessionId, createSessionRunningMessage(false))
            cleanupAfterTurn(sessionId, controller, sendForSession, true)
          } catch {
            // Session may have been deleted during execution
          }
        })

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
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }

      if (!isAskAnswerPayload(message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid ask.answer payload', message.id))
        return
      }

      const { callId, answer, skip } = message.payload as { callId: string; answer: string; skip?: boolean }
      const found = provideAnswer(callId, answer, skip)

      if (!found) {
        send(createErrorMessage('NOT_FOUND', 'No pending question with that ID', message.id))
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

    default: {
      send(createErrorMessage('UNKNOWN_MESSAGE', `Unknown message type: ${message.type}`, message.id))
    }
  }
}
