import type { LLMClientWithModel } from '../llm/client.js'
import type { StatsIdentity, Attachment } from '../../shared/types.js'
import type { ServerMessage } from '../../shared/protocol.js'
import type { SessionManager } from './index.js'
import { getEventStore } from '../events/index.js'
import { runChatTurn } from '../chat/orchestrator.js'
import { generateSessionName, needsNameGenerationCheck, applyGeneratedSessionName } from './name-generator.js'
import { logger } from '../utils/logger.js'

import { createChatMessageMessage, createSessionRunningMessage, createPhaseChangedMessage } from '../ws/protocol.js'
import { finalizeTurnCompletion, getSessionMessageCount } from '../utils/session-utils.js'

const activeAgents = new Map<string, AbortController>()

export interface ChatHandlerDeps {
  sessionManager: SessionManager
  llmClient: LLMClientWithModel
  statsIdentity: StatsIdentity
  broadcastForSession: (sessionId: string, msg: ServerMessage) => void
}

export async function startChatSession(
  sessionId: string,
  content: string,
  deps: ChatHandlerDeps,
  options?: {
    attachments?: Attachment[]
    messageKind?: 'correction' | 'auto-prompt' | 'context-reset' | 'task-completed' | 'workflow-started' | 'command'
    isSystemGenerated?: boolean
  }
): Promise<void> {
  const { sessionManager, llmClient, statsIdentity, broadcastForSession } = deps

  const session = sessionManager.getSession(sessionId)
  if (!session) {
    throw new Error('Session not found')
  }

  const eventStore = getEventStore()

  // Check if session is already running
  if (session.isRunning) {
    throw new Error('Session is already running')
  }

  // Check if session is blocked - user intervention resets it
  if (session.phase === 'blocked') {
    sessionManager.setPhase(sessionId, 'build')
    sessionManager.resetAllCriteriaAttempts(sessionId)
    broadcastForSession(sessionId, createPhaseChangedMessage('build'))
  }

  // Create AbortController
  const controller = new AbortController()
  const existingController = activeAgents.get(sessionId)
  if (existingController) {
    existingController.abort()
  }
  activeAgents.set(sessionId, controller)

  // Mark session as running
  sessionManager.setRunning(sessionId, true)
  broadcastForSession(sessionId, createSessionRunningMessage(true))

  try {
    // Auto-compact context
    const { maybeAutoCompactContext } = await import('../context/auto-compaction.js')
    await maybeAutoCompactContext({
      sessionManager,
      sessionId,
      llmClient,
      statsIdentity,
      signal: controller.signal,
    })

    if (controller.signal.aborted) {
      return
    }

    // Add user message
    const userMessage = sessionManager.addMessage(sessionId, {
      role: 'user',
      content,
      ...(options?.attachments && { attachments: options.attachments }),
      ...(options?.messageKind && { messageKind: options.messageKind }),
      ...(options?.isSystemGenerated && { isSystemGenerated: options.isSystemGenerated }),
    })

    broadcastForSession(sessionId, createChatMessageMessage(userMessage))

    // Generate session name if needed
    const messageCount = getSessionMessageCount(sessionId)
    const currentSession = sessionManager.getSession(sessionId)
    if (currentSession && needsNameGenerationCheck(sessionId, currentSession.metadata.title, messageCount)) {
      generateSessionName({
        userMessage: content,
        llmClient,
        signal: controller.signal,
      })
        .then((result) => {
          logger.debug('Session name generation result', {
            sessionId,
            success: result.success,
            name: result.name,
            error: result.error,
          })
          if (result.success && result.name) {
            applyGeneratedSessionName(sessionId, result.name, {
              sessionManager,
              eventStore,
              broadcastForSession,
            })
          }
        })
        .catch((error) => {
          logger.error('Session name generation failed', {
            sessionId,
            error: error instanceof Error ? error.message : String(error),
          })
        })
    }

    // Start the chat turn
    startTurnWithCompletionChain(sessionId, controller, deps)
  } catch (error) {
    if (activeAgents.get(sessionId) === controller) {
      activeAgents.delete(sessionId)
    }
    sessionManager.setRunning(sessionId, false)
    broadcastForSession(sessionId, createSessionRunningMessage(false))
    finalizeTurnCompletion(sessionId, sessionManager, broadcastForSession)
    throw error
  }
}



function startTurnWithCompletionChain(
  sessionId: string,
  controller: AbortController,
  deps: ChatHandlerDeps
): void {
  const { sessionManager, llmClient, statsIdentity, broadcastForSession } = deps

  runChatTurn({
    sessionManager,
    sessionId,
    llmClient,
    statsIdentity,
    signal: controller.signal,
    onMessage: (msg) => broadcastForSession(sessionId, msg),
  }).catch((error) => {
    if (error instanceof Error && error.message === 'Aborted') {
      return
    }
  }).finally(() => {
    if (activeAgents.get(sessionId) !== controller) {
      return
    }
    activeAgents.delete(sessionId)

    const completionMsgs = sessionManager.drainCompletionMessages(sessionId)
    const next = completionMsgs[0]
    if (next) {
      for (const remaining of completionMsgs.slice(1)) {
        sessionManager.queueMessage(sessionId, 'completion', remaining.content, remaining.attachments)
      }

      const userMessage = sessionManager.addMessage(sessionId, {
        role: 'user',
        content: next.content,
        ...(next.attachments ? { attachments: next.attachments } : {}),
      })
      broadcastForSession(sessionId, createChatMessageMessage(userMessage))

      const newController = new AbortController()
      activeAgents.set(sessionId, newController)
      startTurnWithCompletionChain(sessionId, newController, deps)
      return
    }

    sessionManager.clearMessageQueue(sessionId)
    finalizeTurnCompletion(sessionId, sessionManager, broadcastForSession)
  })
}

export function stopSessionExecution(sessionId: string, sessionManager: SessionManager): void {
  const controller = activeAgents.get(sessionId)
  if (controller) {
    activeAgents.delete(sessionId)
    controller.abort()
  }

  sessionManager.setRunning(sessionId, false)
}