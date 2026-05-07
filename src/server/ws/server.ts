import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'node:http'
import type { ServerMessage } from '../../shared/protocol.js'
import { createServerMessage } from '../../shared/protocol.js'
import { handleTerminalMessage, unsubscribeAllFromTerminal } from './terminal.js'
import type { Config } from '../config.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { SessionManager } from '../session/index.js'
import { getEventStore } from '../events/index.js'
import { buildMessagesFromStoredEvents, foldPendingConfirmations } from '../events/folding.js'
import type { Message, Provider, ProviderBackend, StatsIdentity, Attachment } from '../../shared/types.js'
import type { ProviderManager } from '../provider-manager.js'
import { createLLMClient } from '../llm/index.js'
import { runChatTurn } from '../chat/orchestrator.js'

import { runOrchestrator } from '../runner/index.js'
import { performManualContextCompaction } from '../context/auto-compaction.js'
import { provideAnswer } from '../tools/index.js'
import { logger } from '../utils/logger.js'
import { devServerManager } from '../dev-server/manager.js'
import { onProcessEvent } from '../tools/background-process/manager.js'

import { getAuthConfig, isValidToken } from '../auth.js'
import {
  parseClientMessage,
  serializeServerMessage,
  createErrorMessage,
  createSessionStateMessage,
  createSessionRunningMessage,
  createChatMessageMessage,
  createChatErrorMessage,
  createContextStateMessage,
  isSessionLoadPayload,
  isAskAnswerPayload,
  storedEventToServerMessage,
  createQueueStateMessage,
} from './protocol.js'

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

interface ClientConnection {
  ws: WebSocket
  activeSessionId: string | null // Currently viewing session
  globalSubscription: (() => void) | null // Global all-session subscription unsubscribe
  sendQueue: Array<{ data: string; seq: number }> // FIFO queue for ordered sends
  isSending: boolean // True while a send is in progress
  lastSentSeq: number // Last sequence number sent
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
  config: Config,
  getLLMClient: () => LLMClientWithModel,
  getActiveProvider: (() => Provider | undefined) | undefined,
  sessionManager: SessionManager,
  providerManager?: ProviderManager,
): WebSocketServerExports {
  const wss = new WebSocketServer({ server: httpServer })
  const clients = new Map<WebSocket, ClientConnection>()

  // Per-session LLM client cache: sessionId -> { cacheKey, client }
  const sessionLLMClients = new Map<string, { key: string; client: LLMClientWithModel }>()

  function getSessionLLMClient(sessionId: string): LLMClientWithModel {
    const session = sessionManager.getSession(sessionId)
    if (!session?.providerId || !session?.providerModel || !providerManager) {
      return getLLMClient()
    }

    const cacheKey = `${session.providerId}:${session.providerModel}`
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

    // Create a new LLM client for this session
    const baseUrl = provider.url.includes('/v1') ? provider.url : `${provider.url}/v1`
    const sessionConfig: Config = {
      ...config,
      llm: {
        ...config.llm,
        baseUrl,
        model: session.providerModel!,
        ...(provider.apiKey && { apiKey: provider.apiKey }),
      },
    }
    const client = createLLMClient(sessionConfig)
    // Set backend from provider (skip auto-detect for cached clients)
    if (provider.backend !== 'auto') {
      client.setBackend(provider.backend as import('../llm/index.js').Backend)
    }
    client.setModel(session.providerModel!)

    sessionLLMClients.set(sessionId, { key: cacheKey, client })
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
    sessionManager.setRunning(sessionId, false)
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
        cleanupAfterTurn(sessionId, controller, broadcastForSession, false)
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
      // Unsubscribe from global all-session subscription
      if (client?.globalSubscription) {
        client.globalSubscription()
      }
      // Unsubscribe from all terminal sessions
      unsubscribeAllFromTerminal(ws)
      // Clear send queue
      if (client) {
        client.sendQueue = []
        client.isSending = false
      }
      clients.delete(ws)
    })

    ws.on('error', (error) => {
      logger.error('WebSocket error', { error })
    })
  })

  return {
    wss,
    abortSession: (sessionId: string) => {
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
  }
}

export interface WebSocketServerExports {
  wss: WebSocketServer
  abortSession: (sessionId: string) => boolean
  close: (cb?: () => void) => void
  broadcastForSession: (sessionId: string, msg: ServerMessage) => void
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
    // Session Load - Required for WS subscription mechanism
    // Note: This is kept ONLY to set activeSessionId for event routing.
    // For actual data loading, use REST API: GET /api/sessions/:id
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

      // Tab model: set active session and subscribe if not already subscribed
      client.activeSessionId = session.id
      ensureEventStoreSubscription(session.id)

      // Fetch messages from EventStore
      const eventStore = getEventStore()
      const events = eventStore.getEvents(session.id)
      const messages = buildMessagesFromStoredEvents(events)
      const pendingConfirmations = foldPendingConfirmations(events)
      logger.debug('Loaded messages from EventStore', {
        sessionId: session.id,
        eventCount: events.length,
        messageCount: messages.length,
        pendingConfirmationsCount: pendingConfirmations.length,
      })

      sendForSession(session.id, createSessionStateMessage(session, messages, pendingConfirmations, message.id))

      // Send context state
      const contextState = sessionManager.getContextState(session.id)
      sendForSession(session.id, createContextStateMessage(contextState))
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

      const contextState = sessionManager.getContextState(sessionId)
      const tokensBefore = contextState.currentTokens

      // Acknowledge immediately
      send({ type: 'ack', payload: {}, id: message.id })

      // Perform compaction asynchronously
      ;(async () => {
        try {
          await performManualContextCompaction({
            sessionManager,
            sessionId,
            llmClient: llmForSession(sessionId),
            statsIdentity: statsForSession(sessionId),
            tokenCountAtClose: tokensBefore,
          })

          // Send updated context state
          const newContextState = sessionManager.getContextState(sessionId)
          sendForSession(sessionId, createContextStateMessage(newContextState))

          // Send updated session state so client sees all messages
          const updatedSession = sessionManager.requireSession(sessionId)
          const compactEventStore = getEventStore()
          const compactEvents = compactEventStore.getEvents(sessionId)
          const compactMessages = buildMessagesFromStoredEvents(compactEvents)
          const pendingConfirmations = foldPendingConfirmations(compactEvents)
          sendForSession(sessionId, createSessionStateMessage(updatedSession, compactMessages, pendingConfirmations))
        } catch (error) {
          logger.error('Compaction failed', { error, sessionId })
          sendForSession(
            sessionId,
            createChatErrorMessage(
              `Compaction failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
              true,
            ),
          )
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

      // Only allow launching from builder mode
      if (session.mode !== 'builder') {
        send(createErrorMessage('INVALID_MODE', 'Runner can only be launched in builder mode', message.id))
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
        sessionManager.resetAllCriteriaAttempts(sessionId)
      }

      // Parse launch payload
      const launchPayload = message.payload as
        | { content?: string; attachments?: unknown[]; workflowId?: string }
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
        injectBuilderKickoff: !hasUserMessage,
        ...(launchPayload?.workflowId ? { workflowId: launchPayload.workflowId } : {}),
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
          cleanupAfterTurn(sessionId, controller, sendForSession, true)
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

      const { callId, answer } = message.payload
      const found = provideAnswer(callId, answer)

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
