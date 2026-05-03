/**
 * Session Summary Generator
 *
 * Generates concise summaries of user conversations when switching to builder mode.
 * Uses the same system prompt as compaction to preserve KV-cache.
 */

import type { LLMClientWithModel } from '../llm/client.js'
import type { LLMMessage } from '../llm/types.js'
import { assembleAgentRequest } from '../chat/request-context.js'
import type { AgentDefinition } from '../agents/types.js'
import type { SkillMetadata } from '../skills/types.js'
import type { RequestContextMessage } from '../chat/request-context.js'

// ============================================================================
// Constants
// ============================================================================

const SUMMARY_INSTRUCTION =
  'Write a 2-3 sentence summary of what the user wants to accomplish. Focus on WHAT and WHY, not HOW. Output only the summary, no preamble.'

export interface GenerateSessionSummaryOptions {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  llmClient: LLMClientWithModel
  workdir: string
  customInstructions?: string | undefined
  skills?: SkillMetadata[] | undefined
}

export interface GenerateSessionSummaryResult {
  success: boolean
  summary?: string
  error?: string
}

/**
 * Generate a session summary from conversation messages.
 * Uses the same system prompt as compaction to preserve KV-cache.
 * Uses the provided LLM client (respecting user's selected model).
 * Disables thinking output for minimal latency.
 */
export async function generateSessionSummary(
  options: GenerateSessionSummaryOptions,
): Promise<GenerateSessionSummaryResult> {
  const { messages, llmClient, workdir, customInstructions, skills } = options

  try {
    const messagesText = messages.map((m) => `${m.role}: ${m.content}`).join('\n')

    const userPrompt = `${SUMMARY_INSTRUCTION}\n\n## Conversation History\n${messagesText}\n\n## Summary`

    const contextMessages: RequestContextMessage[] = [
      {
        role: 'user',
        content: userPrompt,
        source: 'history',
      },
    ]

    const mockAgentDef: AgentDefinition = {
      metadata: {
        id: 'summary',
        name: 'Summary',
        description: 'Session summary generator',
        subagent: false,
        allowedTools: [],
      },
      prompt: SUMMARY_INSTRUCTION,
    }

    const assembledRequest = assembleAgentRequest({
      agentDef: mockAgentDef,
      workdir,
      messages: contextMessages,
      injectedFiles: [],
      ...(customInstructions ? { customInstructions } : {}),
      ...(skills ? { skills } : {}),
      promptTools: [],
      toolChoice: 'none',
      disableThinking: true,
    })

    const llmMessages: LLMMessage[] = assembledRequest.messages.map((msg) => ({
      role: msg.role as 'system' | 'user' | 'assistant' | 'tool',
      content: msg.content,
    }))

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
