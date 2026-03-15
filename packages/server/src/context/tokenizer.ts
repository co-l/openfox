import type { Message } from '@openfox/shared'

// Approximate token counting (tiktoken would be more accurate but adds complexity)
// For English text, approximately 4 characters = 1 token
const CHARS_PER_TOKEN = 4

// Danger zone threshold: auto-compact when < 20K tokens remaining
export const DANGER_ZONE_THRESHOLD = 20000

// Minimum context usage before allowing compaction (20% of max)
export const MIN_COMPACT_THRESHOLD_RATIO = 0.20

// Target context after manual compaction (20K tokens)
export const MANUAL_COMPACT_TARGET = 20000

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export function estimateMessagesTokens(messages: { content: string }[]): number {
  let total = 0
  
  for (const msg of messages) {
    // Add message overhead (~4 tokens per message)
    total += 4
    total += estimateTokens(msg.content)
  }
  
  return total
}

/**
 * Estimate context tokens from messages (fallback when real count unavailable).
 * Includes: message content, thinking, tool calls/results.
 */
export function calculateContextTokens(messages: Message[]): number {
  let total = 0
  
  for (const msg of messages) {
    // Message overhead
    total += 4
    
    // Main content
    total += estimateTokens(msg.content)
    
    // Thinking content
    if (msg.thinkingContent) {
      total += estimateTokens(msg.thinkingContent)
    }
    
    // Tool calls (function name + arguments)
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        total += 10 // Function name + structure overhead
        total += estimateTokens(JSON.stringify(tc.arguments))
      }
    }
    
    // Tool result
    if (msg.toolResult?.output) {
      total += estimateTokens(msg.toolResult.output)
    }
  }
  
  return total
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
