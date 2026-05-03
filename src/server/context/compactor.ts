/**
 * Context compaction utilities.
 *
 * The actual compaction is now handled by streamLLMResponse with the COMPACTION_PROMPT
 * from chat/prompts.ts. This module provides helper functions for deciding when to compact.
 */

/**
 * Check if automatic compaction should be triggered.
 */
export function shouldCompact(currentTokens: number, maxTokens: number, threshold: number): boolean {
  return currentTokens > maxTokens * threshold
}

/**
 * Calculate the target token count for compaction.
 */
export function getCompactionTarget(maxTokens: number, targetRatio: number): number {
  return Math.floor(maxTokens * targetRatio)
}
