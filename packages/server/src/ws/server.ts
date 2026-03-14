import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'node:http'
import type { ServerMessage } from '@openfox/shared/protocol'
import type { Config } from '../config.js'
import type { LLMClient } from '../llm/types.js'
import type { ToolRegistry } from '../tools/index.js'
import { sessionManager } from '../session/index.js'
import { sessionEvents } from '../session/events.js'
import { handleChat, generateSummary } from '../chat/index.js'
import { logger } from '../utils/logger.js'
import {
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject,
} from '../db/projects.js'
import { getMessages } from '../db/sessions.js'
import {
  parseClientMessage,
  serializeServerMessage,
  createErrorMessage,
  createSessionStateMessage,
  createSessionListMessage,
  createProjectStateMessage,
  createProjectListMessage,
  createChatDeltaMessage,
  createChatThinkingMessage,
  createChatToolCallMessage,
  createChatToolResultMessage,
  createChatMessageMessage,
  createChatDoneMessage,
  createChatErrorMessage,
  createChatProgressMessage,
  createModeChangedMessage,
  createCriteriaUpdatedMessage,
  isProjectCreatePayload,
  isProjectLoadPayload,
  isProjectUpdatePayload,
  isProjectDeletePayload,
  isSessionCreatePayload,
  isSessionLoadPayload,
  isChatSendPayload,
  isModeSwitchPayload,
  isCriteriaEditPayload,
} from './protocol.js'

// Track active agent AbortControllers by sessionId
const activeAgents = new Map<string, AbortController>()

interface ClientConnection {
  ws: WebSocket
  sessionId: string | null
  eventUnsubscribe: (() => void) | null  // Unsubscribe from session events
}

export function createWebSocketServer(
  httpServer: Server,
  config: Config,
  llmClient: LLMClient,
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
      if (client.sessionId === sessionId && ws.readyState === WebSocket.OPEN) {
        if (event.type === 'session_updated' || event.type === 'mode_changed') {
          const session = sessionManager.getSession(sessionId)
          if (session) {
            const messages = getMessages(sessionId)
            ws.send(serializeServerMessage(createSessionStateMessage(session, messages)))
          }
        }
      }
    }
  })
  
  wss.on('connection', (ws) => {
    logger.info('WebSocket client connected')
    clients.set(ws, { ws, sessionId: null, eventUnsubscribe: null })
    
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
      logger.info('WebSocket client disconnected')
      const client = clients.get(ws)
      client?.eventUnsubscribe?.()  // Unsubscribe from session events
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
  llmClient: LLMClient,
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
      
      const updated = updateProject(message.payload.projectId, message.payload.name)
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
      client.sessionId = session.id
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
      
      // Unsubscribe from previous session events if any
      client.eventUnsubscribe?.()
      client.eventUnsubscribe = null
      
      client.sessionId = session.id
      // Fetch all messages for this session (server-authoritative)
      const messages = getMessages(session.id)
      send(createSessionStateMessage(session, messages, message.id))
      
      // If session is running, replay missed events and subscribe to future events
      if (session.isRunning) {
        const fromSeq = message.payload.lastEventSeq ?? 0
        
        // Replay missed events
        const missedEvents = sessionEvents.getEvents(session.id, fromSeq)
        for (const { event, seq } of missedEvents) {
          // Add seq to event for frontend tracking
          send({ ...event, seq })
        }
        
        logger.info('Replayed missed events', { 
          sessionId: session.id, 
          fromSeq, 
          replayedCount: missedEvents.length 
        })
        
        // Subscribe to future events
        client.eventUnsubscribe = sessionEvents.subscribe(session.id, (event, seq) => {
          send({ ...event, seq })
        })
      }
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
      if (!client.sessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      
      if (!isChatSendPayload(message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid chat.send payload', message.id))
        return
      }
      
      // Add user message and notify client (server-authoritative)
      const userMessage = sessionManager.addMessage(client.sessionId, {
        role: 'user',
        content: message.payload.content,
        tokenCount: Math.ceil(message.payload.content.length / 4),
      })
      
      // Mark session as running
      sessionManager.setRunning(client.sessionId, true)
      
      // Create AbortController for this chat
      const controller = new AbortController()
      const sessionId = client.sessionId
      activeAgents.set(sessionId, controller)
      
      // Acknowledge immediately
      send({ type: 'ack', payload: {}, id: message.id })
      
      // Subscribe this client to session events (unsubscribe from previous if any)
      client.eventUnsubscribe?.()
      client.eventUnsubscribe = sessionEvents.subscribe(sessionId, (event, seq) => {
        send({ ...event, seq })
      })
      
      // Send the user message immediately so client has it in its messages array
      sessionEvents.push(sessionId, createChatMessageMessage(userMessage))
      
      // Run chat asynchronously with events going through queue
      handleChat({
        sessionId,
        llmClient,
        signal: controller.signal,
        onMessage: (event) => sessionEvents.push(sessionId, event),
      }).catch((error) => {
        logger.error('Chat error', { error })
        // Create an error message so we have a messageId for the done event
        const errorMsg = sessionManager.addMessage(sessionId, {
          role: 'system',
          content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          tokenCount: 10,
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
    
    case 'chat.stop': {
      if (!client.sessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      
      const sessionId = client.sessionId
      
      // Abort any running agent
      const controller = activeAgents.get(sessionId)
      if (controller) {
        controller.abort()
        activeAgents.delete(sessionId)
      }
      
      sessionManager.setRunning(sessionId, false)
      
      // Create stop message to get a messageId for the done event
      const stopMsg = sessionManager.addMessage(sessionId, {
        role: 'system',
        content: 'Chat stopped by user',
        tokenCount: 5,
      })
      sessionEvents.push(sessionId, createChatMessageMessage(stopMsg))
      sessionEvents.push(sessionId, createChatDoneMessage(stopMsg.id, 'stopped'))
      
      // Schedule cleanup after brief delay
      sessionEvents.scheduleCleanup(sessionId)
      
      send({ type: 'ack', payload: {}, id: message.id })
      break
    }
    
    case 'chat.continue': {
      if (!client.sessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      
      const session = sessionManager.requireSession(client.sessionId)
      
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
      
      const sessionId = client.sessionId
      
      // Acknowledge immediately
      send({ type: 'ack', payload: {}, id: message.id })
      
      // Mark session as running
      sessionManager.setRunning(sessionId, true)
      
      // Create AbortController
      const controller = new AbortController()
      activeAgents.set(sessionId, controller)
      
      // Subscribe this client to session events (unsubscribe from previous if any)
      client.eventUnsubscribe?.()
      client.eventUnsubscribe = sessionEvents.subscribe(sessionId, (event, seq) => {
        send({ ...event, seq })
      })
      
      // Continue chat with events going through queue
      handleChat({
        sessionId,
        llmClient,
        signal: controller.signal,
        onMessage: (event) => sessionEvents.push(sessionId, event),
      }).catch((error) => {
        logger.error('Continue error', { error })
        // Create error message so we have a messageId for the done event
        const errorMsg = sessionManager.addMessage(sessionId, {
          role: 'system',
          content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          tokenCount: 10,
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
      if (!client.sessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      
      if (!isModeSwitchPayload(message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid mode.switch payload', message.id))
        return
      }
      
      const session = sessionManager.setMode(client.sessionId, message.payload.mode)
      send(createModeChangedMessage(message.payload.mode, false))
      const messages = getMessages(session.id)
      send(createSessionStateMessage(session, messages, message.id))
      break
    }
    
    case 'mode.accept': {
      if (!client.sessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      
      const session = sessionManager.requireSession(client.sessionId)
      
      if (session.criteria.length === 0) {
        send(createErrorMessage('NO_CRITERIA', 'Cannot accept: no criteria defined', message.id))
        return
      }
      
      const sessionId = client.sessionId
      
      // Acknowledge immediately
      send({ type: 'ack', payload: {}, id: message.id })
      
      // Subscribe this client to session events (unsubscribe from previous if any)
      client.eventUnsubscribe?.()
      client.eventUnsubscribe = sessionEvents.subscribe(sessionId, (event, seq) => {
        send({ ...event, seq })
      })
      
      // Helper to push events through queue
      const pushEvent = (event: ServerMessage) => sessionEvents.push(sessionId, event)
      
      // Generate summary asynchronously
      ;(async () => {
        try {
          // Progress: generating summary
          pushEvent(createChatProgressMessage('Generating task summary...', 'summary'))
          
          // Generate summary from conversation
          const summary = await generateSummary(sessionId, llmClient)
          sessionManager.setSummary(sessionId, summary)
          
          // Send summary to client
          pushEvent({ type: 'chat.summary', payload: { summary } })
          
          // Progress: switching mode
          pushEvent(createChatProgressMessage('Switching to builder mode...', 'mode_switch'))
          
          // Switch to builder mode
          sessionManager.setMode(sessionId, 'builder')
          pushEvent(createModeChangedMessage('builder', false, 'Criteria accepted'))
          
          const updatedSession = sessionManager.requireSession(sessionId)
          const updatedMessages = getMessages(sessionId)
          pushEvent(createSessionStateMessage(updatedSession, updatedMessages))
          
          // Mark session as running
          sessionManager.setRunning(sessionId, true)
          
          // Create AbortController for builder
          const controller = new AbortController()
          activeAgents.set(sessionId, controller)
          
          // Progress: starting implementation
          pushEvent(createChatProgressMessage('Starting implementation...', 'starting'))
          
          // Auto-start builder
          await handleChat({
            sessionId,
            llmClient,
            signal: controller.signal,
            onMessage: pushEvent,
          })
        } catch (error) {
          logger.error('mode.accept error', { error })
          // Create error message so we have a messageId for the done event
          const errorMsg = sessionManager.addMessage(sessionId, {
            role: 'system',
            content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            tokenCount: 10,
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
      if (!client.sessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      
      if (!isCriteriaEditPayload(message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid criteria.edit payload', message.id))
        return
      }
      
      sessionManager.setCriteria(client.sessionId, message.payload.criteria)
      send(createCriteriaUpdatedMessage(message.payload.criteria))
      send({ type: 'ack', payload: {}, id: message.id })
      break
    }
    
    default: {
      send(createErrorMessage('UNKNOWN_MESSAGE', `Unknown message type: ${message.type}`, message.id))
    }
  }
}
