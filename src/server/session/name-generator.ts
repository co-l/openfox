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
import type { StoredEvent, TurnEvent } from '../events/types.js'
import { logger } from '../utils/logger.js'
import { updateSessionMetadata } from '../db/sessions.js'
import { buildMessagesFromStoredEvents, foldPendingConfirmations } from '../events/folding.js'
import { createSessionStateMessage } from '../ws/protocol.js'

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
export async function generateSessionName(
  options: GenerateSessionNameOptions
): Promise<GenerateSessionNameResult> {
  const { userMessage, llmClient, signal } = options

  try {
    logger.debug('Generating session name', { messagePreview: userMessage.slice(0, 50) })

    // Use non-thinking variant by disabling thinking
    // This ensures only the name is returned, no reasoning
    const prompt = SESSION_NAME_PROMPT.replace('{message}', userMessage)

    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: prompt,
      },
    ]

    const timeoutSignal = AbortSignal.timeout(60000)
    const composedSignal = signal
      ? AbortSignal.any([timeoutSignal, signal])
      : timeoutSignal

    const response = await llmClient.complete({
      messages,
      tools: [],
      signal: composedSignal,
      disableThinking: true
    })

    // Clean up the response: trim whitespace and ensure it's under 50 chars
    let name = response.content.trim()
    
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
  eventStore: { getEvents: (sessionId: string) => StoredEvent[]; append: (sessionId: string, event: TurnEvent) => void }
  broadcastForSession: (sessionId: string, msg: ReturnType<typeof createSessionStateMessage>) => void
}

export function applyGeneratedSessionName(
  sessionId: string,
  name: string,
  deps: ApplyGeneratedSessionNameDeps
): void {
  updateSessionMetadata(sessionId, { title: name })
  deps.eventStore.append(sessionId, {
    type: 'session.name_generated',
    data: { name },
  })
  const updatedSession = deps.sessionManager.getSession(sessionId)
  if (updatedSession) {
    const events = deps.eventStore.getEvents(sessionId)
    const messages = buildMessagesFromStoredEvents(events)
    const pendingConfirmations = foldPendingConfirmations(events)
    deps.broadcastForSession(sessionId, createSessionStateMessage(updatedSession, messages, pendingConfirmations))
  }
}
