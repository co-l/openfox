/**
 * Session Summary Generator
 *
 * Generates concise summaries of user conversations when switching to builder mode.
 * Uses a non-thinking variant for minimal latency.
 */

import type { LLMClientWithModel } from '../llm/client.js'
import type { LLMMessage } from '../llm/types.js'

// ============================================================================
// Summary Prompt
// ============================================================================

/**
 * Prompt for generating session summaries.
 * Focuses on WHAT and WHY, not HOW.
 * Returns only the summary, no preamble.
 */
export const SESSION_SUMMARY_PROMPT = `Write a 2-3 sentence summary of what the user wants to accomplish. Focus on WHAT and WHY, not HOW. Output only the summary, no preamble.

## Conversation History
{messages}

## Summary
`

// ============================================================================
// Summary Generation
// ============================================================================

export interface GenerateSessionSummaryOptions {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  llmClient: LLMClientWithModel
}

export interface GenerateSessionSummaryResult {
  success: boolean
  summary?: string
  error?: string
}

/**
 * Generate a session summary from conversation messages.
 * Uses the provided LLM client (respecting user's selected model).
 * Disables thinking output for minimal latency.
 */
export async function generateSessionSummary(
  options: GenerateSessionSummaryOptions
): Promise<GenerateSessionSummaryResult> {
  const { messages, llmClient } = options
  
  try {
    // Format messages for the prompt
    const messagesText = messages
      .map(m => `${m.role}: ${m.content}`)
      .join('\n')
    
    const prompt = SESSION_SUMMARY_PROMPT.replace('{messages}', messagesText)
    
    const llmMessages: LLMMessage[] = [
      {
        role: 'user',
        content: prompt,
      },
    ]


    console.log("COUCOU", prompt)

    const response = await llmClient.complete({
      messages: llmMessages,
      tools: [],
      signal: AbortSignal.timeout(60000),
      disableThinking: true,
    })

    // Clean up the response: trim whitespace
    let summary = response.content.trim()
    
    // Truncate to 500 characters if needed
    if (summary.length > 500) {
      summary = summary.substring(0, 497) + '...'
    }

    // Basic validation: ensure it's not too short
    if (!summary || summary.length < 10) {
      return {
        success: false,
        error: 'Generated summary is too short or empty',
      }
    }

    return {
      success: true,
      summary,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error generating summary',
    }
  }
}

/**
 * Check if a session needs summary generation.
 * A session needs a summary if:
 * - It has no summary in the DB (summary is null)
 */
export function needsSummaryGeneration(sessionSummary: string | null): boolean {
  return sessionSummary === null || sessionSummary.trim() === ''
}
