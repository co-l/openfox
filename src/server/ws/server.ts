import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'node:http'
import type { ServerMessage } from '../../shared/protocol.js'
import type { Config } from '../config.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { ToolRegistry } from '../tools/index.js'
import type { SessionManager } from '../session/index.js'
import { getEventStore, getCurrentContextWindowId } from '../events/index.js'
import { buildContextMessagesFromEventHistory, buildMessagesFromStoredEvents } from '../events/folding.js'
import type { Attachment, InjectedFile, Message, Provider, StatsIdentity } from '../../shared/types.js'
import { runChatTurn, TurnMetrics, createMessageStartEvent, createMessageDoneEvent, createChatDoneEvent } from '../chat/orchestrator.js'
import { streamLLMPure, consumeStreamGenerator } from '../chat/stream-pure.js'
import { runOrchestrator } from '../runner/index.js'
import { COMPACTION_PROMPT } from '../chat/prompts.js'
import { assemblePlannerRequest, type RequestContextMessage } from '../chat/request-context.js'
import { providePathConfirmation, addAllowedPaths } from '../tools/index.js'
import { getAllInstructions } from '../context/instructions.js'
import { logger } from '../utils/logger.js'
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
  createChatDeltaMessage,
  createChatThinkingMessage,
  createChatToolCallMessage,
  createChatToolResultMessage,
  createChatMessageMessage,
  createChatMessageUpdatedMessage,
  createChatDoneMessage,
  createChatErrorMessage,
  createModeChangedMessage,
  createPhaseChangedMessage,
  createCriteriaUpdatedMessage,
  createContextStateMessage,
  isProjectCreatePayload,
  isProjectLoadPayload,
  isProjectUpdatePayload,
  isProjectDeletePayload,
  isSessionCreatePayload,
  isSessionLoadPayload,
  isChatSendPayload,
  isModeSwitchPayload,
  isCriteriaEditPayload,
  isPathConfirmPayload,
  isSettingsGetPayload,
  isSettingsSetPayload,
  createSettingsValueMessage,
  storedEventToServerMessage,
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

function toRequestContextMessages(messages: Array<{
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
  toolCallId?: string
  attachments?: Attachment[]
}>): RequestContextMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    source: 'history',
    ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.attachments ? { attachments: message.attachments } : {}),
  }))
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
  sessionManager: SessionManager
): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' })
  const clients = new Map<WebSocket, ClientConnection>()
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
          await handleClientMessage(ws, client, message, config, getLLMClient, getActiveProvider, toolRegistry, sessionManager, broadcastForSession)
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
): Promise<void> {
  const send = (msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(serializeServerMessage(msg))
    }
  }

  const sendForSession = (sessionId: string, msg: ServerMessage) => {
    send({ ...msg, sessionId })
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
    
    case 'project.list': {
      const projects = listProjects()
      send(createProjectListMessage(projects, message.id))
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
      
      const session = sessionManager.createSession(
        message.payload.projectId,
        message.payload.title
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
      
      // Subscribe to EventStore for live streaming
      if (!client.eventStoreSubscriptions.has(session.id)) {
        const sid = session.id
        const eventStore = getEventStore()
        const { iterator, unsubscribe } = eventStore.subscribe(sid)
        client.eventStoreSubscriptions.set(session.id, unsubscribe)
        
        // Forward events asynchronously
        ;(async () => {
          try {
            for await (const storedEvent of iterator) {
              const serverMsg = storedEventToServerMessage(storedEvent)
              if (serverMsg && ws.readyState === WebSocket.OPEN) {
                ws.send(serializeServerMessage({ ...serverMsg, seq: storedEvent.seq, sessionId: sid }))
              }
            }
          } catch (error) {
            // Iterator closed or connection dropped - this is expected
            logger.debug('EventStore subscription ended', { sessionId: sid, error })
          }
        })()
        
        logger.debug('Subscribed to EventStore', { sessionId: session.id })
      }
      
      // Fetch messages - prefer EventStore if it has events, otherwise fall back to messages table
      const eventStore = getEventStore()
      const events = eventStore.getEvents(session.id)
      
      let messages: Message[]
      // Build messages from EventStore
      messages = buildMessagesFromStoredEvents(events)
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
      send(createSessionListMessage(sessions, message.id))
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
      
      // Add user message with attachments (emits events to EventStore)
      const userMessage = sessionManager.addMessage(sessionId, {
        role: 'user',
        content: message.payload.content,
        ...(message.payload.attachments && { attachments: message.payload.attachments }),
      })
      
      // Check if we need to generate a session name (first message with default/empty title)
      const messageCount = getSessionMessageCount(sessionId)
      if (needsNameGeneration(currentSession.metadata.title, messageCount)) {
        // Generate name in parallel - don't block the chat turn
        // Use the active LLM client (respects user's selected model)
        generateSessionName({
          userMessage: message.payload.content,
          llmClient: getLLMClient(),
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
      
      // Mark session as running (emits running.changed event)
      sessionManager.setRunning(sessionId, true)
      
      // Send user message directly to client (don't rely on EventStore subscription for this)
      sendForSession(sessionId, createChatMessageMessage(userMessage))
      sendForSession(sessionId, createSessionRunningMessage(true))
      
      // Create AbortController for this chat (abort existing if any - defense in depth)
      const controller = new AbortController()
      const existingController = activeAgents.get(sessionId)
      if (existingController) {
        logger.warn('Aborting existing agent before starting new one', { sessionId })
        existingController.abort()
      }
      activeAgents.set(sessionId, controller)
      
      // Acknowledge immediately
      send({ type: 'ack', payload: {}, id: message.id })
      
      // Ensure client is subscribed to EventStore
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
      
      // Use NEW orchestrator (events go through EventStore → WS subscription)
      runChatTurn({
        sessionManager,
        sessionId,
        llmClient: getLLMClient(),
        statsIdentity: resolveStatsIdentity(getLLMClient(), getActiveProvider),
        signal: controller.signal,
         onMessage: (msg) => sendForSession(sessionId, msg),  // For path confirmation dialogs
      }).catch((error) => {
        // Don't create error message for controlled abort
        if (error instanceof Error && error.message === 'Aborted') {
          return
        }
        logger.error('Continue error', { error })
        // Errors are handled inside runChatTurn and appended to EventStore
      }).finally(() => {
        activeAgents.delete(sessionId)
        // setRunning emits running.changed event
        sessionManager.setRunning(sessionId, false)
        // Send updated context state to frontend
        const contextState = sessionManager.getContextState(sessionId)
        sendForSession(sessionId, createContextStateMessage(contextState))
      })
      
      break
    }

    case 'chat.stop': {
      if (!client.activeSessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }

      const controller = activeAgents.get(client.activeSessionId)
      if (controller) {
        controller.abort()
      }

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
      
      const sessionId = client.activeSessionId
      const session = sessionManager.requireSession(sessionId)
      const eventStore = getEventStore()
      
      // Trigger summary generation when switching to builder mode for the first time
      if (message.payload.mode === 'builder' && needsSummaryGeneration(session.summary)) {
        // Generate summary in parallel - don't block the mode switch
        const events = eventStore.getEvents(sessionId)
        const contextMessages = buildContextMessagesFromEventHistory(events)
        const summaryMessages = contextMessages.filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
        
        generateSessionSummary({
          messages: summaryMessages,
          llmClient: getLLMClient(),
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
      
      if (session.criteria.length === 0) {
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
      const currentSession = sessionManager.requireSession(sessionId)
      if (needsSummaryGeneration(currentSession.summary)) {
        // Generate summary in parallel - don't block the mode switch
        const events = eventStore.getEvents(sessionId)
        const contextMessages = buildContextMessagesFromEventHistory(events)
        const summaryMessages = contextMessages.filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
        
        generateSessionSummary({
          messages: summaryMessages,
          llmClient: getLLMClient(),
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
      
      // Start builder asynchronously (summary already generated on mode.switch if needed)
      ;(async () => {
        try {
          // Switch to builder mode and phase
          sessionManager.setMode(sessionId, 'builder')
          sessionManager.setPhase(sessionId, 'build')
          eventStore.append(sessionId, { type: 'mode.changed', data: { mode: 'builder', auto: false, reason: 'Criteria accepted' } })
          eventStore.append(sessionId, { type: 'phase.changed', data: { phase: 'build' } })
          
          // Create AbortController for builder (abort existing if any - defense in depth)
          const controller = new AbortController()
          const existingController = activeAgents.get(sessionId)
          if (existingController) {
            logger.warn('Aborting existing agent before starting new one', { sessionId })
            existingController.abort()
          }
          activeAgents.set(sessionId, controller)
          
          // Auto-start orchestrator (full state machine with verification)
          await runOrchestrator({
            sessionManager,
            sessionId,
            llmClient: getLLMClient(),
            statsIdentity: resolveStatsIdentity(getLLMClient(), getActiveProvider),
            injectBuilderKickoff: true,
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
          activeAgents.delete(sessionId)
          sessionManager.setRunning(sessionId, false)
          eventStore.append(sessionId, { type: 'running.changed', data: { isRunning: false } })
          // Send updated context state to frontend
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
      const eventStore = getEventStore()
      
      // Acknowledge immediately
      send({ type: 'ack', payload: {}, id: message.id })
      
      // Perform compaction asynchronously
      ;(async () => {
        try {
          // 1. Add compaction prompt as visible user message (auto-prompt style)
          const compactPromptMsgId = crypto.randomUUID()
          eventStore.append(sessionId, createMessageStartEvent(compactPromptMsgId, 'user', COMPACTION_PROMPT, {
            ...(getCurrentWindowMessageOptions(sessionId) ?? {}),
            isSystemGenerated: true,
            messageKind: 'auto-prompt',
          }))
          eventStore.append(sessionId, { type: 'message.done', data: { messageId: compactPromptMsgId } })

          // 2. Stream compaction response using the event-sourced path (no tools)
          const session = sessionManager.requireSession(sessionId)
          const { content: instructions, files } = await getAllInstructions(session.workdir, session.projectId)
          const injectedFiles: InjectedFile[] = files.map((file) => ({
            path: file.path,
            content: file.content ?? '',
            source: file.source,
          }))
          const currentWindowId = getCurrentContextWindowId(sessionId)
          const currentWindowEvents = eventStore.getEvents(sessionId)
          const requestMessages = toRequestContextMessages(buildContextMessagesFromEventHistory(
            currentWindowEvents,
            currentWindowId,
            { includeVerifier: false },
          ))
          const assembledRequest = assemblePlannerRequest({
            workdir: session.workdir,
            messages: requestMessages,
            includeRuntimeReminder: false,
            injectedFiles,
            promptTools: [],
            requestTools: [],
            toolChoice: 'none',
            disableThinking: true,
            ...(instructions ? { customInstructions: instructions } : {}),
          })

          const assistantMsgId = crypto.randomUUID()
          eventStore.append(sessionId, createMessageStartEvent(assistantMsgId, 'assistant', undefined, getCurrentWindowMessageOptions(sessionId)))

          const turnMetrics = new TurnMetrics()
          const streamGen = streamLLMPure({
            messageId: assistantMsgId,
            systemPrompt: assembledRequest.systemPrompt,
            llmClient: getLLMClient(),
            messages: assembledRequest.messages,
            tools: [],
            toolChoice: 'none',
            disableThinking: true,
          })
          const result = await consumeStreamGenerator(streamGen, event => {
            eventStore.append(sessionId, event)
          })
          turnMetrics.addLLMCall(result.timing, result.usage.promptTokens, result.usage.completionTokens)
          
          // Emit stats for compaction (PROMPT -> WORK -> stats+sound pattern)
          const compactionStats = turnMetrics.buildStats(resolveStatsIdentity(getLLMClient(), getActiveProvider), 'planner')
          eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
            segments: result.segments,
            stats: compactionStats,
            promptContext: assembledRequest.promptContext,
          }))
          eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'complete', compactionStats))
          
          // 4. Close current window and create new one
          sessionManager.compactContext(sessionId, result.content, tokensBefore)
          
          logger.info('Manual compaction complete', {
            sessionId,
            tokensBefore,
            summaryTokens: result.usage.completionTokens,
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
      
      // Check if there are pending criteria
      const pendingCriteria = session.criteria.filter(c => c.status.type !== 'passed')
      if (pendingCriteria.length === 0) {
        send(createErrorMessage('NO_WORK', 'No pending criteria to work on', message.id))
        return
      }
      
      const sessionId = client.activeSessionId
      const eventStore = getEventStore()
      
      // Check if session is blocked - user intervention resets it
      if (session.phase === 'blocked') {
        logger.info('User launched runner - resetting blocked state', { sessionId })
        // setPhase emits phase.changed event
        sessionManager.setPhase(sessionId, 'build')
        sessionManager.resetAllCriteriaAttempts(sessionId)
      }
      
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
      
      // Run orchestrator asynchronously
      logger.info('Runner launching', { sessionId, pendingCriteria: pendingCriteria.length })
      
      runOrchestrator({
        sessionManager,
        sessionId,
        llmClient: getLLMClient(),
        statsIdentity: resolveStatsIdentity(getLLMClient(), getActiveProvider),
        injectBuilderKickoff: true,
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
        activeAgents.delete(sessionId)
        // setRunning emits running.changed event
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
    
    default: {
      send(createErrorMessage('UNKNOWN_MESSAGE', `Unknown message type: ${message.type}`, message.id))
    }
  }
}
