import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'node:http'
import type { ServerMessage } from '../../shared/protocol.js'
import type { Config } from '../config.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { ToolRegistry } from '../tools/index.js'
import type { SessionManager } from '../session/index.js'
import { getEventStore } from '../events/index.js'
import { buildContextMessagesFromStoredEvents, buildMessagesFromStoredEvents } from '../events/folding.js'
import type { Message } from '../../shared/types.js'
import { runChatTurn, TurnMetrics, createMessageStartEvent, createMessageDoneEvent, createChatDoneEvent } from '../chat/orchestrator.js'
import { streamLLMPure, consumeStreamGenerator } from '../chat/stream-pure.js'
import { runOrchestrator } from '../runner/index.js'
import { streamLLMResponse } from '../chat/stream.js'
import { computeMessageStats } from '../chat/stats.js'
import { buildPlannerPrompt, SUMMARY_REQUEST_PROMPT, COMPACTION_PROMPT } from '../chat/prompts.js'
import { getToolRegistryForMode, providePathConfirmation, addAllowedPaths } from '../tools/index.js'
import { estimateTokens } from '../context/tokenizer.js'
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
import { getMessages } from '../db/sessions.js'
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
  llmClient: LLMClientWithModel,
  toolRegistry: ToolRegistry,
  sessionManager: SessionManager
): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' })
  const clients = new Map<WebSocket, ClientConnection>()
  
  // Subscribe to session events and broadcast to relevant clients
  sessionManager.subscribe((event) => {
    const sessionId = 'sessionId' in event ? event.sessionId : 
      'session' in event ? event.session.id : null
    
    if (!sessionId) return
    
    for (const [ws, client] of clients) {
      // Send events to all clients subscribed to this session (tab model)
      if (client.subscribedSessions.has(sessionId) && ws.readyState === WebSocket.OPEN) {
        // Only broadcast session.state for session_updated (not mode_changed)
        // mode_changed is handled via the event queue to maintain ordering during streaming
        if (event.type === 'session_updated') {
          const session = sessionManager.getSession(sessionId)
          if (session) {
            const messages = getMessages(sessionId)
            ws.send(serializeServerMessage(createSessionStateMessage(session, messages)))
          }
        }
        // Forward message updates to clients (e.g., isStreaming changes)
        if (event.type === 'message_updated') {
          ws.send(serializeServerMessage(createChatMessageUpdatedMessage(event.messageId, event.updates)))
        }
        
        // Send context state updates when execution state changes
        if (event.type === 'execution_state_changed') {
          const contextState = sessionManager.getContextState(sessionId)
          ws.send(serializeServerMessage(createContextStateMessage(contextState)))
        }
        
        // Broadcast running state changes in real-time
        if (event.type === 'running_changed') {
          ws.send(serializeServerMessage(createSessionRunningMessage(event.isRunning)))
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
        await handleClientMessage(ws, client, message, config, llmClient, toolRegistry, sessionManager)
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
  llmClient: LLMClientWithModel,
  toolRegistry: ToolRegistry,
  sessionManager: SessionManager
): Promise<void> {
  const send = (msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(serializeServerMessage(msg))
    }
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
      send(createSessionStateMessage(session, [], message.id))
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
      if (events.length > 0) {
        // New system: build messages from events
        messages = buildMessagesFromStoredEvents(events)
        logger.debug('Loaded messages from EventStore', { sessionId: session.id, eventCount: events.length, messageCount: messages.length })
      } else {
        // Old system: fetch from messages table
        messages = getMessages(session.id)
        logger.debug('Loaded messages from DB', { sessionId: session.id, messageCount: messages.length })
      }
      
      send(createSessionStateMessage(session, messages, message.id))
      
      // Send context state
      const contextState = sessionManager.getContextState(session.id)
      send(createContextStateMessage(contextState))
      
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
        send(createPhaseChangedMessage('build'))
      }
      
      const sessionId = client.activeSessionId
      const eventStore = getEventStore()
      
      // Add user message to BOTH old system (for backward compat) AND EventStore (new system)
      const userMessage = sessionManager.addMessage(sessionId, {
        role: 'user',
        content: message.payload.content,
        tokenCount: Math.ceil(message.payload.content.length / 4),
      })
      
      // Write to EventStore for persistence (used for context building)
      eventStore.append(sessionId, createMessageStartEvent(userMessage.id, 'user', message.payload.content))
      eventStore.append(sessionId, { type: 'message.done', data: { messageId: userMessage.id } })
      
      // Mark session as running
      sessionManager.setRunning(sessionId, true)
      eventStore.append(sessionId, { type: 'running.changed', data: { isRunning: true } })
      
      // Send user message directly to client (don't rely on EventStore subscription for this)
      send(createChatMessageMessage(userMessage))
      send(createSessionRunningMessage(true))
      
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
        llmClient,
        signal: controller.signal,
        onMessage: send,  // For path confirmation dialogs
      }).catch((error) => {
        // Don't create error message for controlled abort
        if (error instanceof Error && error.message === 'Aborted') {
          return
        }
        logger.error('Continue error', { error })
        // Errors are handled inside runChatTurn and appended to EventStore
      }).finally(() => {
        activeAgents.delete(sessionId)
        sessionManager.setRunning(sessionId, false)
        eventStore.append(sessionId, { type: 'running.changed', data: { isRunning: false } })
        // Send updated context state to frontend
        const contextState = sessionManager.getContextState(sessionId)
        send(createContextStateMessage(contextState))
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

      const messages = getMessages(session.id)
      const lastAssistantMessage = [...messages].reverse().find(msg => msg.role === 'assistant')
      const fallbackMessageId = lastAssistantMessage?.id ?? [...messages].reverse().find(msg => msg.role === 'user')?.id ?? crypto.randomUUID()

      send({ type: 'ack', payload: {}, id: message.id })
      send(createChatDoneMessage(fallbackMessageId, 'complete', lastAssistantMessage?.stats))
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
      
      const session = sessionManager.setMode(client.activeSessionId, message.payload.mode)
      send(createModeChangedMessage(message.payload.mode, false))
      const messages = getMessages(session.id)
      send(createSessionStateMessage(session, messages, message.id))
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
      send(createSessionRunningMessage(true))
      
      // Generate summary and start builder asynchronously
      ;(async () => {
        try {
          // Add summary request prompt as user message
          const summaryMsgId = crypto.randomUUID()
          eventStore.append(sessionId, createMessageStartEvent(summaryMsgId, 'user', SUMMARY_REQUEST_PROMPT, {
            isSystemGenerated: true,
            messageKind: 'auto-prompt',
          }))
          eventStore.append(sessionId, { type: 'message.done', data: { messageId: summaryMsgId } })
          
          // Build context for summary generation
          const currentSession = sessionManager.requireSession(sessionId)
          const { content: instructions } = await getAllInstructions(currentSession.workdir, currentSession.projectId)
          const toolRegistry = getToolRegistryForMode('planner')
          const systemPrompt = buildPlannerPrompt(currentSession.workdir, toolRegistry.definitions, instructions || undefined)
          
          // Build context messages from EventStore
          const events = eventStore.getEvents(sessionId)
          const contextMessages = buildContextMessagesFromStoredEvents(events)
          
          // Stream summary response (no tools, no thinking)
          const assistantMsgId = crypto.randomUUID()
          eventStore.append(sessionId, createMessageStartEvent(assistantMsgId, 'assistant'))
          
          const turnMetrics = new TurnMetrics()
          const streamGen = streamLLMPure({
            messageId: assistantMsgId,
            systemPrompt,
            llmClient,
            messages: contextMessages,
            tools: [], // No tools for summary
            toolChoice: 'none',
            enableThinking: false,
          })
          
          const result = await consumeStreamGenerator(streamGen, event => {
            eventStore.append(sessionId, event)
          })
          
          turnMetrics.addLLMCall(result.timing, result.usage.promptTokens, result.usage.completionTokens)
          
          // Emit message.done with stats
          const stats = turnMetrics.buildStats(llmClient.getModel(), 'planner')
          eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, { segments: result.segments, stats }))
          eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'complete', stats))
          
          // Save summary
          sessionManager.setSummary(sessionId, result.content)
          
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
            llmClient,
            signal: controller.signal,
            onMessage: send,  // For path confirmation dialogs
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
          send(createContextStateMessage(contextState))
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
      send(createCriteriaUpdatedMessage(message.payload.criteria))
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
          // 1. Add compaction prompt as visible user message (auto-prompt style)
          const compactPromptMsg = sessionManager.addMessage(sessionId, {
            role: 'user',
            content: COMPACTION_PROMPT,
            tokenCount: estimateTokens(COMPACTION_PROMPT),
            isSystemGenerated: true,
            messageKind: 'auto-prompt',
          })
          send(createChatMessageMessage(compactPromptMsg))
          
          // 2. Stream compaction response using core function (no tools)
          const session = sessionManager.requireSession(sessionId)
          const { content: instructions } = await getAllInstructions(session.workdir, session.projectId)
          const toolRegistry = getToolRegistryForMode('planner')
          const systemPrompt = buildPlannerPrompt(session.workdir, toolRegistry.definitions, instructions || undefined)
          const result = await streamLLMResponse({
            sessionManager,
            sessionId,
            systemPrompt,
            llmClient,
            onEvent: send,
          })
          
          // Emit stats for compaction (PROMPT -> WORK -> stats+sound pattern)
          const compactionStats = computeMessageStats({
            model: llmClient.getModel(),
            mode: 'planner',
            timing: result.timing,
            usage: result.usage,
          })
          sessionManager.updateMessageStats(sessionId, result.messageId, compactionStats)
          send(createChatDoneMessage(result.messageId, 'complete', compactionStats))
          
          // 3. Mark response as compaction summary
          sessionManager.updateMessage(sessionId, result.messageId, {
            isCompactionSummary: true,
          })
          
          // 4. Close current window and create new one
          sessionManager.compactContext(sessionId, result.content, tokensBefore)
          
          logger.info('Manual compaction complete', {
            sessionId,
            tokensBefore,
            summaryTokens: result.usage.completionTokens,
          })
          
          // Send updated context state
          const newContextState = sessionManager.getContextState(sessionId)
          send(createContextStateMessage(newContextState))
          
          // Send updated session state so client sees all messages
          const updatedSession = sessionManager.requireSession(sessionId)
          const messages = getMessages(sessionId)
          send(createSessionStateMessage(updatedSession, messages))
        } catch (error) {
          logger.error('Compaction failed', { error, sessionId })
          send(createChatErrorMessage(
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
        sessionManager.setPhase(sessionId, 'build')
        sessionManager.resetAllCriteriaAttempts(sessionId)
        eventStore.append(sessionId, { type: 'phase.changed', data: { phase: 'build' } })
      }
      
      // Mark session as running
      sessionManager.setRunning(sessionId, true)
      eventStore.append(sessionId, { type: 'running.changed', data: { isRunning: true } })
      send(createSessionRunningMessage(true))
      
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
        llmClient,
        signal: controller.signal,
        onMessage: send,  // For path confirmation dialogs
      }).catch((error) => {
        // Don't create error message for controlled abort
        if (error instanceof Error && error.message === 'Aborted') {
          return
        }
        logger.error('Runner error', { error, sessionId })
        // Error events are handled inside runOrchestrator and appended to EventStore
      }).finally(() => {
        activeAgents.delete(sessionId)
        sessionManager.setRunning(sessionId, false)
        eventStore.append(sessionId, { type: 'running.changed', data: { isRunning: false } })
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
