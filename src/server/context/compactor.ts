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

import type { CompactionFloorSegment } from '../../shared/types.js'
import type { LLMToolDefinition } from '../llm/types.js'
import type { TopLevelPromptParts } from '../chat/prompts.js'

/**
 * Check if automatic compaction should be triggered.
 */
export function estimateTextTokens(value: string): number {
  return value ? Math.ceil(value.length / 4) : 0
}

export function estimateCompactionFloor(input: {
  promptParts: TopLevelPromptParts
  tools: LLMToolDefinition[]
  mcpToolNames?: Set<string>
}): { totalTokens: number; segments: CompactionFloorSegment[] } {
  const mcpToolNames = input.mcpToolNames ?? new Set<string>()
  const mcpTools = input.tools.filter((tool) => mcpToolNames.has(tool.function.name))
  const builtInTools = input.tools.filter((tool) => !mcpToolNames.has(tool.function.name))

  const segments = [
    { key: 'system', label: 'System prompt', tokens: estimateTextTokens(input.promptParts.system) },
    { key: 'instructions', label: 'Instructions', tokens: estimateTextTokens(input.promptParts.instructions) },
    { key: 'skills', label: 'Skills', tokens: estimateTextTokens(input.promptParts.skills) },
    { key: 'subagents', label: 'Subagent definitions', tokens: estimateTextTokens(input.promptParts.subagents) },
    { key: 'tools', label: 'Built-in tools', tokens: estimateTextTokens(JSON.stringify(builtInTools)) },
    { key: 'mcp', label: 'MCP tools', tokens: estimateTextTokens(JSON.stringify(mcpTools)) },
  ].filter((segment): segment is CompactionFloorSegment => segment.tokens > 0)

  return {
    totalTokens: segments.reduce((total, segment) => total + segment.tokens, 0),
    segments,
  }
}

export function estimateMinimumCompactionTokens(systemPrompt: string, tools: unknown[]): number {
  const serializedTools = tools.length > 0 ? JSON.stringify(tools) : ''
  return estimateTextTokens(systemPrompt) + estimateTextTokens(serializedTools)
}

export function getMinimumCompactionThreshold(maxTokens: number, minimumTokens: number): number {
  if (maxTokens <= 0 || minimumTokens <= 0) return 0
  return Math.min(1, minimumTokens / maxTokens)
}

export function getEffectiveCompactionThreshold(
  configuredThreshold: number,
  maxTokens: number,
  minimumTokens: number,
): number {
  if (configuredThreshold === 0) return 0
  return Math.max(configuredThreshold, getMinimumCompactionThreshold(maxTokens, minimumTokens))
}

export function shouldCompact(currentTokens: number, maxTokens: number, threshold: number, minimumTokens = 0): boolean {
  const effectiveThreshold = getEffectiveCompactionThreshold(threshold, maxTokens, minimumTokens)
  return effectiveThreshold > 0 && currentTokens > maxTokens * effectiveThreshold
}
