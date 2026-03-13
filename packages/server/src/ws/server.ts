import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'node:http'
import type { ServerMessage } from '@openfox/shared/protocol'
import type { Config } from '../config.js'
import type { LLMClient } from '../llm/types.js'
import type { ToolRegistry } from '../tools/index.js'
import { sessionManager } from '../session/index.js'
import { logger } from '../utils/logger.js'
import {
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject,
} from '../db/projects.js'
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
  createChatDoneMessage,
  createChatErrorMessage,
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
            ws.send(serializeServerMessage(createSessionStateMessage(session)))
          }
        }
      }
    }
  })
  
  wss.on('connection', (ws) => {
    logger.info('WebSocket client connected')
    clients.set(ws, { ws, sessionId: null })
    
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
      send(createSessionStateMessage(session, message.id))
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
      
      client.sessionId = session.id
      send(createSessionStateMessage(session, message.id))
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
      
      const session = sessionManager.requireSession(client.sessionId)
      
      // Add user message
      sessionManager.addMessage(client.sessionId, {
        role: 'user',
        content: message.payload.content,
        tokenCount: Math.ceil(message.payload.content.length / 4),
      })
      
      // Mark session as running
      sessionManager.setRunning(client.sessionId, true)
      
      // TODO: Implement mode-aware chat handling
      // For now, just acknowledge and mark as done
      send({ type: 'ack', payload: {}, id: message.id })
      
      // Placeholder: Send a simple response
      send(createChatDeltaMessage('Chat handling not yet implemented. Mode: ' + session.mode))
      send(createChatDoneMessage('complete'))
      
      sessionManager.setRunning(client.sessionId, false)
      break
    }
    
    case 'chat.stop': {
      if (!client.sessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      
      // Abort any running agent
      const controller = activeAgents.get(client.sessionId)
      if (controller) {
        controller.abort()
        activeAgents.delete(client.sessionId)
      }
      
      sessionManager.setRunning(client.sessionId, false)
      send(createChatDoneMessage('stopped'))
      send({ type: 'ack', payload: {}, id: message.id })
      break
    }
    
    case 'chat.continue': {
      if (!client.sessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      
      // TODO: Implement continue logic
      send({ type: 'ack', payload: {}, id: message.id })
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
      send(createSessionStateMessage(session, message.id))
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
      
      // TODO: Generate summary from conversation
      const summary = 'Task summary generation not yet implemented.'
      sessionManager.setSummary(client.sessionId, summary)
      
      // Switch to builder mode
      sessionManager.setMode(client.sessionId, 'builder')
      
      // Emit events
      send(createModeChangedMessage('builder', false, 'Criteria accepted'))
      
      const updatedSession = sessionManager.requireSession(client.sessionId)
      send(createSessionStateMessage(updatedSession, message.id))
      
      // TODO: Auto-start builder
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
