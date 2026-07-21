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
 * Hard ceiling: compaction always fires when fewer than 5K tokens remain,
 * regardless of the configured threshold. Also capped at 85% of the
 * context window for large models.
 */
export const COMPACTION_HEADROOM_TOKENS = 5_000
export const COMPACTION_MAX_RATIO = 0.85

/**
 * Check if automatic compaction should be triggered.
 * Applies a hard ceiling to guarantee headroom before the context fills up.
 */
export function shouldCompact(currentTokens: number, maxTokens: number, threshold: number): boolean {
  if (threshold <= 0) return false
  const ceilingRatio = Math.min(1, Math.max(0, (maxTokens - COMPACTION_HEADROOM_TOKENS) / maxTokens))
  const effectiveThreshold = Math.min(threshold, ceilingRatio, COMPACTION_MAX_RATIO)
  return currentTokens > maxTokens * effectiveThreshold
}
