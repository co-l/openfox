import type { LLMClientWithModel } from '../llm/client.js'
import type { StatsIdentity, Attachment } from '../../shared/types.js'
import type { ServerMessage } from '../../shared/protocol.js'
import type { SessionManager } from './index.js'
import type { ProviderManager } from '../provider-manager.js'
import { getEventStore } from '../events/index.js'
import { runChatTurn } from '../chat/orchestrator.js'
import { buildRunChatTurnParams } from '../utils/session-utils.js'
import { generateSessionNameForSession } from './name-generator.js'

import { createChatMessageMessage, createSessionRunningMessage, createPhaseChangedMessage } from '../ws/protocol.js'
import { finalizeTurnCompletion } from '../utils/session-utils.js'

const activeAgents = new Map<string, AbortController>()
const abortedSessions = new Set<string>()

export interface ChatHandlerDeps {
  sessionManager: SessionManager
  providerManager: ProviderManager
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
  },
): Promise<void> {
  const { sessionManager, broadcastForSession } = deps

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
    // Add user message
    const userMessage = sessionManager.addMessage(sessionId, {
      role: 'user',
      content,
      ...(options?.attachments && { attachments: options.attachments }),
      ...(options?.messageKind && { messageKind: options.messageKind }),
      ...(options?.isSystemGenerated && { isSystemGenerated: options.isSystemGenerated }),
    })

    broadcastForSession(sessionId, createChatMessageMessage(userMessage))

    // Generate session name if needed (fire-and-forget)
    generateSessionNameForSession(
      sessionId,
      content,
      {
        sessionManager,
        providerManager: deps.providerManager,
        broadcastForSession,
        eventStore,
      },
      controller.signal,
    )

    // Start the chat turn
    startTurnWithCompletionChain(sessionId, controller, deps)
  } catch (error) {
    if (activeAgents.get(sessionId) === controller) {
      activeAgents.delete(sessionId)
    }
    try {
      sessionManager.setRunning(sessionId, false)
      broadcastForSession(sessionId, createSessionRunningMessage(false))
    } catch {
      // Session may have been deleted or invalidated
    }
    finalizeTurnCompletion(sessionId, sessionManager, broadcastForSession)
    throw error
  }
}

function startTurnWithCompletionChain(sessionId: string, controller: AbortController, deps: ChatHandlerDeps): void {
  const { sessionManager, llmClient, statsIdentity, broadcastForSession } = deps

  runChatTurn(
    buildRunChatTurnParams({
      sessionManager,
      sessionId,
      llmClient,
      statsIdentity,
      signal: controller.signal,
      onMessage: (msg) => broadcastForSession(sessionId, msg),
    }),
  )
    .catch((error) => {
      if (error instanceof Error && error.message === 'Aborted') {
        return
      }
    })
    .finally(() => {
      if (activeAgents.get(sessionId) !== controller) {
        return
      }
      activeAgents.delete(sessionId)

      if (abortedSessions.has(sessionId)) {
        abortedSessions.delete(sessionId)
        sessionManager.clearMessageQueue(sessionId)
        finalizeTurnCompletion(sessionId, sessionManager, broadcastForSession)
        return
      }

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
  abortedSessions.add(sessionId)
  const controller = activeAgents.get(sessionId)
  if (controller) {
    activeAgents.delete(sessionId)
    controller.abort()
  }

  // Release a paused gate immediately (setRunning(false) also clears it, but
  // this gives the UI instant feedback on Stop).
  sessionManager.clearPauseState(sessionId)
  sessionManager.setRunning(sessionId, false)
}

/**
 * Cancel all pending user-interaction gates for a session (ask_user
 * questions, path confirmations), record the terminal running state in the
 * event log, and force a final session.state re-broadcast.
 *
 * The session.state broadcast triggered by setRunning(false) fires BEFORE the
 * gates are cancelled, and cancelled path confirmations only leave the
 * event-sourced fold once a path.confirmation_responded event closes them
 * out. Without the explicit re-broadcast here, clients would converge on the
 * stale "waiting for input" state — the Allow/Deny buttons and tooltip would
 * stick after Stop.
 *
 * @returns the callIds of the cancelled path confirmations, so the caller can
 * broadcast a session.confirmation_resolved for each (cross-delivered to
 * other clients of the same project, clearing their home-page waiting dots).
 */
export async function cancelSessionInteractions(
  sessionId: string,
  sessionManager: SessionManager,
  reason: string,
): Promise<string[]> {
  const { cancelQuestionsForSession, cancelPathConfirmationsForSession, getPendingPathConfirmationCallIds } =
    await import('../tools/index.js')
  const cancelledCallIds = getPendingPathConfirmationCallIds(sessionId)
  cancelQuestionsForSession(sessionId, reason)
  cancelPathConfirmationsForSession(sessionId, reason)
  getEventStore().append(sessionId, { type: 'running.changed', data: { isRunning: false } })
  sessionManager.emitBranchChange(sessionId)
  return cancelledCallIds
}
