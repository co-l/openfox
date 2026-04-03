import type { LLMClientWithModel } from '../llm/client.js'
import type { StatsIdentity, Attachment } from '../../shared/types.js'
import type { ServerMessage } from '../../shared/protocol.js'
import type { SessionManager } from './index.js'
import { getEventStore } from '../events/index.js'
import { buildMessagesFromStoredEvents } from '../events/folding.js'
import { runChatTurn } from '../chat/orchestrator.js'
import { generateSessionName, needsNameGeneration } from './name-generator.js'
import { updateSessionMetadata } from '../db/sessions.js'
import { createChatMessageMessage, createSessionStateMessage, createSessionRunningMessage, createPhaseChangedMessage, createContextStateMessage } from '../ws/protocol.js'

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
    if (currentSession && needsNameGeneration(currentSession.metadata.title, messageCount)) {
      generateSessionName({
        userMessage: content,
        llmClient,
        signal: controller.signal,
      })
        .then((result) => {
          if (result.success && result.name) {
            updateSessionMetadata(sessionId, { title: result.name })
            eventStore.append(sessionId, {
              type: 'session.name_generated',
              data: { name: result.name },
            })
            const updatedSession = sessionManager.getSession(sessionId)
            if (updatedSession) {
              const events = eventStore.getEvents(sessionId)
              const messages = buildMessagesFromStoredEvents(events)
              broadcastForSession(sessionId, createSessionStateMessage(updatedSession, messages))
            }
          }
        })
        .catch(() => {})
    }

    // Start the chat turn
    startTurnWithCompletionChain(sessionId, controller, deps)
  } catch (error) {
    if (activeAgents.get(sessionId) === controller) {
      activeAgents.delete(sessionId)
    }
    sessionManager.setRunning(sessionId, false)
    broadcastForSession(sessionId, createSessionRunningMessage(false))
    const contextState = sessionManager.getContextState(sessionId)
    broadcastForSession(sessionId, createContextStateMessage(contextState))
    throw error
  }
}

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
    sessionManager.setRunning(sessionId, false)
    const contextState = sessionManager.getContextState(sessionId)
    broadcastForSession(sessionId, createContextStateMessage(contextState))
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