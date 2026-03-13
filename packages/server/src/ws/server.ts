import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'node:http'
import type { ServerMessage, AgentEvent } from '@openfox/shared/protocol'
import { createServerMessage } from '@openfox/shared/protocol'
import type { Config } from '../config.js'
import type { LLMClient } from '../llm/types.js'
import type { ToolRegistry } from '../tools/index.js'
import { sessionManager } from '../session/index.js'
import { plannerChat, acceptCriteria } from '../planner/index.js'
import { runAgent } from '../agent/index.js'
import { validate } from '../validator/index.js'
import { provideAnswer } from '../tools/index.js'
import { logger } from '../utils/logger.js'
import {
  parseClientMessage,
  serializeServerMessage,
  createErrorMessage,
  createSessionStateMessage,
  createSessionListMessage,
  isSessionCreatePayload,
  isSessionLoadPayload,
  isPlanMessagePayload,
  isPlanEditCriteriaPayload,
  isAgentIntervenePayload,
  isCriterionHumanVerifyPayload,
} from './protocol.js'

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
        if (event.type === 'session_updated' || event.type === 'phase_changed') {
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
  message: import('@openfox/shared/protocol').ClientMessage,
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
    case 'session.create': {
      if (!isSessionCreatePayload(message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid payload for session.create', message.id))
        return
      }
      
      const session = sessionManager.createSession(message.payload.workdir, message.payload.title)
      client.sessionId = session.id
      send(createSessionStateMessage(session, message.id))
      break
    }
    
    case 'session.load': {
      if (!isSessionLoadPayload(message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid payload for session.load', message.id))
        return
      }
      
      const session = sessionManager.getSession(message.payload.sessionId)
      if (!session) {
        send(createErrorMessage('SESSION_NOT_FOUND', 'Session not found', message.id))
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
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid payload for session.delete', message.id))
        return
      }
      
      sessionManager.deleteSession(message.payload.sessionId)
      send(createServerMessage('session.deleted', { sessionId: message.payload.sessionId }, message.id))
      break
    }
    
    case 'plan.message': {
      if (!client.sessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      
      if (!isPlanMessagePayload(message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid payload for plan.message', message.id))
        return
      }
      
      // Stream planner response
      for await (const event of plannerChat(client.sessionId, message.payload.content, llmClient, toolRegistry)) {
        switch (event.type) {
          case 'text_delta':
            send(createServerMessage('plan.delta', { content: event.content, isThinking: false }))
            break
          case 'tool_call':
            send(createServerMessage('plan.tool_call', { tool: event.tool, args: event.args }))
            break
          case 'tool_result':
            send(createServerMessage('plan.tool_result', { tool: event.tool, result: event.result }))
            break
          case 'thinking_delta':
            send(createServerMessage('plan.delta', { content: event.content, isThinking: true }))
            break
          case 'criteria_set':
            // LLM called set_acceptance_criteria tool
            send(createServerMessage('plan.criteria', { criteria: event.criteria }))
            break
          case 'done':
            send(createServerMessage('plan.done', {}, message.id))
            break
          case 'error':
            send(createErrorMessage('PLANNER_ERROR', event.error, message.id))
            break
        }
      }
      break
    }
    
    case 'plan.edit_criteria': {
      if (!client.sessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      
      if (!isPlanEditCriteriaPayload(message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid payload for plan.edit_criteria', message.id))
        return
      }
      
      sessionManager.setCriteria(client.sessionId, message.payload.criteria)
      send(createServerMessage('plan.criteria', { criteria: message.payload.criteria }, message.id))
      break
    }
    
    case 'plan.accept': {
      if (!client.sessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      
      await acceptCriteria(client.sessionId)
      const session = sessionManager.requireSession(client.sessionId)
      send(createSessionStateMessage(session, message.id))
      break
    }
    
    case 'agent.start': {
      if (!client.sessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      
      // Run agent (this is async but we don't await - events are streamed)
      runAgent({
        sessionId: client.sessionId,
        llmClient,
        toolRegistry,
        config,
        onEvent: (event: AgentEvent) => {
          send(createServerMessage('agent.event', { event }))
        },
      }).catch((error) => {
        logger.error('Agent error', { error })
        send(createServerMessage('agent.event', {
          event: {
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
            recoverable: false,
          },
        }))
      })
      
      send(createServerMessage('ack', {}, message.id))
      break
    }
    
    case 'agent.intervene': {
      if (!client.sessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      
      if (!isAgentIntervenePayload(message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid payload for agent.intervene', message.id))
        return
      }
      
      // This would need the callId from the ask_user event
      // For now, add the response as a user message and resume
      sessionManager.addMessage(client.sessionId, {
        role: 'user',
        content: message.payload.response,
        tokenCount: Math.ceil(message.payload.response.length / 4),
      })
      
      // Resume agent
      runAgent({
        sessionId: client.sessionId,
        llmClient,
        toolRegistry,
        config,
        onEvent: (event: AgentEvent) => {
          send(createServerMessage('agent.event', { event }))
        },
      }).catch((error) => {
        logger.error('Agent error', { error })
      })
      
      send(createServerMessage('ack', {}, message.id))
      break
    }
    
    case 'validate.start': {
      if (!client.sessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      
      const result = await validate({
        sessionId: client.sessionId,
        llmClient,
      })
      
      send(createServerMessage('validation.result', { result }, message.id))
      
      // Send updated session state
      const session = sessionManager.requireSession(client.sessionId)
      send(createSessionStateMessage(session))
      break
    }
    
    case 'criterion.human_verify': {
      if (!client.sessionId) {
        send(createErrorMessage('NO_SESSION', 'No active session', message.id))
        return
      }
      
      if (!isCriterionHumanVerifyPayload(message.payload)) {
        send(createErrorMessage('INVALID_PAYLOAD', 'Invalid payload for criterion.human_verify', message.id))
        return
      }
      
      const status = message.payload.passed
        ? { type: 'passed' as const, verifiedAt: new Date().toISOString(), verifiedBy: 'human' as const }
        : { type: 'failed' as const, reason: message.payload.reason ?? 'Failed human verification', failedAt: new Date().toISOString() }
      
      sessionManager.updateCriterionStatus(client.sessionId, message.payload.criterionId, status)
      
      const session = sessionManager.requireSession(client.sessionId)
      send(createSessionStateMessage(session, message.id))
      break
    }
    
    default:
      send(createErrorMessage('UNKNOWN_MESSAGE_TYPE', `Unknown message type: ${message.type}`, message.id))
  }
}
