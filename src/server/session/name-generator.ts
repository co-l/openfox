/**
 * Session Name Generator
 *
 * Generates concise, descriptive session names from the first user message.
 * Uses an ultra-lightweight prompt with NO project context or extra metadata.
 * Non-thinking variant to minimize cost and latency.
 */

import type { LLMClientWithModel } from '../llm/client.js'
import type { LLMMessage } from '../llm/types.js'
import type { Session } from '../../shared/types.js'
import type { StoredEvent, TurnEvent, SessionSnapshot } from '../events/types.js'
import type { ProviderManager } from '../provider-manager.js'
import type { ServerMessage } from '../../shared/protocol.js'
import { logger } from '../utils/logger.js'
import { updateSessionMetadata } from '../db/sessions.js'
import { buildMessagesFromStoredEvents, foldPendingConfirmations } from '../events/folding.js'
import { createSessionStateMessage } from '../ws/protocol.js'
import { getPendingQuestionsForSession } from '../tools/index.js'
import { getSessionMessageCount } from '../utils/session-utils.js'
import { getRuntimeConfig } from '../runtime-config.js'
import { combineEventsWithSnapshot } from '../events/index.js'
import { getMaxVisibleItems } from '../db/settings.js'

// ============================================================================
// Ultra-Lightweight Prompt
// ============================================================================

/**
 * The prompt is intentionally minimal:
 * - Only instructions for name generation
 * - Max 50 characters
 * - Descriptive and concise
 * - NO project context
 * - NO system instructions
 * - NO extra metadata
 */
export const SESSION_NAME_PROMPT = `Generate a concise, descriptive session name (max 50 characters) based on the user's message.
Return ONLY the name, nothing else.

Example inputs and outputs:
- "How do I set up React?" → "React setup"
- "Fix the authentication bug" → "Fix authentication bug"
- "Add unit tests for the API" → "Add API unit tests"

User message: {message}`

// ============================================================================
// Name Generation
// ============================================================================

export interface GenerateSessionNameOptions {
  userMessage: string
  llmClient: LLMClientWithModel
  signal?: AbortSignal
  modelSettings?: {
    temperature?: number
    topP?: number
    topK?: number
    maxTokens?: number
    supportsVision?: boolean
    chatTemplateKwargs?: Record<string, unknown>
    queryParams?: Record<string, unknown>
  }
}

export interface GenerateSessionNameResult {
  success: boolean
  name?: string
  error?: string
}

/**
 * Generate a session name from the user's first message.
 * Uses the provided LLM client (respecting user's selected model).
 * Disables thinking output for minimal latency.
 */
export async function generateSessionName(options: GenerateSessionNameOptions): Promise<GenerateSessionNameResult> {
  const { userMessage, llmClient, signal, modelSettings } = options

  try {
    logger.debug('Generating session name', { messagePreview: userMessage.slice(0, 50) })

    const prompt = SESSION_NAME_PROMPT.replace('{message}', userMessage)

    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: prompt,
      },
    ]

    const timeoutSignal = AbortSignal.timeout(120_000)
    const composedSignal = signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal

    const response = await llmClient.complete({
      messages,
      tools: [],
      signal: composedSignal,
      // Non-thinking mode is achieved via modelSettings (chatTemplateKwargs or queryParams),
      // not by sending an invalid reasoning_effort value.
      ...(modelSettings ? { modelSettings } : {}),
    })

    // Use content or fall back to thinkingContent for models that put
    // output in the reasoning field regardless of thinking mode
    let name = (response.content || response.thinkingContent || '').trim()

    // Truncate to 50 characters if needed
    if (name.length > 50) {
      name = name.substring(0, 47) + '...'
    }

    // Basic validation: ensure it's not empty
    if (!name || name.length < 3) {
      return {
        success: false,
        error: 'Generated name is too short or empty',
      }
    }

    logger.debug('Session name generated successfully', { name })
    return {
      success: true,
      name,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error generating session name'
    logger.debug('Session name generation error', { error: errorMessage })
    return {
      success: false,
      error: errorMessage,
    }
  }
}

/**
 * Check if a session needs name generation.
 * A session needs a name if:
 * - It has no title in the DB, OR
 * - It has a default title like "Session N"
 * AND it's the first user message
 */
export function needsNameGeneration(sessionTitle: string | null | undefined, messageCount: number): boolean {
  // Only generate on the first user message
  if (messageCount > 1) {
    return false
  }

  // If session has no title yet
  if (!sessionTitle || sessionTitle.trim() === '') {
    return true
  }

  // If title matches default pattern "Session N"
  if (/^Session \d+$/.test(sessionTitle)) {
    return true
  }

  return false
}

export function needsNameGenerationCheck(
  sessionId: string,
  sessionTitle: string | null | undefined,
  messageCount: number,
): boolean {
  const needsGeneration = needsNameGeneration(sessionTitle, messageCount)
  logger.debug('Session name generation check', {
    sessionId,
    title: sessionTitle,
    messageCount,
    needsGeneration,
  })
  return needsGeneration
}

export interface ApplyGeneratedSessionNameDeps {
  sessionManager: { getSession: (id: string) => Session | null }
  eventStore: {
    getEventsSinceSnapshot: (sessionId: string) => { snapshot: SessionSnapshot | undefined; events: StoredEvent[] }
    append: (sessionId: string, event: TurnEvent) => void
  }
  broadcastForSession: (sessionId: string, msg: ReturnType<typeof createSessionStateMessage>) => void
}

export function applyGeneratedSessionName(sessionId: string, name: string, deps: ApplyGeneratedSessionNameDeps): void {
  updateSessionMetadata(sessionId, { title: name })
  deps.eventStore.append(sessionId, {
    type: 'session.name_generated',
    data: { name },
  })
  const updatedSession = deps.sessionManager.getSession(sessionId)
  if (updatedSession) {
    const { snapshot, events: eventsSinceSnapshot } = deps.eventStore.getEventsSinceSnapshot(sessionId)
    const events = combineEventsWithSnapshot(sessionId, snapshot, eventsSinceSnapshot)
    const maxVisibleItems = getMaxVisibleItems()
    const { messages, hiddenCount } = buildMessagesFromStoredEvents(events, maxVisibleItems || undefined)
    const pendingConfirmations = foldPendingConfirmations(events)
    const pendingQuestions = getPendingQuestionsForSession(sessionId)

    deps.broadcastForSession(
      sessionId,
      createSessionStateMessage(
        updatedSession,
        messages,
        pendingConfirmations,
        pendingQuestions,
        undefined,
        undefined,
        hiddenCount,
      ),
    )
  }
}

// ============================================================================
// Shared Helper: Generate name for a session using its configured model
// ============================================================================

export interface GenerateSessionNameForSessionDeps {
  sessionManager: { getSession: (id: string) => Session | null }
  providerManager: ProviderManager
  broadcastForSession: (sessionId: string, msg: ServerMessage) => void
  eventStore: {
    getEventsSinceSnapshot: (sessionId: string) => { snapshot: SessionSnapshot | undefined; events: StoredEvent[] }
    append: (sessionId: string, event: TurnEvent) => void
  }
  /** Optional factory to get an LLM client. When provided (e.g. from QueueProcessor),
   *  it's used instead of creating a new client via dynamic import. This ensures the
   *  mock LLM client is used in e2e tests (OPENFOX_MOCK_LLM=true). */
  getLLMClient?: () => LLMClientWithModel
  getLLMClientForProvider?: (providerId: string, model: string) => LLMClientWithModel | undefined
}

/**
 * Resolve the provider config for a session: finds the provider by session.providerId
 * (falling back to the active provider), and returns its URL, apiKey, and the effective model.
 */
function resolveSessionProvider(
  session: Session,
  providerManager: ProviderManager,
): { providerId: string; baseUrl: string; apiKey?: string; model: string } | undefined {
  const providers = providerManager.getProviders()
  const effectiveModel = session.providerModel ?? providerManager.getCurrentModel()
  if (!effectiveModel) return undefined

  // Try session's provider first, then active provider
  const provider = session.providerId
    ? providers.find((p) => p.id === session.providerId)
    : providers.find((p) => p.isActive)

  if (!provider) return undefined

  return {
    providerId: provider.id,
    baseUrl: provider.url,
    ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
    model: effectiveModel,
  }
}

/**
 * Generate a session name using the session's configured model (if any),
 * with non-thinking mode settings. Uses the same LLM client pipeline as
 * the agent loop — green in the provider modal = works here.
 */
export async function generateSessionNameForSession(
  sessionId: string,
  userMessage: string,
  deps: GenerateSessionNameForSessionDeps,
  signal?: AbortSignal,
): Promise<void> {
  const { sessionManager, providerManager, broadcastForSession, eventStore } = deps

  const session = sessionManager.getSession(sessionId)
  if (!session) return

  if (getRuntimeConfig().disableAutoSessionTitle) {
    logger.debug('Session name generation disabled by config', { sessionId })
    return
  }

  const messageCount = getSessionMessageCount(sessionId)
  if (!needsNameGenerationCheck(sessionId, session.metadata.title, messageCount)) return

  const providerConfig = resolveSessionProvider(session, providerManager)

  // Get non-thinking model settings for the session's model on its provider
  const modelSettings = providerConfig
    ? providerManager.getModelSettings(providerConfig.providerId, providerConfig.model, 'non-thinking')
    : undefined

  const prompt = SESSION_NAME_PROMPT.replace('{message}', userMessage)

  try {
    // Resolve the LLM client to use:
    //   1. Use a provider-scoped factory when available.
    //   2. Fall back to the injected client used by tests and legacy callers.
    //   3. Otherwise create a dedicated HTTP client from the provider config.
    let client: LLMClientWithModel
    if (providerConfig && deps.getLLMClientForProvider) {
      const providerClient = deps.getLLMClientForProvider(providerConfig.providerId, providerConfig.model)
      if (!providerClient) return
      client = providerClient
    } else if (deps.getLLMClient && providerConfig) {
      client = deps.getLLMClient()
      client.setModel(providerConfig.model)
    } else if (providerConfig) {
      const { createLLMClient } = await import('../llm/client.js')
      client = createLLMClient({
        llm: {
          baseUrl: providerConfig.baseUrl,
          model: providerConfig.model,
          ...(providerConfig.apiKey ? { apiKey: providerConfig.apiKey } : {}),
        },
      } as never)
    } else if (deps.getLLMClient) {
      // No session-specific provider — use the global/mock client
      client = deps.getLLMClient()
    } else {
      logger.debug('Session name generation skipped: no LLM client available', { sessionId })
      return
    }

    const timeoutSignal = AbortSignal.timeout(120_000)
    const composedSignal = signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal

    const response = await client.complete({
      messages: [{ role: 'user', content: prompt }],
      tools: [],
      ...(modelSettings ? { modelSettings } : {}),
      signal: composedSignal,
      skipClientReasoningEffort: true,
    })

    let name = (response.content || response.thinkingContent || '').trim()
    if (name.length > 50) {
      name = name.substring(0, 47) + '...'
    }
    if (name.length >= 3) {
      applyGeneratedSessionName(sessionId, name, {
        sessionManager,
        eventStore,
        broadcastForSession,
      })
    } else {
      logger.debug('Session name too short', { sessionId, name })
    }
  } catch (error) {
    logger.error('Session name generation error', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
