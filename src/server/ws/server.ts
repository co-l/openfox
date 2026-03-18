import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'node:http'
import type { ServerMessage } from '../../shared/protocol.js'
import type { Config } from '../config.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { ToolRegistry } from '../tools/index.js'
import { sessionManager } from '../session/index.js'
import { sessionEvents } from '../session/events.js'
import { getEventStore, type StoredEvent, type TurnEvent, type SnapshotMessage, type SessionSnapshot } from '../events/index.js'
import type { Message } from '../../shared/types.js'
import { handleChat } from '../chat/index.js'
import { runChatTurn } from '../chat/orchestrator.js'
import { createMessageStartEvent } from '../chat/stream-pure.js'
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

// ============================================================================
// Event Store → Messages Conversion
// ============================================================================

/**
 * Build Message array from EventStore events.
 * Used when loading a session that has events in EventStore.
 */
function buildMessagesFromEvents(events: StoredEvent[]): Message[] {
  const messages: Map<string, Message> = new Map()
  
  for (const event of events) {
    switch (event.type) {
      case 'message.start': {
        const data = event.data as Extract<TurnEvent, { type: 'message.start' }>['data']
        messages.set(data.messageId, {
          id: data.messageId,
          role: data.role,
          content: data.content ?? '',
          timestamp: new Date(event.timestamp).toISOString(),
          tokenCount: 0,
          isStreaming: true,
          ...(data.contextWindowId ? { contextWindowId: data.contextWindowId } : {}),
          ...(data.subAgentId ? { subAgentId: data.subAgentId } : {}),
          ...(data.subAgentType ? { subAgentType: data.subAgentType } : {}),
          ...(data.isSystemGenerated ? { isSystemGenerated: data.isSystemGenerated } : {}),
          ...(data.messageKind ? { messageKind: data.messageKind } : {}),
        })
        break
      }

      case 'message.delta': {
        const data = event.data as Extract<TurnEvent, { type: 'message.delta' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) {
          msg.content += data.content
        }
        break
      }

      case 'message.thinking': {
        const data = event.data as Extract<TurnEvent, { type: 'message.thinking' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) {
          msg.thinkingContent = (msg.thinkingContent ?? '') + data.content
        }
        break
      }

      case 'message.done': {
        const data = event.data as Extract<TurnEvent, { type: 'message.done' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) {
          msg.isStreaming = false
          if (data.stats) msg.stats = data.stats
          if (data.segments) msg.segments = data.segments
          if (data.partial) msg.partial = data.partial
        }
        break
      }

      case 'tool.call': {
        const data = event.data as Extract<TurnEvent, { type: 'tool.call' }>['data']
        const msg = messages.get(data.messageId)
        if (msg) {
          if (!msg.toolCalls) msg.toolCalls = []
          msg.toolCalls.push(data.toolCall)
        }
        break
      }

      case 'tool.result': {
        const data = event.data as Extract<TurnEvent, { type: 'tool.result' }>['data']
        const msg = messages.get(data.messageId)
        if (msg?.toolCalls) {
          const tc = msg.toolCalls.find(t => t.id === data.toolCallId)
          if (tc) {
            tc.result = data.result
          }
        }
        break
      }

      // Skip events that don't affect message state
      case 'turn.snapshot':
      case 'phase.changed':
      case 'mode.changed':
      case 'running.changed':
      case 'criteria.set':
      case 'criterion.updated':
      case 'context.state':
      case 'context.compacted':
      case 'todo.updated':
      case 'chat.done':
      case 'chat.error':
      case 'format.retry':
      case 'tool.preparing':
      case 'tool.output':
        break
    }
  }

  return Array.from(messages.values())
}

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
  toolRegistry: ToolRegistry
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
        await handleClientMessage(ws, client, message, config, llmClient, toolRegistry)
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
  toolRegistry: ToolRegistry
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
      
      // Subscribe to this session's events if not already subscribed (additive)
      // OLD event system (sessionEvents queue)
      if (!client.subscribedSessions.has(session.id)) {
        const sid = session.id  // Capture for closure
        const unsubscribe = sessionEvents.subscribe(sid, (event, seq) => {
          send({ ...event, seq, sessionId: sid })
        })
        client.subscribedSessions.set(session.id, unsubscribe)
        logger.debug('Subscribed to session events (old system)', { sessionId: session.id })
      }
      
      // NEW event system (EventStore) - subscribe for live streaming
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
        messages = buildMessagesFromEvents(events)
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
      
      // Add user message to BOTH old system (for backward compat) AND EventStore (new system)
      const userMessage = sessionManager.addMessage(client.activeSessionId, {
        role: 'user',
        content: message.payload.content,
        tokenCount: Math.ceil(message.payload.content.length / 4),
      })
      
      const sessionId = client.activeSessionId
      const eventStore = getEventStore()
      
      // Also write to EventStore
      eventStore.append(sessionId, createMessageStartEvent(userMessage.id, 'user', message.payload.content))
      
      // Mark session as running
      sessionManager.setRunning(client.activeSessionId, true)
      eventStore.append(sessionId, { type: 'running.changed', data: { isRunning: true } })
      
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
      
      // Ensure client is subscribed to BOTH event systems (tab model - additive)
      // Old system
      if (!client.subscribedSessions.has(sessionId)) {
        const sid = sessionId
        const unsubscribe = sessionEvents.subscribe(sid, (event, seq) => {
          send({ ...event, seq, sessionId: sid })
        })
        client.subscribedSessions.set(sessionId, unsubscribe)
      }
      
      // New system (EventStore) - already subscribed in session.load, but ensure it here too
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
        sessionId,
        llmClient,
        signal: controller.signal,
      }).catch((error) => {
        // Don't create error message for controlled abort
        if (error instanceof Error && error.message === 'Aborted') {
          return
        }
        logger.error('Chat error', { error })
        // Errors are handled inside runChatTurn and appended to EventStore
      }).finally(() => {
        activeAgents.delete(sessionId)
        sessionManager.setRunning(sessionId, false)
        eventStore.append(sessionId, { type: 'running.changed', data: { isRunning: false } })
      })
      
      break
    }
    
    case 'chat.stop': {
      if (!client.activeSessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      
      const sessionId = client.activeSessionId
      
      // Abort any running agent
      const controller = activeAgents.get(sessionId)
      if (controller) {
        controller.abort()
        activeAgents.delete(sessionId)
      }
      
      sessionManager.setRunning(sessionId, false)
      
      // Don't create a separate "stopped" message - the tool results will include
      // [interrupted by user] marker which is sufficient for AI context.
      // Just emit done event with empty messageId (client handles this)
      sessionEvents.push(sessionId, createChatDoneMessage('', 'stopped'))
      
      // Schedule cleanup after brief delay
      sessionEvents.scheduleCleanup(sessionId)
      
      send({ type: 'ack', payload: {}, id: message.id })
      break
    }
    
    case 'chat.continue': {
      if (!client.activeSessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      
      const session = sessionManager.requireSession(client.activeSessionId)
      
      // Don't continue if already running
      if (session.isRunning) {
        send(createErrorMessage('ALREADY_RUNNING', 'Chat is already running', message.id))
        return
      }
      
      // Don't continue in planner mode (planner only responds to user messages)
      if (session.mode === 'planner') {
        send(createErrorMessage('INVALID_MODE', 'Cannot continue in planner mode', message.id))
        return
      }
      
      const sessionId = client.activeSessionId
      
      // Acknowledge immediately
      send({ type: 'ack', payload: {}, id: message.id })
      
      // Mark session as running
      sessionManager.setRunning(sessionId, true)
      
      // Create AbortController
      const controller = new AbortController()
      activeAgents.set(sessionId, controller)
      
      // Ensure client is subscribed to this session's events (tab model - additive)
      if (!client.subscribedSessions.has(sessionId)) {
        const sid = sessionId  // Capture for closure
        const unsubscribe = sessionEvents.subscribe(sid, (event, seq) => {
          send({ ...event, seq, sessionId: sid })
        })
        client.subscribedSessions.set(sessionId, unsubscribe)
      }
      
      // Continue chat with events going through queue
      handleChat({
        sessionId,
        llmClient,
        signal: controller.signal,
        onMessage: (event) => sessionEvents.push(sessionId, event),
      }).catch((error) => {
        // Don't create error message for controlled abort - tool results already have the marker
        if (error instanceof Error && error.message === 'Aborted') {
          return
        }
        logger.error('Continue error', { error })
        // Create error message so we have a messageId for the done event
        const errorMsg = sessionManager.addMessage(sessionId, {
          role: 'user',
          content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          tokenCount: 10,
          isSystemGenerated: true,
          messageKind: 'correction',
        })
        sessionEvents.push(sessionId, createChatMessageMessage(errorMsg))
        sessionEvents.push(sessionId, createChatErrorMessage(
          error instanceof Error ? error.message : 'Unknown error',
          false
        ))
        sessionEvents.push(sessionId, createChatDoneMessage(errorMsg.id, 'error'))
      }).finally(() => {
        activeAgents.delete(sessionId)
        sessionManager.setRunning(sessionId, false)
        sessionEvents.scheduleCleanup(sessionId)
      })
      
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
      
      // Acknowledge immediately
      send({ type: 'ack', payload: {}, id: message.id })
      
      // Ensure client is subscribed to this session's events (tab model - additive)
      if (!client.subscribedSessions.has(sessionId)) {
        const sid = sessionId  // Capture for closure
        const unsubscribe = sessionEvents.subscribe(sid, (event, seq) => {
          send({ ...event, seq, sessionId: sid })
        })
        client.subscribedSessions.set(sessionId, unsubscribe)
      }
      
      // Helper to push events through queue
      const pushEvent = (event: ServerMessage) => sessionEvents.push(sessionId, event)
      
      // Generate summary and start builder asynchronously
      ;(async () => {
        try {
          // Add summary request prompt as visible user message (auto-prompt style)
          const summaryRequestMsg = sessionManager.addMessage(sessionId, {
            role: 'user',
            content: SUMMARY_REQUEST_PROMPT,
            tokenCount: estimateTokens(SUMMARY_REQUEST_PROMPT),
            isSystemGenerated: true,
            messageKind: 'auto-prompt',
          })
          pushEvent(createChatMessageMessage(summaryRequestMsg))
          
          // Stream summary response using core function (no tools, no thinking)
          const session = sessionManager.requireSession(sessionId)
          const { content: instructions } = await getAllInstructions(session.workdir, session.projectId)
          const toolRegistry = getToolRegistryForMode('planner')
          const systemPrompt = buildPlannerPrompt(session.workdir, toolRegistry.definitions, instructions || undefined)
          const result = await streamLLMResponse({
            sessionId,
            systemPrompt,
            llmClient,
            onEvent: pushEvent,
            enableThinking: false,
          })
          
          // Emit stats for summary generation (PROMPT -> WORK -> stats+sound pattern)
          const summaryStats = computeMessageStats({
            model: llmClient.getModel(),
            mode: 'planner',
            timing: result.timing,
            usage: result.usage,
          })
          sessionManager.updateMessageStats(sessionId, result.messageId, summaryStats)
          pushEvent(createChatDoneMessage(result.messageId, 'complete', summaryStats))
          
          sessionManager.setSummary(sessionId, result.content)
          
          // Switch to builder mode and phase
          sessionManager.setMode(sessionId, 'builder')
          sessionManager.setPhase(sessionId, 'build')
          pushEvent(createModeChangedMessage('builder', false, 'Criteria accepted'))
          pushEvent(createPhaseChangedMessage('build'))
          
          // Mark session as running
          sessionManager.setRunning(sessionId, true)
          
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
            sessionId,
            llmClient,
            signal: controller.signal,
            onMessage: pushEvent,
          })
        } catch (error) {
          logger.error('mode.accept error', { error })
          // Create error message as visible user message (auto-prompt style)
          const errorMsg = sessionManager.addMessage(sessionId, {
            role: 'user',
            content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            tokenCount: 10,
            isSystemGenerated: true,
            messageKind: 'auto-prompt',
          })
          pushEvent(createChatMessageMessage(errorMsg))
          pushEvent(createChatErrorMessage(
            error instanceof Error ? error.message : 'Unknown error',
            false
          ))
          pushEvent(createChatDoneMessage(errorMsg.id, 'error'))
        } finally {
          activeAgents.delete(sessionId)
          sessionManager.setRunning(sessionId, false)
          sessionEvents.scheduleCleanup(sessionId)
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
      
      // Check if session is blocked - user intervention resets it
      if (session.phase === 'blocked') {
        logger.info('User launched runner - resetting blocked state', { sessionId: client.activeSessionId })
        sessionManager.setPhase(client.activeSessionId, 'build')
        sessionManager.resetAllCriteriaAttempts(client.activeSessionId)
        send(createPhaseChangedMessage('build'))
      }
      
      const sessionId = client.activeSessionId
      
      // Mark session as running
      sessionManager.setRunning(sessionId, true)
      
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
      
      // Ensure client is subscribed to this session's events (tab model - additive)
      if (!client.subscribedSessions.has(sessionId)) {
        const sid = sessionId  // Capture for closure
        const unsubscribe = sessionEvents.subscribe(sid, (event, seq) => {
          send({ ...event, seq, sessionId: sid })
        })
        client.subscribedSessions.set(sessionId, unsubscribe)
      }
      
      // Run orchestrator asynchronously
      logger.info('Runner launching', { sessionId, pendingCriteria: pendingCriteria.length })
      
      runOrchestrator({
        sessionId,
        llmClient,
        signal: controller.signal,
        onMessage: (event) => sessionEvents.push(sessionId, event),
      }).catch((error) => {
        // Don't create error message for controlled abort - tool results already have the marker
        if (error instanceof Error && error.message === 'Aborted') {
          return
        }
        logger.error('Runner error', { error, sessionId })
        const errorMsg = sessionManager.addMessage(sessionId, {
          role: 'user',
          content: `Runner error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          tokenCount: 20,
          isSystemGenerated: true,
          messageKind: 'correction',
        })
        sessionEvents.push(sessionId, createChatMessageMessage(errorMsg))
        sessionEvents.push(sessionId, createChatErrorMessage(
          error instanceof Error ? error.message : 'Unknown error',
          false
        ))
        sessionEvents.push(sessionId, createChatDoneMessage(errorMsg.id, 'error'))
      }).finally(() => {
        activeAgents.delete(sessionId)
        sessionManager.setRunning(sessionId, false)
        sessionEvents.scheduleCleanup(sessionId)
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
