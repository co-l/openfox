import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'node:http'
import type { ServerMessage } from '../../shared/protocol.js'
import { createServerMessage } from '../../shared/protocol.js'
import { handleTerminalMessage, unsubscribeAllFromTerminal } from './terminal.js'
import type { Config } from '../config.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { SessionManager } from '../session/index.js'
import { getEventStore, getCurrentContextWindowId } from '../events/index.js'
import { buildContextMessagesFromEventHistory, buildMessagesFromStoredEvents, foldPendingConfirmations } from '../events/folding.js'
import type { Provider, ProviderBackend, StatsIdentity, Attachment } from '../../shared/types.js'
import type { ProviderManager } from '../provider-manager.js'
import { createLLMClient } from '../llm/index.js'
import { runChatTurn, createMessageStartEvent, createChatDoneEvent } from '../chat/orchestrator.js'
import { loadAllAgentsDefault, findAgentById } from '../agents/registry.js'
import { runOrchestrator } from '../runner/index.js'
import { maybeAutoCompactContext, performManualContextCompaction } from '../context/auto-compaction.js'
import {
  providePathConfirmation,
  provideAnswer,
  cancelQuestionsForSession,
  cancelPathConfirmationsForSession,
} from '../tools/index.js'
import { logger } from '../utils/logger.js'
import { devServerManager } from '../dev-server/manager.js'
import { onProcessEvent } from '../tools/background-process/manager.js'
import { updateSessionMetadata } from '../db/sessions.js'
import { generateSessionName, needsNameGeneration } from '../session/name-generator.js'
import { generateSessionSummary, needsSummaryGeneration } from '../session/summary-generator.js'
import { getAllInstructions } from '../context/instructions.js'
import { getEnabledSkillMetadata } from '../skills/registry.js'
import { getGlobalConfigDir } from '../../cli/paths.js'
import { getRuntimeConfig } from '../runtime-config.js'
import { requiresAuth, verifyPassword, getAuthConfig, isValidToken } from '../auth.js'
import {
  parseClientMessage,
  serializeServerMessage,
  createErrorMessage,
  createSessionStateMessage,
  createSessionRunningMessage,
  createChatMessageMessage,
  createChatDoneMessage,
  createChatErrorMessage,
  createModeChangedMessage,
  createPhaseChangedMessage,
  createCriteriaUpdatedMessage,
  createContextStateMessage,
  isSessionLoadPayload,
  isChatSendPayload,
  isModeSwitchPayload,
  isCriteriaEditPayload,
  isPathConfirmPayload,
  isAskAnswerPayload,
  storedEventToServerMessage,
  createQueueStateMessage,
  isQueueAsapPayload,
  isQueueCompletionPayload,
  isQueueCancelPayload,
} from './protocol.js'

function getCurrentWindowMessageOptions(sessionId: string): { contextWindowId: string } | undefined {
  const contextWindowId = getCurrentContextWindowId(sessionId)
  return contextWindowId ? { contextWindowId } : undefined
}

/**
 * Get the count of user messages in a session.
 * Used to determine if this is the first user message.
 */
function getSessionMessageCount(sessionId: string): number {
  const eventStore = getEventStore()
  const events = eventStore.getEvents(sessionId)
  
  let count = 0
  for (const event of events) {
    if (event.type === 'message.start') {
      const data = event.data as { role: string }
      if (data.role === 'user') {
        count++
      }
    }
  }
  
  return count
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

// Track active agent AbortControllers by sessionId
const activeAgents = new Map<string, AbortController>()

interface ClientConnection {
  ws: WebSocket
  activeSessionId: string | null                    // Currently viewing session
  globalSubscription: (() => void) | null           // Global all-session subscription unsubscribe
}

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
    const provider = providerManager.getProviders().find(p => p.id === session.providerId)
    if (!provider) {
      // Provider was deleted — clear preference and fall back to global
      logger.warn('Session references deleted provider, falling back to global', {
        sessionId, providerId: session.providerId,
      })
      sessionManager.setSessionProvider(sessionId, null, null)
      sessionLLMClients.delete(sessionId)
      return getLLMClient()
    }

    // Create a new LLM client for this session
    const baseUrl = provider.url.includes('/v1') ? provider.url : `${provider.url}/v1`
    const sessionConfig: Config = {
      ...config,
      llm: { ...config.llm, baseUrl, model: session.providerModel! },
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

    const provider = providerManager.getProviders().find(p => p.id === session.providerId)
    const client = getSessionLLMClient(sessionId)
    return {
      providerId: provider?.id ?? session.providerId!,
      providerName: provider?.name ?? 'Unknown Provider',
      backend: (provider?.backend ?? client.getBackend()) as ProviderBackend,
      model: client.getModel(),
    }
  }

  function invalidateSessionLLMClient(sessionId: string): void {
    sessionLLMClients.delete(sessionId)
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

  const llmForSession = (sessionId: string): LLMClientWithModel =>
    getSessionLLMClient?.(sessionId) ?? getLLMClient()

  const statsForSession = (sessionId: string): StatsIdentity =>
    getSessionStatsIdentity?.(sessionId) ?? resolveStatsIdentity(getLLMClient(), getActiveProvider)

  function startTurnWithCompletionChain(sessionId: string, controller: AbortController) {
    runChatTurn({
      sessionManager,
      sessionId,
      llmClient: llmForSession(sessionId),
      statsIdentity: statsForSession(sessionId),
      signal: controller.signal,
      onMessage: (msg) => broadcastForSession(sessionId, msg),
    }).catch((error) => {
      if (error instanceof Error && error.message === 'Aborted') {
        return
      }
      logger.error('Chat turn error', { error })
    }).finally(() => {
      if (activeAgents.get(sessionId) !== controller) {
        return
      }
      activeAgents.delete(sessionId)

      const asapMsgs = sessionManager.drainAsapMessages(sessionId)
      const nextAsap = asapMsgs[0]
      if (nextAsap) {
        for (const remaining of asapMsgs.slice(1)) {
          sessionManager.queueMessage(sessionId, 'asap', remaining.content, remaining.attachments, remaining.messageKind as 'command' | undefined)
        }
        broadcastForSession(sessionId, createQueueStateMessage(sessionManager.getQueueState(sessionId)))

        const userMessagePayload: { role: 'user'; content: string; attachments?: Attachment[] } = {
          role: 'user',
          content: nextAsap.content,
          ...(nextAsap.attachments ? { attachments: nextAsap.attachments } : {}),
        }
        const userMessage = sessionManager.addMessage(sessionId, userMessagePayload)
        broadcastForSession(sessionId, createChatMessageMessage(userMessage))

        const newController = new AbortController()
        activeAgents.set(sessionId, newController)
        startTurnWithCompletionChain(sessionId, newController)
        return
      }

      const completionMsgs = sessionManager.drainCompletionMessages(sessionId)
      const next = completionMsgs[0]
      if (next) {
        for (const remaining of completionMsgs.slice(1)) {
          sessionManager.queueMessage(sessionId, 'completion', remaining.content, remaining.attachments)
        }
        broadcastForSession(sessionId, createQueueStateMessage(sessionManager.getQueueState(sessionId)))

        const userMessage = sessionManager.addMessage(sessionId, {
          role: 'user',
          content: next.content,
          ...(next.attachments ? { attachments: next.attachments } : {}),
        })
        broadcastForSession(sessionId, createChatMessageMessage(userMessage))

        const newController = new AbortController()
        activeAgents.set(sessionId, newController)
        startTurnWithCompletionChain(sessionId, newController)
        return
      }

      sessionManager.clearMessageQueue(sessionId)
      sessionManager.setRunning(sessionId, false)
      const contextState = sessionManager.getContextState(sessionId)
      broadcastForSession(sessionId, createContextStateMessage(contextState))
    })
  }

  function triggerQueueProcessing(sessionId: string): boolean {
    const currentSession = sessionManager.getSession(sessionId)
    if (!currentSession || currentSession.isRunning) {
      return false
    }

    const queue = sessionManager.getQueueState(sessionId)
    if (queue.length === 0) {
      return false
    }

    const controller = new AbortController()
    activeAgents.set(sessionId, controller)

    sessionManager.setRunning(sessionId, true)
    const eventStore = getEventStore()
    eventStore.append(sessionId, { type: 'running.changed', data: { isRunning: true } })
    broadcastForSession(sessionId, createSessionRunningMessage(true, sessionId))

    const nextAsap = queue.find(m => m.mode === 'asap') ?? queue[0]
    if (nextAsap) {
      sessionManager.cancelQueuedMessage(sessionId, nextAsap.queueId)
      const userMessage = sessionManager.addMessage(sessionId, {
        role: 'user',
        content: nextAsap.content,
        ...(nextAsap.attachments ? { attachments: nextAsap.attachments } : {}),
        ...(nextAsap.messageKind ? { messageKind: nextAsap.messageKind as any } : {}),
      })
      broadcastForSession(sessionId, createChatMessageMessage(userMessage))
    }

    startTurnWithCompletionChain(sessionId, controller)
    return true
  }
  
  // Subscribe to session events and broadcast to relevant clients
  sessionManager.subscribe((event) => {
    const sessionId = 'sessionId' in event ? event.sessionId : 
      'session' in event ? event.session.id : null
    
    if (!sessionId) return
    
    for (const [ws, client] of clients) {
      if (ws.readyState !== WebSocket.OPEN) continue
      
      // Broadcast session.state for session_created events to ALL clients
      // This allows frontend to navigate to newly created sessions even before subscription
      if (event.type === 'session_created') {
        const session = sessionManager.getSession(sessionId)
        if (session) {
          // Get messages from EventStore
          const eventStore = getEventStore()
          const events = eventStore.getEvents(sessionId)
          const messages = events.length > 0
            ? buildMessagesFromStoredEvents(events)
            : []
          const pendingConfirmations = foldPendingConfirmations(events)
          ws.send(serializeServerMessage({ ...createSessionStateMessage(session, messages, pendingConfirmations), sessionId }))
        }
        continue
      }
      
      // For other events, only send to subscribed clients
      if (isSubscribedToSession(client, sessionId)) {
        // Broadcast session.state for session_updated events
        if (event.type === 'session_updated') {
          const session = sessionManager.getSession(sessionId)
          if (session) {
            const eventStore = getEventStore()
            const events = eventStore.getEvents(sessionId)
            const messages = events.length > 0
              ? buildMessagesFromStoredEvents(events)
              : []
            const pendingConfirmations = foldPendingConfirmations(events)
            ws.send(serializeServerMessage({ ...createSessionStateMessage(session, messages, pendingConfirmations), sessionId }))
          }
        }
        
        // Broadcast running state changes in real-time
        if (event.type === 'running_changed') {
          ws.send(serializeServerMessage({ ...createSessionRunningMessage(event.isRunning), sessionId }))
        }
      }
    }
  })
  
  // Broadcast dev server events to all connected clients
  const broadcastAll = (msg: ServerMessage) => {
    const serialized = serializeServerMessage(msg)
    for (const [clientWs] of clients) {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(serialized)
      }
    }
  }

  // Global dev server event listeners — broadcast to all WS clients
  devServerManager.onOutput((workdir, chunk) => {
    broadcastAll(createServerMessage('devServer.output', {
      workdir,
      stream: chunk.stream,
      content: chunk.content,
    }))
  })

  devServerManager.onStateChange((workdir, state, errorMessage) => {
    broadcastAll(createServerMessage('devServer.state', {
      workdir,
      state,
      errorMessage,
    }))
  })

  // Background process event listeners — broadcast to session-specific clients
  onProcessEvent((_processId, msg) => {
    const sessionId = msg.sessionId
    if (!sessionId) return
    // Route to clients subscribed to this session
    for (const [clientWs, client] of clients) {
      if (client.activeSessionId === sessionId) {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(serializeServerMessage(msg))
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
    clients.set(ws, { ws, activeSessionId: null, globalSubscription: null })

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
            ws.send(serializeServerMessage({ ...serverMsg, seq: storedEvent.seq, sessionId: storedEvent.sessionId }))
          }
        }
      } catch (error) {
        logger.debug('Global event subscription ended', { error })
      }
    })()
    
    ws.on('message', async (data) => {
      const message = parseClientMessage(data.toString())
      
      if (!message) {
        ws.send(serializeServerMessage(createErrorMessage('INVALID_MESSAGE', 'Invalid message format')))
        return
      }

      // Handle terminal messages separately
      if (message.type.startsWith('terminal.')) {
        handleTerminalMessage(ws, message as any)
        return
      }
      
      const client = clients.get(ws)!
      
      try {
          await handleClientMessage(ws, client, message, getLLMClient, getActiveProvider, sessionManager, broadcastForSession, providerManager, getSessionLLMClient, getSessionStatsIdentity, llmForSession, statsForSession, startTurnWithCompletionChain)
      } catch (error) {
        logger.error('Error handling client message', { error, type: message.type })
        ws.send(serializeServerMessage(
          createErrorMessage(
            'INTERNAL_ERROR',
            error instanceof Error ? error.message : 'Unknown error',
            message.id
          )
        ))
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
  getLLMClient: () => LLMClientWithModel,
  getActiveProvider: (() => Provider | undefined) | undefined,
  sessionManager: SessionManager,
  broadcastForSession: (sessionId: string, msg: ServerMessage) => void,
  providerManager: ProviderManager | undefined,
  getSessionLLMClient: ((sessionId: string) => LLMClientWithModel) | undefined,
  getSessionStatsIdentity: ((sessionId: string) => StatsIdentity) | undefined,
  llmForSession: (sessionId: string) => LLMClientWithModel,
  statsForSession: (sessionId: string) => StatsIdentity,
  startTurnWithCompletionChain: (sessionId: string, controller: AbortController) => void,
): Promise<void> {
  const send = (msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(serializeServerMessage(msg))
    }
  }

  const sendForSession = (sessionId: string, msg: ServerMessage) => {
    send({ ...msg, sessionId })
  }

  const abortSessionExecution = (sessionId: string, reason: string) => {
    const controller = activeAgents.get(sessionId)
    if (!controller) {
      return false
    }

    activeAgents.delete(sessionId)
    controller.abort()
    cancelQuestionsForSession(sessionId, reason)
    cancelPathConfirmationsForSession(sessionId, reason)
    sessionManager.clearMessageQueue(sessionId)
    sessionManager.setRunning(sessionId, false)
    sendForSession(sessionId, createSessionRunningMessage(false))
    const contextState = sessionManager.getContextState(sessionId)
    sendForSession(sessionId, createContextStateMessage(contextState))
    return true
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
      send(createErrorMessage('DEPRECATED_MESSAGE_TYPE', `${message.type} removed. Use REST API instead. See docs/REST-API.md`, message.id))
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
      logger.debug('Loaded messages from EventStore', { sessionId: session.id, eventCount: events.length, messageCount: messages.length, pendingConfirmationsCount: pendingConfirmations.length })

      sendForSession(session.id, createSessionStateMessage(session, messages, pendingConfirmations, message.id))
      
      // Send context state
      const contextState = sessionManager.getContextState(session.id)
      sendForSession(session.id, createContextStateMessage(contextState))
      break
    }

    // =========================================================================
    // Unified Chat (replaces plan.message, agent.start, etc.) - WS REQUIRED
    // =========================================================================
    
    case 'chat.send': {
      if (!client.activeSessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      
      if (!isChatSendPayload(message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid chat.send payload', message.id))
        return
      }
      
      // Check if session is already running - reject concurrent execution
      const currentSession = sessionManager.requireSession(client.activeSessionId)
      if (currentSession.isRunning) {
        send(createErrorMessage('ALREADY_RUNNING', 'Session is already running', message.id))
        return
      }
      
      // Check if session is blocked - user intervention resets it
      if (currentSession.phase === 'blocked') {
        logger.info('User intervention - resetting blocked state', { sessionId: client.activeSessionId })
        sessionManager.setPhase(client.activeSessionId, 'build')
        sessionManager.resetAllCriteriaAttempts(client.activeSessionId)
        sendForSession(client.activeSessionId, createPhaseChangedMessage('build'))
      }
      
      const sessionId = client.activeSessionId
      const eventStore = getEventStore()

      ensureEventStoreSubscription(sessionId)

      // Create AbortController EARLY so escape works during all phases (including compaction)
      const controller = new AbortController()
      const existingController = activeAgents.get(sessionId)
      if (existingController) {
        logger.warn('Aborting existing agent before starting new one', { sessionId })
        existingController.abort()
      }
      activeAgents.set(sessionId, controller)

      // Mark session as running immediately so UI shows stop button
      sessionManager.setRunning(sessionId, true)
      sendForSession(sessionId, createSessionRunningMessage(true))

      // Acknowledge immediately
      send({ type: 'ack', payload: {}, id: message.id })

      try {
        await maybeAutoCompactContext({
          sessionManager,
          sessionId,
          llmClient: llmForSession(sessionId),
          statsIdentity: statsForSession(sessionId),
          signal: controller.signal,
        })

        // Check if aborted during compaction
        if (controller.signal.aborted) {
          break
        }

        // Add user message with attachments (emits events to EventStore)
        const userMessage = sessionManager.addMessage(sessionId, {
          role: 'user',
          content: message.payload.content,
          ...(message.payload.attachments && { attachments: message.payload.attachments }),
          ...(message.payload.messageKind && { messageKind: message.payload.messageKind }),
          ...(message.payload.isSystemGenerated && { isSystemGenerated: message.payload.isSystemGenerated }),
        })

        // Send user message directly to client (don't rely on EventStore subscription for this)
        sendForSession(sessionId, createChatMessageMessage(userMessage))

        // Check if we need to generate a session name (first message with default/empty title)
        const messageCount = getSessionMessageCount(sessionId)
        if (needsNameGeneration(currentSession.metadata.title, messageCount)) {
          // Generate name in parallel - don't block the chat turn
          // Use the active LLM client (respects user's selected model)
          generateSessionName({
            userMessage: message.payload.content,
            llmClient: llmForSession(sessionId),
            signal: controller.signal,
          })
            .then(async (result) => {
              if (result.success && result.name) {
                // Update DB with the generated name
                updateSessionMetadata(sessionId, { title: result.name })

                // Emit session.name_generated event to EventStore
                eventStore.append(sessionId, {
                  type: 'session.name_generated',
                  data: { name: result.name },
                })

                // Broadcast updated session state to all WebSocket clients
                const updatedSession = sessionManager.getSession(sessionId)
                if (updatedSession) {
                  const events = eventStore.getEvents(sessionId)
                  const messages = buildMessagesFromStoredEvents(events)
                  const pendingConfirmations = foldPendingConfirmations(events)
                  broadcastForSession(sessionId, createSessionStateMessage(updatedSession, messages, pendingConfirmations))
                }

                logger.info('Session name generated', { sessionId, name: result.name })
              }
            })
            .catch((error) => {
              logger.warn('Session name generation failed', { sessionId, error: error instanceof Error ? error.message : error })
              // Don't propagate error - name generation is optional
            })
        }

        // Use NEW orchestrator (events go through EventStore → WS subscription)
        // Completion queue auto-sends next message when turn finishes
        startTurnWithCompletionChain(sessionId, controller)
      } catch (error) {
        // Clean up on failure (including abort during pre-turn phase)
        if (activeAgents.get(sessionId) === controller) {
          activeAgents.delete(sessionId)
        }
        sessionManager.setRunning(sessionId, false)
        sendForSession(sessionId, createSessionRunningMessage(false))
        const contextState = sessionManager.getContextState(sessionId)
        sendForSession(sessionId, createContextStateMessage(contextState))

        if (!(error instanceof Error && error.message === 'Aborted')) {
          logger.error('Chat send pre-turn error', { sessionId, error })
        }
      }

      break
    }

    case 'chat.stop': {
      send(createErrorMessage('DEPRECATED', 'chat.stop removed. Use REST API: POST /api/sessions/:id/stop', message.id))
      break
    }

    // =========================================================================
    // Message Queue
    // =========================================================================

    case 'queue.asap': {
      send(createErrorMessage('DEPRECATED', 'queue.asap removed. Use REST API: POST /api/sessions/:id/queue/asap', message.id))
      break
    }

    case 'queue.completion': {
      send(createErrorMessage('DEPRECATED', 'queue.completion removed. Use REST API: POST /api/sessions/:id/queue/completion', message.id))
      break
    }

    case 'queue.cancel': {
      send(createErrorMessage('DEPRECATED', 'queue.cancel removed. Use REST API: DELETE /api/sessions/:id/queue/:queueId', message.id))
      break
    }

    case 'chat.continue': {
      send(createErrorMessage('DEPRECATED', 'chat.continue removed. Use REST API: POST /api/sessions/:id/continue', message.id))
      break
    }

    // =========================================================================
    // Mode Switching
    // =========================================================================

    case 'mode.switch': {
      send(createErrorMessage('DEPRECATED', 'mode.switch removed. Use REST API: PUT /api/sessions/:id/mode', message.id))
      break
    }
    
    case 'mode.accept': {
      if (!client.activeSessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }

      const session = sessionManager.requireSession(client.activeSessionId)
      const acceptPayload = message.payload as { workflowId?: string; content?: string; attachments?: unknown[] } | undefined

      // If running, queue for later processing instead of rejecting
      if (session.isRunning) {
        const content = acceptPayload?.content ?? ''
        const attachments = acceptPayload?.attachments as Attachment[] | undefined
        const workflowId = acceptPayload?.workflowId

        // Build message content with workflow context
        let fullContent = content
        if (workflowId) {
          const workflowInfo = `// Workflow: ${workflowId}`
          fullContent = content ? `${workflowInfo}\n\n${content}` : workflowInfo
        }

        // Queue as ASAP message - will be processed at next turn boundary
        sessionManager.queueMessage(client.activeSessionId, 'asap', fullContent, attachments, 'workflow-accept')

        // Return success with queue state
        const queueState = sessionManager.getQueueState(client.activeSessionId)
        send({
          type: 'queue.state',
          payload: { success: true, queueState },
          id: message.id,
        })
        return
      }
      
      // Skip criteria check when a specific workflow is requested (workflow's own
      // startCondition will be evaluated by the executor)
      const acceptPayloadEarly = message.payload as { workflowId?: string } | undefined
      if (!acceptPayloadEarly?.workflowId && session.criteria.length === 0) {
        send(createErrorMessage('NO_CRITERIA', 'Cannot accept: no criteria defined', message.id))
        return
      }

      const sessionId = client.activeSessionId
      const eventStore = getEventStore()

      // Acknowledge immediately
      send({ type: 'ack', payload: {}, id: message.id })
      
      // Mark session as running
      sessionManager.setRunning(sessionId, true)
      eventStore.append(sessionId, { type: 'running.changed', data: { isRunning: true } })
      sendForSession(sessionId, createSessionRunningMessage(true))
      
      // Generate summary if needed (summary generation on first entry to builder mode)
      // Only if there are actual conversation messages to summarize
      const currentSession = sessionManager.requireSession(sessionId)
      if (needsSummaryGeneration(currentSession.summary)) {
        const events = eventStore.getEvents(sessionId)
        
        // Filter out system-generated messages (like "Waiting for user input...")
        const nonSystemEvents = events.filter(event => {
          if (event.type !== 'message.start') return true
          return (event.data as any).isSystemGenerated !== true
        })
        
        const contextMessages = buildContextMessagesFromEventHistory(nonSystemEvents)
        const summaryMessages = contextMessages.filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
        
        // Only generate summary if there are conversation messages
        if (summaryMessages.length > 0) {
          const config = getRuntimeConfig()
          const configDir = getGlobalConfigDir(config.mode ?? 'production')
          const skills = await getEnabledSkillMetadata(configDir)
          const { content: instructions } = await getAllInstructions(currentSession.workdir, currentSession.projectId)
          
          generateSessionSummary({
            messages: summaryMessages,
            llmClient: llmForSession(sessionId),
            workdir: currentSession.workdir,
            customInstructions: instructions || undefined,
            skills,
          })
            .then(async (result) => {
              if (result.success && result.summary) {
                // Update DB with the generated summary
                sessionManager.setSummary(sessionId, result.summary)
              }
            })
            .catch((error) => {
              logger.warn('Session summary generation failed', { sessionId, error: error instanceof Error ? error.message : error })
            })
        }
      }

      // Start builder asynchronously (summary already generated on mode.switch if needed)
      ;(async () => {
        let controller: AbortController | null = null
        try {
          // Switch to builder mode and phase
          sessionManager.setMode(sessionId, 'builder')
          sessionManager.setPhase(sessionId, 'build')
          eventStore.append(sessionId, { type: 'mode.changed', data: { mode: 'builder', auto: false, reason: 'Criteria accepted' } })
          eventStore.append(sessionId, { type: 'phase.changed', data: { phase: 'build' } })

          // Create AbortController for builder (abort existing if any - defense in depth)
          controller = new AbortController()
          const existingController = activeAgents.get(sessionId)
          if (existingController) {
            logger.warn('Aborting existing agent before starting new one', { sessionId })
            existingController.abort()
          }
          activeAgents.set(sessionId, controller)

          // Pass user message through to orchestrator (injected after workflow-started marker)
          const acceptPayload = message.payload as { content?: string; attachments?: unknown[]; workflowId?: string } | undefined
          const acceptAttachments = acceptPayload?.attachments as Attachment[] | undefined
          const hasAcceptContent = acceptPayload?.content && typeof acceptPayload.content === 'string' && acceptPayload.content.trim()
          const hasAcceptAttachments = acceptAttachments && acceptAttachments.length > 0
          const hasAcceptMessage = hasAcceptContent || hasAcceptAttachments

          // Auto-start orchestrator (full state machine with verification)
          await runOrchestrator({
            sessionManager,
            sessionId,
            llmClient: llmForSession(sessionId),
            statsIdentity: statsForSession(sessionId),
            injectBuilderKickoff: !hasAcceptMessage,
            ...(acceptPayload?.workflowId ? { workflowId: acceptPayload.workflowId } : {}),
            ...(hasAcceptMessage ? { userMessage: { content: hasAcceptContent ? acceptPayload!.content! : '', ...(hasAcceptAttachments ? { attachments: acceptAttachments! } : {}) } } : {}),
            signal: controller.signal,
            onMessage: (msg) => sendForSession(sessionId, msg),  // For path confirmation dialogs
          })
        } catch (error) {
          if (error instanceof Error && error.message === 'Aborted') {
            return
          }
          logger.error('mode.accept error', { error })
          // Emit error event
          eventStore.append(sessionId, {
            type: 'chat.error',
            data: {
              error: error instanceof Error ? error.message : 'Unknown error',
              recoverable: false,
            },
          })
          const errorMsgId = crypto.randomUUID()
          eventStore.append(sessionId, createMessageStartEvent(errorMsgId, 'user', `Error: ${error instanceof Error ? error.message : 'Unknown error'}`, {
            ...(getCurrentWindowMessageOptions(sessionId) ?? {}),
            isSystemGenerated: true,
            messageKind: 'correction',
          }))
          eventStore.append(sessionId, { type: 'message.done', data: { messageId: errorMsgId } })
          eventStore.append(sessionId, createChatDoneEvent(errorMsgId, 'error'))
        } finally {
          if (!controller || activeAgents.get(sessionId) !== controller) {
            return
          }
          activeAgents.delete(sessionId)

          // Check completion queue before going idle
          const completionMsgs = sessionManager.drainCompletionMessages(sessionId)
          const nextCompletion = completionMsgs[0]
          if (nextCompletion) {
            for (const remaining of completionMsgs.slice(1)) {
              sessionManager.queueMessage(sessionId, 'completion', remaining.content, remaining.attachments)
            }
            sendForSession(sessionId, createQueueStateMessage(sessionManager.getQueueState(sessionId)))
            const userMessage = sessionManager.addMessage(sessionId, {
              role: 'user',
              content: nextCompletion.content,
              ...(nextCompletion.attachments ? { attachments: nextCompletion.attachments } : {}),
            })
            sendForSession(sessionId, createChatMessageMessage(userMessage))
            const newController = new AbortController()
            activeAgents.set(sessionId, newController)
            startTurnWithCompletionChain(sessionId, newController)
            return
          }

          // Drain ASAP queue before going idle - process each as new turn
          const asapMsgs = sessionManager.drainAsapMessages(sessionId)
          const nextAsap = asapMsgs[0]
          if (nextAsap) {
            // Re-queue remaining ASAP messages
            for (const remaining of asapMsgs.slice(1)) {
              sessionManager.queueMessage(sessionId, 'asap', remaining.content, remaining.attachments, remaining.messageKind as 'command' | undefined)
            }
            // Broadcast updated queue state
            sendForSession(sessionId, createQueueStateMessage(sessionManager.getQueueState(sessionId)))

            // Add user message and start new turn
            const userMessage = sessionManager.addMessage(sessionId, {
              role: 'user',
              content: nextAsap.content,
              ...(nextAsap.attachments ? { attachments: nextAsap.attachments } : {}),
            })
            sendForSession(sessionId, createChatMessageMessage(userMessage))

            const newerController = new AbortController()
            activeAgents.set(sessionId, newerController)
            startTurnWithCompletionChain(sessionId, newerController)
            return
          }

          sessionManager.clearMessageQueue(sessionId)
          sessionManager.setRunning(sessionId, false)
          eventStore.append(sessionId, { type: 'running.changed', data: { isRunning: false } })
          const contextState = sessionManager.getContextState(sessionId)
          sendForSession(sessionId, createContextStateMessage(contextState))
        }
      })()
      
      break
    }
    
    // =========================================================================
    // Criteria Editing
    // =========================================================================
    
    case 'criteria.edit': {
      send(createErrorMessage('DEPRECATED', 'criteria.edit removed. Use REST API: PUT /api/sessions/:id/criteria', message.id))
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
          sendForSession(sessionId, createChatErrorMessage(
            `Compaction failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            true
          ))
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
        const launchPayload = message.payload as { workflowId?: string; content?: string; attachments?: unknown[] } | undefined
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
      const pendingCriteria = session.criteria.filter(c => c.status.type !== 'passed')
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
      const launchPayload = message.payload as { content?: string; attachments?: unknown[]; workflowId?: string } | undefined
      const launchAttachments = launchPayload?.attachments as Attachment[] | undefined
      const hasUserContent = launchPayload?.content && typeof launchPayload.content === 'string' && launchPayload.content.trim()
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
        ...(hasUserMessage ? { userMessage: { content: hasUserContent ? launchPayload!.content! : '', ...(hasUserAttachments ? { attachments: launchAttachments! } : {}) } } : {}),
        signal: controller.signal,
        onMessage: (msg) => sendForSession(sessionId, msg),  // For path confirmation dialogs
      }).catch((error) => {
        // Don't create error message for controlled abort
        if (error instanceof Error && error.message === 'Aborted') {
          return
        }
        logger.error('Runner error', { error, sessionId })
        // Error events are handled inside runOrchestrator and appended to EventStore
      }).finally(() => {
        if (activeAgents.get(sessionId) !== controller) {
          return
        }
        activeAgents.delete(sessionId)

        // Drain ASAP queue FIRST - process each as new turn before checking completion queue
        const asapMsgs = sessionManager.drainAsapMessages(sessionId)
        const nextAsap = asapMsgs[0]
        if (nextAsap) {
          // Re-queue remaining ASAP messages
          for (const remaining of asapMsgs.slice(1)) {
            sessionManager.queueMessage(sessionId, 'asap', remaining.content, remaining.attachments, remaining.messageKind as 'command' | undefined)
          }
          // Broadcast updated queue state
          sendForSession(sessionId, createQueueStateMessage(sessionManager.getQueueState(sessionId)))

          // Add user message and start new turn
          const userMessage = sessionManager.addMessage(sessionId, {
            role: 'user',
            content: nextAsap.content,
            ...(nextAsap.attachments ? { attachments: nextAsap.attachments } : {}),
          })
          sendForSession(sessionId, createChatMessageMessage(userMessage))

          const newerController = new AbortController()
          activeAgents.set(sessionId, newerController)
          startTurnWithCompletionChain(sessionId, newerController)
          return
        }

        // Check completion queue before going idle
        const completionMsgs = sessionManager.drainCompletionMessages(sessionId)
        const nextCompletion = completionMsgs[0]
        if (nextCompletion) {
          for (const remaining of completionMsgs.slice(1)) {
            sessionManager.queueMessage(sessionId, 'completion', remaining.content, remaining.attachments)
          }
          sendForSession(sessionId, createQueueStateMessage(sessionManager.getQueueState(sessionId)))
          const userMessage = sessionManager.addMessage(sessionId, {
            role: 'user',
            content: nextCompletion.content,
            ...(nextCompletion.attachments ? { attachments: nextCompletion.attachments } : {}),
          })
          sendForSession(sessionId, createChatMessageMessage(userMessage))
          const newController = new AbortController()
          activeAgents.set(sessionId, newController)
          startTurnWithCompletionChain(sessionId, newController)
          return
        }

        sessionManager.clearMessageQueue(sessionId)
        sessionManager.setRunning(sessionId, false)
      })
      
      break
    }
    
    // =========================================================================
    // Path Confirmation
    // =========================================================================

    case 'path.confirm': {
      send(createErrorMessage('DEPRECATED', 'path.confirm removed. Use REST API: POST /api/sessions/:id/confirm-path', message.id))
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
        answerLength: answer.length 
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
