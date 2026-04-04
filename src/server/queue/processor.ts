import type { LLMClientWithModel } from '../llm/client.js'
import type { ProviderManager } from '../provider-manager.js'
import type { SessionManager } from '../session/manager.js'
import { logger } from '../utils/logger.js'
import type { ServerMessage } from '../../shared/protocol.js'
import { createSessionRunningMessage, createChatMessageMessage, createContextStateMessage } from '../ws/protocol.js'

interface QueueProcessorDeps {
  sessionManager: SessionManager
  providerManager: ProviderManager
  getLLMClient: () => LLMClientWithModel
  getActiveProvider: (() => import('../../shared/types.js').Provider | undefined) | undefined
  broadcastForSession: (sessionId: string, msg: ServerMessage) => void
}

export class QueueProcessor {
  private deps: QueueProcessorDeps
  private unsubscribe: (() => void) | null = null
  private activeAgents = new Map<string, AbortController>()

  constructor(deps: QueueProcessorDeps) {
    this.deps = deps
  }

  start(): void {
    if (this.unsubscribe) {
      logger.warn('QueueProcessor already started')
      return
    }

    this.unsubscribe = this.deps.sessionManager.subscribe((event) => {
      if (event.type === 'queue_added') {
        this.handleQueueAdded(event.sessionId)
      } else if (event.type === 'running_changed' && !event.isRunning) {
        this.handleTurnDone(event.sessionId)
      }
    })

    logger.debug('QueueProcessor started')
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }

    for (const controller of this.activeAgents.values()) {
      controller.abort()
    }
    this.activeAgents.clear()

    logger.debug('QueueProcessor stopped')
  }

  abortSession(sessionId: string): boolean {
    const controller = this.activeAgents.get(sessionId)
    if (controller) {
      controller.abort()
      this.activeAgents.delete(sessionId)
      return true
    }
    return false
  }

  private handleQueueAdded(sessionId: string): void {
    const { sessionManager } = this.deps
    const session = sessionManager.getSession(sessionId)
    if (!session) return

    if (session.isRunning) {
      logger.debug('Session is running, not starting new turn', { sessionId })
      return
    }

    if (!sessionManager.hasQueuedMessages(sessionId)) {
      logger.debug('No queued messages', { sessionId })
      return
    }

    this.startTurn(sessionId)
  }

  private handleTurnDone(sessionId: string): void {
    logger.debug('Turn done, checking for more queued messages', { sessionId })

    const { sessionManager } = this.deps

    if (!sessionManager.hasQueuedMessages(sessionId)) {
      logger.debug('No more queued messages', { sessionId })
      return
    }

    this.startTurn(sessionId)
  }

  private startTurn(sessionId: string): void {
    const { sessionManager, broadcastForSession } = this.deps
    logger.info('Starting turn from queue processor', { sessionId })

    const session = sessionManager.getSession(sessionId)
    if (!session || session.isRunning) {
      logger.warn('Cannot start turn: session not found or already running', { sessionId })
      return
    }

    const queue = sessionManager.getQueueState(sessionId)
    if (queue.length === 0) {
      logger.warn('Cannot start turn: queue is empty', { sessionId })
      return
    }

    const controller = new AbortController()
    this.activeAgents.set(sessionId, controller)

    sessionManager.setRunning(sessionId, true)
    broadcastForSession(sessionId, createSessionRunningMessage(true))

    const nextAsap = queue.find(m => m.mode === 'asap') ?? queue[0]
    if (nextAsap) {
      sessionManager.cancelQueuedMessage(sessionId, nextAsap.queueId)
      const userMessage = sessionManager.addMessage(sessionId, {
        role: 'user',
        content: nextAsap.content,
        ...(nextAsap.attachments ? { attachments: nextAsap.attachments } : {}),
      })
      broadcastForSession(sessionId, createChatMessageMessage(userMessage))
      logger.debug('Added queued message to session', { sessionId, queueId: nextAsap.queueId, messageId: userMessage.id })
    }

    this.runTurn(sessionId, controller)
  }

  private async runTurn(sessionId: string, controller: AbortController): Promise<void> {
    const { sessionManager, getLLMClient, getActiveProvider, broadcastForSession } = this.deps
    const llmClient = getLLMClient()
    const provider = getActiveProvider?.()

    const statsIdentity = {
      providerId: provider?.id ?? `provider:${llmClient.getModel()}`,
      providerName: provider?.name ?? 'Unknown Provider',
      backend: provider?.backend ?? llmClient.getBackend(),
      model: llmClient.getModel(),
    }

    const { runChatTurn } = await import('../chat/orchestrator.js')

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
      logger.error('QueueProcessor turn error', { sessionId, error })
    }).finally(() => {
      this.activeAgents.delete(sessionId)

      const session = this.deps.sessionManager.getSession(sessionId)
      if (!session) return

      const hasMore = sessionManager.hasQueuedMessages(sessionId)
      if (!hasMore) {
        sessionManager.setRunning(sessionId, false)
        const contextState = sessionManager.getContextState(sessionId)
        broadcastForSession(sessionId, createContextStateMessage(contextState))
        return
      }

      this.startTurn(sessionId)
    })
  }
}