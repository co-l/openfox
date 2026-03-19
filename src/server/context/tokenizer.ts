// Approximate token counting for pre-flight estimation
// For English text, approximately 4 characters = 1 token
const CHARS_PER_TOKEN = 4

// Danger zone threshold: auto-compact when < 20K tokens remaining
export const DANGER_ZONE_THRESHOLD = 20000

// Minimum context usage before allowing compaction (20% of max)
export const MIN_COMPACT_THRESHOLD_RATIO = 0.20

// Target context after manual compaction (20K tokens)
export const MANUAL_COMPACT_TARGET = 20000

/**
 * Estimate tokens for a string (used for pre-flight checks only).
 * For accurate context tracking, use real promptTokens from the LLM.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * Check if context is in danger zone (< 20K tokens remaining).
 */
export function isInDangerZone(currentTokens: number, maxTokens: number): boolean {
  return (maxTokens - currentTokens) < DANGER_ZONE_THRESHOLD
}

/**
 * Check if session has enough context to warrant compaction.
 */
export function canCompact(currentTokens: number, maxTokens: number): boolean {
  return currentTokens > (maxTokens * MIN_COMPACT_THRESHOLD_RATIO)
}

/**
 * Pre-flight estimation: estimate the context size before sending to LLM.
 * Used to warn user or trigger compaction before context overflows.
 */
export interface ContextEstimate {
  estimatedTokens: number
  maxTokens: number
  percentUsed: number
  isNearLimit: boolean   // > 80%
  isOverLimit: boolean   // > 100%
}

export function estimateContextSize(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number
): ContextEstimate {
  // Estimate system prompt
  let total = estimateTokens(systemPrompt)
  
  // Estimate each message with overhead
  for (const msg of messages) {
    total += 4 // Message structure overhead
    total += estimateTokens(msg.content)
  }
  
  const percentUsed = Math.round((total / maxTokens) * 100)
  
  return {
    estimatedTokens: total,
    maxTokens,
    percentUsed,
    isNearLimit: percentUsed > 80,
    isOverLimit: percentUsed > 100,
  }
}
