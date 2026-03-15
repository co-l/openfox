import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'node:http'
import type { ServerMessage } from '@openfox/shared/protocol'
import type { Config } from '../config.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { ToolRegistry } from '../tools/index.js'
import { sessionManager } from '../session/index.js'
import { sessionEvents } from '../session/events.js'
import { handleChat } from '../chat/index.js'
import { runOrchestrator } from '../runner/index.js'
import { streamLLMResponse } from '../chat/stream.js'
import { buildPlannerPrompt, SUMMARY_REQUEST_PROMPT, COMPACTION_PROMPT } from '../chat/prompts.js'
import { getToolRegistryForMode, providePathConfirmation, addAllowedPaths } from '../tools/index.js'
import { estimateTokens } from '../context/tokenizer.js'
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
      if (client.sessionId === sessionId && ws.readyState === WebSocket.OPEN) {
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
      
      const updated = updateProject(message.payload.projectId, { name: message.payload.name })
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
      
      // Send context state
      const contextState = sessionManager.getContextState(session.id)
      send(createContextStateMessage(contextState))
      
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
      
      // Check if session is blocked - user intervention resets it
      const currentSession = sessionManager.requireSession(client.sessionId)
      if (currentSession.phase === 'blocked') {
        logger.info('User intervention - resetting blocked state', { sessionId: client.sessionId })
        sessionManager.setPhase(client.sessionId, 'build')
        sessionManager.resetAllCriteriaAttempts(client.sessionId)
        send(createPhaseChangedMessage('build'))
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
        role: 'user',
        content: 'Chat stopped by user',
        tokenCount: 5,
        isSystemGenerated: true,
        messageKind: 'auto-prompt',
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
          const toolRegistry = getToolRegistryForMode('planner')
          const systemPrompt = buildPlannerPrompt(toolRegistry.definitions)
          const result = await streamLLMResponse({
            sessionId,
            systemPrompt,
            llmClient,
            onEvent: pushEvent,
            enableThinking: false,
          })
          sessionManager.setSummary(sessionId, result.content)
          
          // Switch to builder mode and phase
          sessionManager.setMode(sessionId, 'builder')
          sessionManager.setPhase(sessionId, 'build')
          pushEvent(createModeChangedMessage('builder', false, 'Criteria accepted'))
          pushEvent(createPhaseChangedMessage('build'))
          
          // Mark session as running
          sessionManager.setRunning(sessionId, true)
          
          // Create AbortController for builder
          const controller = new AbortController()
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
    
    // =========================================================================
    // Context Management
    // =========================================================================
    
    case 'context.compact': {
      if (!client.sessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      
      const session = sessionManager.requireSession(client.sessionId)
      const sessionId = client.sessionId
      
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
          const toolRegistry = getToolRegistryForMode('planner')
          const systemPrompt = buildPlannerPrompt(toolRegistry.definitions)
          const result = await streamLLMResponse({
            sessionId,
            systemPrompt,
            llmClient,
            onEvent: send,
          })
          
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
      if (!client.sessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      
      const session = sessionManager.requireSession(client.sessionId)
      
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
        logger.info('User launched runner - resetting blocked state', { sessionId: client.sessionId })
        sessionManager.setPhase(client.sessionId, 'build')
        sessionManager.resetAllCriteriaAttempts(client.sessionId)
        send(createPhaseChangedMessage('build'))
      }
      
      const sessionId = client.sessionId
      
      // Mark session as running
      sessionManager.setRunning(sessionId, true)
      
      // Create AbortController for this run
      const controller = new AbortController()
      activeAgents.set(sessionId, controller)
      
      // Acknowledge immediately
      send({ type: 'ack', payload: {}, id: message.id })
      
      // Subscribe this client to session events
      client.eventUnsubscribe?.()
      client.eventUnsubscribe = sessionEvents.subscribe(sessionId, (event, seq) => {
        send({ ...event, seq })
      })
      
      // Run orchestrator asynchronously
      logger.info('Runner launching', { sessionId, pendingCriteria: pendingCriteria.length })
      
      runOrchestrator({
        sessionId,
        llmClient,
        signal: controller.signal,
        onMessage: (event) => sessionEvents.push(sessionId, event),
      }).catch((error) => {
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
      if (!client.sessionId) {
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
      
      logger.info('Path confirmation response', { 
        sessionId: client.sessionId, 
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
