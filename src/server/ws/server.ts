import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'node:http'
import type { ServerMessage } from '../../shared/protocol.js'
import { createServerMessage } from '../../shared/protocol.js'
import type { Config } from '../config.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { ToolRegistry } from '../tools/index.js'
import type { SessionManager } from '../session/index.js'
import { getEventStore, getCurrentContextWindowId, getRecentUserPromptsForSession } from '../events/index.js'
import { buildContextMessagesFromEventHistory, buildMessagesFromStoredEvents } from '../events/folding.js'
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
import {
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject,
} from '../db/projects.js'
import { getSetting, setSetting } from '../db/settings.js'
import { updateSessionMetadata } from '../db/sessions.js'
import { generateSessionName, needsNameGeneration } from '../session/name-generator.js'
import { generateSessionSummary, needsSummaryGeneration } from '../session/summary-generator.js'
// Messages are now retrieved from EventStore, not DB
import {
  parseClientMessage,
  serializeServerMessage,
  createErrorMessage,
  createSessionStateMessage,
  createSessionListMessage,
  createSessionRunningMessage,
  createProjectStateMessage,
  createProjectListMessage,
  createChatMessageMessage,
  createChatDoneMessage,
  createChatErrorMessage,
  createModeChangedMessage,
  createPhaseChangedMessage,
  createCriteriaUpdatedMessage,
  createContextStateMessage,
  isProjectCreatePayload,
  isProjectCreateWithDirPayload,
  isProjectLoadPayload,
  isProjectUpdatePayload,
  isProjectDeletePayload,
  isSessionCreatePayload,
  isSessionLoadPayload,
  isChatSendPayload,
  isModeSwitchPayload,
  isCriteriaEditPayload,
  isPathConfirmPayload,
  isAskAnswerPayload,
  isSettingsGetPayload,
  isSettingsSetPayload,
  isSessionSetProviderPayload,
  createSettingsValueMessage,
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
  subscribedSessions: Map<string, () => void>       // sessionId -> unsubscribe fn (old event system)
  eventStoreSubscriptions: Map<string, () => void>  // sessionId -> unsubscribe fn (new EventStore)
}

export function createWebSocketServer(
  httpServer: Server,
  config: Config,
  getLLMClient: () => LLMClientWithModel,
  getActiveProvider: (() => Provider | undefined) | undefined,
  toolRegistry: ToolRegistry,
  sessionManager: SessionManager,
  providerManager?: ProviderManager,
): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' })
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
    return client.activeSessionId === sessionId || client.eventStoreSubscriptions.has(sessionId)
  }
  
  const broadcastForSession = (sessionId: string, msg: ServerMessage) => {
    for (const [clientWs, client] of clients) {
      if (isSubscribedToSession(client, sessionId) && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(serializeServerMessage({ ...msg, sessionId }))
      }
    }
  }
  
  // Subscribe to session events and broadcast to relevant clients
  sessionManager.subscribe((event) => {
    const sessionId = 'sessionId' in event ? event.sessionId : 
      'session' in event ? event.session.id : null
    
    if (!sessionId) return
    
    for (const [ws, client] of clients) {
      // Send events to all clients subscribed to this session (tab model)
      if (isSubscribedToSession(client, sessionId) && ws.readyState === WebSocket.OPEN) {
        // Only broadcast session.state for session_updated (not mode_changed)
        // mode_changed is handled via the event queue to maintain ordering during streaming
        if (event.type === 'session_updated') {
          const session = sessionManager.getSession(sessionId)
          if (session) {
            // Get messages from EventStore
            const eventStore = getEventStore()
            const events = eventStore.getEvents(sessionId)
            const messages = events.length > 0
              ? buildMessagesFromStoredEvents(events)
              : []
            ws.send(serializeServerMessage({ ...createSessionStateMessage(session, messages), sessionId }))
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

  wss.on('connection', (ws) => {
    logger.debug('WebSocket client connected')
    clients.set(ws, { ws, activeSessionId: null, subscribedSessions: new Map(), eventStoreSubscriptions: new Map() })
    
    ws.on('message', async (data) => {
      const message = parseClientMessage(data.toString())
      
      if (!message) {
        ws.send(serializeServerMessage(createErrorMessage('INVALID_MESSAGE', 'Invalid message format')))
        return
      }
      
      const client = clients.get(ws)!
      
      try {
          await handleClientMessage(ws, client, message, config, getLLMClient, getActiveProvider, toolRegistry, sessionManager, broadcastForSession, providerManager, getSessionLLMClient, getSessionStatsIdentity, invalidateSessionLLMClient)
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
      // Unsubscribe from all session events (both old and new systems)
      if (client) {
        for (const unsubscribe of client.subscribedSessions.values()) {
          unsubscribe()
        }
        for (const unsubscribe of client.eventStoreSubscriptions.values()) {
          unsubscribe()
        }
      }
      clients.delete(ws)
    })
    
    ws.on('error', (error) => {
      logger.error('WebSocket error', { error })
    })
  })
  
  return wss
}

async function handleClientMessage(
  ws: WebSocket,
  client: ClientConnection,
  message: { id: string; type: string; payload: unknown },
  config: Config,
  getLLMClient: () => LLMClientWithModel,
  getActiveProvider: (() => Provider | undefined) | undefined,
  toolRegistry: ToolRegistry,
  sessionManager: SessionManager,
  broadcastForSession: (sessionId: string, msg: ServerMessage) => void,
  providerManager?: ProviderManager,
  getSessionLLMClient?: (sessionId: string) => LLMClientWithModel,
  getSessionStatsIdentity?: (sessionId: string) => StatsIdentity,
  invalidateSessionLLMClient?: (sessionId: string) => void,
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

  // Per-session LLM resolution helpers
  const llmForSession = (sessionId: string): LLMClientWithModel =>
    getSessionLLMClient?.(sessionId) ?? getLLMClient()

  const statsForSession = (sessionId: string): StatsIdentity =>
    getSessionStatsIdentity?.(sessionId) ?? resolveStatsIdentity(getLLMClient(), getActiveProvider)

  /**
   * Start a chat turn with completion queue continuation.
   * When a turn finishes, checks for queued completion messages and auto-starts the next turn.
   */
  const startTurnWithCompletionChain = (sessionId: string, controller: AbortController) => {
    runChatTurn({
      sessionManager,
      sessionId,
      llmClient: llmForSession(sessionId),
      statsIdentity: statsForSession(sessionId),
      signal: controller.signal,
      onMessage: (msg) => sendForSession(sessionId, msg),
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

      // Check completion queue before going idle
      const completionMsgs = sessionManager.drainCompletionMessages(sessionId)
      const next = completionMsgs[0]
      if (next) {
        // Re-queue remaining completion messages
        for (const remaining of completionMsgs.slice(1)) {
          sessionManager.queueMessage(sessionId, 'completion', remaining.content, remaining.attachments)
        }
        // Broadcast updated queue state
        sendForSession(sessionId, createQueueStateMessage(sessionManager.getQueueState(sessionId)))

        // Add user message and start new turn
        const userMessage = sessionManager.addMessage(sessionId, {
          role: 'user',
          content: next.content,
          ...(next.attachments ? { attachments: next.attachments } : {}),
        })
        sendForSession(sessionId, createChatMessageMessage(userMessage))

        const newController = new AbortController()
        activeAgents.set(sessionId, newController)
        startTurnWithCompletionChain(sessionId, newController)
        return // Keep isRunning=true
      }

      // No more queued messages — go idle
      sessionManager.clearMessageQueue(sessionId)
      sessionManager.setRunning(sessionId, false)
      const contextState = sessionManager.getContextState(sessionId)
      sendForSession(sessionId, createContextStateMessage(contextState))
    })
  }

  const ensureEventStoreSubscription = (sessionId: string) => {
    if (client.eventStoreSubscriptions.has(sessionId)) {
      return
    }

    const sid = sessionId
    const eventStore = getEventStore()
    const { iterator, unsubscribe } = eventStore.subscribe(sid)
    client.eventStoreSubscriptions.set(sessionId, unsubscribe)

    ;(async () => {
      try {
        for await (const storedEvent of iterator) {
          const serverMsg = storedEventToServerMessage(storedEvent)
          if (serverMsg && ws.readyState === WebSocket.OPEN) {
            ws.send(serializeServerMessage({ ...serverMsg, seq: storedEvent.seq, sessionId: sid }))
          }
        }
      } catch (error) {
        logger.debug('EventStore subscription ended', { sessionId: sid, error })
      }
    })()

    logger.debug('Subscribed to EventStore', { sessionId })
  }
  
  switch (message.type) {
    // =========================================================================
    // Project Management
    // =========================================================================
    
    case 'project.create': {
      if (!isProjectCreatePayload(message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid project.create payload', message.id))
        return
      }
      
      const project = createProject(message.payload.name, message.payload.workdir)
      send(createProjectStateMessage(project, message.id))
      break
    }
    
    case 'project.create-with-dir': {
      logger.debug('WS project.create-with-dir received', { payload: message.payload })
      if (!isProjectCreateWithDirPayload(message.payload)) {
        logger.error('WS project.create-with-dir invalid payload')
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid project.create-with-dir payload', message.id))
        return
      }
      
      try {
        const workdir = config.workdir
        logger.debug('WS creating project directory', { name: message.payload.name, workdir })
        const { createDirectoryWithGit } = await import('../utils/project-creator.js')
        const project = await createDirectoryWithGit(message.payload.name, workdir)
        logger.debug('WS project created', { id: project.id, name: project.name })
        send(createProjectStateMessage(project, message.id))
        logger.debug('WS sent project.state', { messageId: message.id })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        logger.error('WS project creation failed', { error: errorMessage })
        send(createErrorMessage('PROJECT_CREATION_FAILED', errorMessage, message.id))
      }
      break
    }
    
    case 'project.list': {
      logger.debug('WS project.list received', { messageId: message.id })
      const projects = listProjects()
      logger.debug('WS projects found', { count: projects.length, projects: projects.map(p => ({ id: p.id, name: p.name })) })
      send(createProjectListMessage(projects, message.id))
      logger.debug('WS sent project.list', { messageId: message.id })
      break
    }
    
    case 'project.load': {
      if (!isProjectLoadPayload(message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid project.load payload', message.id))
        return
      }
      
      const project = getProject(message.payload.projectId)
      if (!project) {
        send(createErrorMessage('NOT_FOUND', 'Project not found', message.id))
        return
      }
      
      send(createProjectStateMessage(project, message.id))
      break
    }
    
    case 'project.update': {
      if (!isProjectUpdatePayload(message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid project.update payload', message.id))
        return
      }
      
      const updates: { name?: string; customInstructions?: string | null } = {}
      if (message.payload.name !== undefined) {
        updates.name = message.payload.name
      }
      if (message.payload.customInstructions !== undefined) {
        updates.customInstructions = message.payload.customInstructions
      }
      
      const updated = updateProject(message.payload.projectId, updates)
      if (!updated) {
        send(createErrorMessage('NOT_FOUND', 'Project not found', message.id))
        return
      }
      
      send(createProjectStateMessage(updated, message.id))
      break
    }
    
    case 'project.delete': {
      if (!isProjectDeletePayload(message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid project.delete payload', message.id))
        return
      }
      
      deleteProject(message.payload.projectId)
      send({ type: 'project.deleted', payload: { projectId: message.payload.projectId }, id: message.id })
      break
    }
    
    // =========================================================================
    // Settings Management
    // =========================================================================
    
    case 'settings.get': {
      if (!isSettingsGetPayload(message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid settings.get payload', message.id))
        return
      }
      
      const value = getSetting(message.payload.key)
      send(createSettingsValueMessage(message.payload.key, value, message.id))
      break
    }
    
    case 'settings.set': {
      if (!isSettingsSetPayload(message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid settings.set payload', message.id))
        return
      }
      
      setSetting(message.payload.key, message.payload.value)
      send(createSettingsValueMessage(message.payload.key, message.payload.value, message.id))
      break
    }
    
    // =========================================================================
    // Session Management
    // =========================================================================
    
    case 'session.create': {
      if (!isSessionCreatePayload(message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid session.create payload', message.id))
        return
      }
      
      // Snapshot current global provider/model into new session
      const currentProvider = providerManager?.getActiveProvider()
      const currentModel = currentProvider ? getLLMClient().getModel() : null
      const currentContextWindow = providerManager?.getCurrentModelContext()
      console.log('[WS] Creating session with contextWindow:', currentContextWindow, 'from provider:', currentProvider?.id)
      const session = sessionManager.createSession(
        message.payload.projectId,
        message.payload.title,
        currentProvider?.id ?? null,
        currentModel,
        currentContextWindow,
      )
      client.activeSessionId = session.id
      // New session has no events yet
      sendForSession(session.id, createSessionStateMessage(session, [], message.id))
      
      // Send initial context state
      const contextState = sessionManager.getContextState(session.id)
      sendForSession(session.id, createContextStateMessage(contextState))
      break
    }
    
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
      
      // Fetch messages - prefer EventStore if it has events, otherwise fall back to messages table
      const eventStore = getEventStore()
      const events = eventStore.getEvents(session.id)
      
      // Build messages from EventStore
      const messages = buildMessagesFromStoredEvents(events)
      logger.debug('Loaded messages from EventStore', { sessionId: session.id, eventCount: events.length, messageCount: messages.length })

      sendForSession(session.id, createSessionStateMessage(session, messages, message.id))
      
      // Send context state
      const contextState = sessionManager.getContextState(session.id)
      sendForSession(session.id, createContextStateMessage(contextState))
      
      // No event replay needed - client stays subscribed to all sessions (tab model)
      break
    }
    
    case 'session.list': {
      const sessions = sessionManager.listSessions()
      
      // Add recent user prompts to each session
      const sessionsWithPrompts = sessions.map(session => ({
        ...session,
        recentUserPrompts: getRecentUserPromptsForSession(session.id, 10),
      }))
      
      send(createSessionListMessage(sessionsWithPrompts, message.id))
      break
    }
    
    case 'session.delete': {
      if (!isSessionLoadPayload(message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid session.delete payload', message.id))
        return
      }
      
      sessionManager.deleteSession(message.payload.sessionId)
      send({ type: 'session.deleted', payload: { sessionId: message.payload.sessionId }, id: message.id })
      break
    }
    
    case 'session.deleteAll': {
      if (!message.payload || typeof message.payload !== 'object' || !('projectId' in message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid session.deleteAll payload', message.id))
        return
      }
      const payload = message.payload as { projectId: string }
      const project = sessionManager.getProject(payload.projectId)
      if (!project) {
        send(createErrorMessage('PROJECT_NOT_FOUND', 'Project not found', message.id))
        return
      }
      sessionManager.deleteAllSessions(payload.projectId, project.workdir)
      send({ type: 'session.deletedAll', payload: { projectId: payload.projectId }, id: message.id })
      break
    }

    case 'session.setProvider': {
      if (!client.activeSessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }

      if (!isSessionSetProviderPayload(message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid session.setProvider payload', message.id))
        return
      }

      if (!providerManager) {
        send(createErrorMessage('NO_PROVIDERS', 'Provider management not available', message.id))
        return
      }

      const { providerId, model: requestedModel } = message.payload
      const provider = providerManager.getProviders().find(p => p.id === providerId)
      if (!provider) {
        send(createErrorMessage('PROVIDER_NOT_FOUND', 'Provider not found', message.id))
        return
      }

      // Resolve model: use requested, or default to 'auto'
      const resolvedModel = requestedModel ?? 'auto'

      const sessionId = client.activeSessionId
      sessionManager.setSessionProvider(sessionId, providerId, resolvedModel)
      invalidateSessionLLMClient?.(sessionId)

      // Send updated session state
      const eventStore = getEventStore()
      const updatedSession = sessionManager.requireSession(sessionId)
      const events = eventStore.getEvents(sessionId)
      const messages = buildMessagesFromStoredEvents(events)
      sendForSession(sessionId, createSessionStateMessage(updatedSession, messages, message.id))
      break
    }

    // =========================================================================
    // Unified Chat (replaces plan.message, agent.start, etc.)
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
                  broadcastForSession(sessionId, createSessionStateMessage(updatedSession, messages))
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
      if (!client.activeSessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }

      abortSessionExecution(client.activeSessionId, 'Session aborted by user')

      send({ type: 'ack', payload: {}, id: message.id })
      break
    }

    // =========================================================================
    // Message Queue
    // =========================================================================

    case 'queue.asap': {
      if (!client.activeSessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      if (!isQueueAsapPayload(message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid queue.asap payload', message.id))
        return
      }
      const { content, attachments } = message.payload
      sessionManager.queueMessage(client.activeSessionId, 'asap', content, attachments)
      sendForSession(client.activeSessionId, createQueueStateMessage(sessionManager.getQueueState(client.activeSessionId)))
      send({ type: 'ack', payload: {}, id: message.id })
      break
    }

    case 'queue.completion': {
      if (!client.activeSessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      if (!isQueueCompletionPayload(message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid queue.completion payload', message.id))
        return
      }
      const { content, attachments } = message.payload
      sessionManager.queueMessage(client.activeSessionId, 'completion', content, attachments)
      sendForSession(client.activeSessionId, createQueueStateMessage(sessionManager.getQueueState(client.activeSessionId)))
      send({ type: 'ack', payload: {}, id: message.id })
      break
    }

    case 'queue.cancel': {
      if (!client.activeSessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      if (!isQueueCancelPayload(message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid queue.cancel payload', message.id))
        return
      }
      sessionManager.cancelQueuedMessage(client.activeSessionId, message.payload.queueId)
      sendForSession(client.activeSessionId, createQueueStateMessage(sessionManager.getQueueState(client.activeSessionId)))
      send({ type: 'ack', payload: {}, id: message.id })
      break
    }

    case 'chat.continue': {
      if (!client.activeSessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }

      const session = sessionManager.requireSession(client.activeSessionId)
      if (session.isRunning) {
        send(createErrorMessage('ALREADY_RUNNING', 'Session is already running', message.id))
        return
      }

      const continueEventStore = getEventStore()
      const events = continueEventStore.getEvents(session.id)
      const messages = buildMessagesFromStoredEvents(events)
      const lastAssistantMessage = [...messages].reverse().find(msg => msg.role === 'assistant')
      const fallbackMessageId = lastAssistantMessage?.id ?? [...messages].reverse().find(msg => msg.role === 'user')?.id ?? crypto.randomUUID()

      send({ type: 'ack', payload: {}, id: message.id })
      sendForSession(session.id, createChatDoneMessage(fallbackMessageId, 'complete', lastAssistantMessage?.stats))
      break
    }
    
    // =========================================================================
    // Mode Switching
    // =========================================================================
    
    case 'mode.switch': {
      if (!client.activeSessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      
      if (!isModeSwitchPayload(message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid mode.switch payload', message.id))
        return
      }

      // Validate that the target agent exists and is a top-level agent
      const allAgents = await loadAllAgentsDefault()
      const targetAgent = findAgentById(message.payload.mode, allAgents)
      if (!targetAgent || targetAgent.metadata.subagent) {
        send(createErrorMessage('INVALID_AGENT', `Agent '${message.payload.mode}' not found or is a sub-agent`, message.id))
        return
      }

      const sessionId = client.activeSessionId
      const session = sessionManager.requireSession(sessionId)
      const eventStore = getEventStore()
      
      // Trigger summary generation when switching to builder mode for the first time
      // Only if there are actual conversation messages to summarize
      if (message.payload.mode === 'builder' && needsSummaryGeneration(session.summary)) {
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
          generateSessionSummary({
            messages: summaryMessages,
            llmClient: llmForSession(sessionId),
          })
          .then(async (result) => {
            if (result.success && result.summary) {
              // Update DB with the generated summary
              sessionManager.setSummary(sessionId, result.summary)

              // Broadcast updated session state to all WebSocket clients
              const updatedSession = sessionManager.getSession(sessionId)
              if (updatedSession) {
                const events = eventStore.getEvents(sessionId)
                const messages = buildMessagesFromStoredEvents(events)
                broadcastForSession(sessionId, createSessionStateMessage(updatedSession, messages))
              }
              
              logger.info('Session summary generated', { sessionId, summaryLength: result.summary.length })
            }
          })
          .catch((error) => {
            logger.warn('Session summary generation failed', { sessionId, error: error instanceof Error ? error.message : error })
            // Don't propagate error - summary generation is optional
          })
        }
      }
      
      sessionManager.setMode(sessionId, message.payload.mode)
      sendForSession(sessionId, createModeChangedMessage(message.payload.mode, false))
      const modeEvents = eventStore.getEvents(sessionId)
      const modeMessages = buildMessagesFromStoredEvents(modeEvents)
      sendForSession(sessionId, createSessionStateMessage(sessionManager.getSession(sessionId)!, modeMessages, message.id))
      break
    }
    
    case 'mode.accept': {
      if (!client.activeSessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      
      const session = sessionManager.requireSession(client.activeSessionId)
      
      // Check if session is already running - reject concurrent execution
      if (session.isRunning) {
        send(createErrorMessage('ALREADY_RUNNING', 'Session is already running', message.id))
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
      
      // Ensure client is subscribed to EventStore (tab model - additive)
      if (!client.eventStoreSubscriptions.has(sessionId)) {
        const sid = sessionId
        const { iterator, unsubscribe } = eventStore.subscribe(sid)
        client.eventStoreSubscriptions.set(sessionId, unsubscribe)
        
        ;(async () => {
          try {
            for await (const storedEvent of iterator) {
              const serverMsg = storedEventToServerMessage(storedEvent)
              if (serverMsg && ws.readyState === WebSocket.OPEN) {
                ws.send(serializeServerMessage({ ...serverMsg, seq: storedEvent.seq, sessionId: sid }))
              }
            }
          } catch (error) {
            logger.debug('EventStore subscription ended', { sessionId: sid, error })
          }
        })()
      }
      
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
          generateSessionSummary({
            messages: summaryMessages,
            llmClient: llmForSession(sessionId),
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
      if (!client.activeSessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      
      if (!isCriteriaEditPayload(message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid criteria.edit payload', message.id))
        return
      }
      
      sessionManager.setCriteria(client.activeSessionId, message.payload.criteria)
      sendForSession(client.activeSessionId, createCriteriaUpdatedMessage(message.payload.criteria))
      send({ type: 'ack', payload: {}, id: message.id })
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
          sendForSession(sessionId, createSessionStateMessage(updatedSession, compactMessages))
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
      
      // Check if session is already running - reject concurrent execution
      if (session.isRunning) {
        send(createErrorMessage('ALREADY_RUNNING', 'Session is already running', message.id))
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

      // Parse launch payload early
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
      if (!client.activeSessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      
      if (!isPathConfirmPayload(message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid path.confirm payload', message.id))
        return
      }
      
      const { callId, approved } = message.payload
      const result = providePathConfirmation(callId, approved)
      
      if (!result.found) {
        send(createErrorMessage('NOT_FOUND', 'No pending path confirmation with that ID', message.id))
        return
      }
      
      logger.debug('Path confirmation response', { 
        sessionId: client.activeSessionId, 
        callId, 
        approved 
      })
      
      // Just acknowledge - the Promise resolution will resume tool execution automatically.
      // If approved: paths were added to allowlist, tool continues.
      // If denied: requestPathAccess throws PathAccessDeniedError, handled by existing error catch.
      send({ type: 'ack', payload: {}, id: message.id })
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
