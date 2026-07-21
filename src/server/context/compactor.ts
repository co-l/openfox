/**
 * Context compaction utilities.
 *
 * Compaction runs inside the agent loop for both auto and manual compaction.
 * Manual compaction appends the compaction prompt and starts the agent loop
 * with initialCompacting=true. Both paths use the COMPACTION_PROMPT from chat/prompts.ts.
 * This module provides helper functions for deciding when to compact.
 */

import { COMPACTION_PROMPT } from '../chat/prompts.js'
import { createMessageStartEvent } from '../chat/stream-pure.js'
import { getCurrentWindowMessageOptions } from '../events/index.js'

/**
 * Append the compaction prompt to the event store.
 * Used by both auto-compaction (threshold-gated, in agent-loop.ts) and
 * manual compaction (always appended, in ws/server.ts).
 */
export function appendCompactionPrompt(
  sessionId: string,
  append: (event: import('../events/types.js').TurnEvent) => void,
): void {
  const compactPromptMsgId = crypto.randomUUID()
  append(
    createMessageStartEvent(compactPromptMsgId, 'user', COMPACTION_PROMPT, {
      ...(getCurrentWindowMessageOptions(sessionId) ?? {}),
      isSystemGenerated: true,
      messageKind: 'auto-prompt',
      metadata: { type: 'compaction', name: 'Compaction', color: '#64748b' },
    }),
  )
  append({ type: 'message.done', data: { messageId: compactPromptMsgId } })
}

/**
 * Check if automatic compaction should be triggered.
 */
export function shouldCompact(currentTokens: number, maxTokens: number, threshold: number): boolean {
  return currentTokens > maxTokens * threshold
}
