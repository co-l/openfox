import type { Message, Criterion } from '@openfox/shared'
import type { LLMClient, LLMMessage } from '../llm/types.js'
import { estimateTokens, estimateMessagesTokens } from './tokenizer.js'
import { logger } from '../utils/logger.js'

const COMPACTION_PROMPT = `Summarize the following conversation history concisely, preserving:
1. All file modifications made (file paths and what changed)
2. All errors encountered and how they were resolved
3. Current progress on each task
4. Any important decisions or learnings

Be thorough but concise. Output as a structured summary.

CONVERSATION:
`

export interface CompactionResult {
  summary: string
  removedMessageIds: string[]
  tokensBefore: number
  tokensAfter: number
}

export async function compactMessages(
  messages: Message[],
  criteria: Criterion[],
  targetTokens: number,
  llmClient: LLMClient
): Promise<CompactionResult | null> {
  const currentTokens = estimateMessagesTokens(messages)
  
  if (currentTokens <= targetTokens) {
    return null // No compaction needed
  }
  
  logger.info('Compacting context', { currentTokens, targetTokens })
  
  // Keep the last N messages intact (recent context is most valuable)
  const keepCount = Math.min(10, Math.floor(messages.length / 2))
  const recentMessages = messages.slice(-keepCount)
  const oldMessages = messages.slice(0, -keepCount)
  
  if (oldMessages.length === 0) {
    logger.warn('Cannot compact: all messages are recent')
    return null
  }
  
  // Format old messages for summarization
  const formattedHistory = oldMessages
    .map(m => `[${m.role}]: ${m.content.slice(0, 1000)}${m.content.length > 1000 ? '...' : ''}`)
    .join('\n\n')
  
  // Also include criteria status
  const criteriaStatus = criteria
    .map(c => `- ${c.description}: ${c.status.type}`)
    .join('\n')
  
  const prompt = COMPACTION_PROMPT + formattedHistory + '\n\nCURRENT CRITERIA STATUS:\n' + criteriaStatus
  
  // Generate summary
  const response = await llmClient.complete({
    messages: [
      { role: 'user', content: prompt }
    ],
    maxTokens: 2000,
    temperature: 0.3,
  })
  
  const summary = response.content
  const summaryTokens = estimateTokens(summary)
  const recentTokens = estimateMessagesTokens(recentMessages)
  
  logger.info('Compaction complete', {
    removedMessages: oldMessages.length,
    summaryTokens,
    recentTokens,
  })
  
  return {
    summary,
    removedMessageIds: oldMessages.map(m => m.id),
    tokensBefore: currentTokens,
    tokensAfter: summaryTokens + recentTokens,
  }
}

export function shouldCompact(
  currentTokens: number,
  maxTokens: number,
  threshold: number
): boolean {
  return currentTokens > maxTokens * threshold
}

export function getCompactionTarget(
  maxTokens: number,
  targetRatio: number
): number {
  return Math.floor(maxTokens * targetRatio)
}
