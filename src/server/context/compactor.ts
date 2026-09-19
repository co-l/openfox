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
 *
 * `subAgent` must be passed when compacting a sub-agent's own context —
 * without it the prompt is tagged as a top-level message, so the sub-agent's
 * own conversation (built by subAgentId) never sees it and keeps ending in
 * back-to-back assistant turns, which backends reject outright.
 */
export function appendCompactionPrompt(
  sessionId: string,
  append: (event: import('../events/types.js').TurnEvent) => void,
  subAgent?: { subAgentId: string; subAgentType: string },
): void {
  const compactPromptMsgId = crypto.randomUUID()
  append(
    createMessageStartEvent(compactPromptMsgId, 'user', COMPACTION_PROMPT, {
      ...(getCurrentWindowMessageOptions(sessionId) ?? {}),
      ...(subAgent ? { subAgentId: subAgent.subAgentId, subAgentType: subAgent.subAgentType } : {}),
      isSystemGenerated: true,
      messageKind: 'auto-prompt',
      metadata: { type: 'compaction', name: 'Compaction', color: '#64748b' },
    }),
  )
  append({ type: 'message.done', data: { messageId: compactPromptMsgId } })
}

/**
 * Hard ceiling: compaction always fires with at least this many tokens of
 * headroom remaining, regardless of the configured threshold. Also capped at
 * 95% of the context window for large models, matching the config schema and UI.
 *
 * The compaction turn itself has to fit in that headroom (prompt_tokens +
 * completion_tokens <= context window is a hard backend limit) — it needs
 * room to both reason about the history and write the actual summary. At the
 * old 5K, a compaction that fired close to the ceiling left the summarization
 * call almost no output budget, so it silently truncated (or, worse, emitted
 * only its raw chain-of-thought — see the content/thinkingContent fallback in
 * agent-loop.ts) instead of producing a usable summary. That fed a loop: a
 * garbled summary loses track of what was already done, so the next context
 * window re-explores from scratch, fills up again, and repeats.
 */
export const COMPACTION_HEADROOM_TOKENS = 15_000
export const COMPACTION_MAX_RATIO = 0.95

/**
 * Check if automatic compaction should be triggered.
 * Applies a hard ceiling to guarantee headroom before the context fills up.
 *
 * The headroom is capped at 30% of the window so it scales down for small
 * context windows instead of eating most (or all) of a tiny model's budget —
 * COMPACTION_HEADROOM_TOKENS is sized for the common case of large windows.
 */
export function shouldCompact(currentTokens: number, maxTokens: number, threshold: number): boolean {
  if (threshold <= 0) return false
  const headroomTokens = Math.min(COMPACTION_HEADROOM_TOKENS, maxTokens * 0.3)
  const ceilingRatio = Math.min(1, Math.max(0, (maxTokens - headroomTokens) / maxTokens))
  const effectiveThreshold = Math.min(threshold, ceilingRatio, COMPACTION_MAX_RATIO)
  return currentTokens > maxTokens * effectiveThreshold
}
