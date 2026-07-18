/**
 * Sub-Agent Manager
 *
 * Thin wrapper around runTopLevelAgentLoop. Sub-agents get compaction,
 * truncation retry, pattern retry — everything — for free.
 *
 * Sets up sub-agent scope isolation, return_value detection, and a
 * single nudge if the sub-agent forgets to call return_value.
 */

import type { StatsIdentity } from '../../shared/types.js'
import type { SessionManager } from '../session/index.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { ToolRegistry } from '../tools/types.js'
import type { ServerMessage } from '../../shared/protocol.js'
import type { AgentDefinition } from '../agents/types.js'
import { readFile, access } from 'node:fs/promises'
import { join, dirname, isAbsolute } from 'node:path'
import { loadAllAgentsDefault, findAgentById } from '../agents/registry.js'
import { buildBasePrompt } from '../chat/prompts.js'
import { TurnMetrics, createMessageStartEvent } from '../chat/stream-pure.js'
import { runTopLevelAgentLoop } from '../chat/agent-loop.js'
import { createAssemblyResult } from '../chat/request-context.js'
import { getAllInstructions } from '../context/instructions.js'
import { getEnabledSkillMetadata } from '../skills/registry.js'
import { getRuntimeConfig } from '../runtime-config.js'
import { getGlobalConfigDir } from '../../cli/paths.js'
import { getEventStore, getCurrentContextWindowId } from '../events/index.js'
import { createChatMessageMessage } from '../ws/protocol.js'
import { logger } from '../utils/logger.js'
import { getConversationMessages, processEventsForConversation } from '../chat/conversation-history.js'

const RETURN_VALUE_INSTRUCTION = `

## RETURN VALUE
As the very last thing you do, call \`return_value\` ONCE with a structured summary of your work. This is how your findings get passed back to the calling agent. Do not finish without calling return_value.

CRITICAL: Do NOT output your summary as text in the chat. Your summary must ONLY be provided via the \`return_value\` tool call. If you write the summary as text AND call return_value, you produce duplicate output — wasteful and incorrect.`

// ============================================================================
// Types
// ============================================================================

export interface SubAgentExecutionOptions {
  subAgentType: string
  prompt: string
  sessionManager: SessionManager
  sessionId: string
  llmClient: LLMClientWithModel
  toolRegistry: ToolRegistry
  turnMetrics: TurnMetrics
  statsIdentity: StatsIdentity
  signal?: AbortSignal
  onMessage?: (msg: ServerMessage) => void
}

export interface SubAgentResult {
  content: string
  result?: string
}

export function buildSubAgentResult(
  returnValueContent: string | undefined | null,
  returnValueResult: string | undefined | null,
): SubAgentResult {
  return {
    content: returnValueContent ?? '',
    ...(returnValueResult !== null && returnValueResult !== undefined ? { result: returnValueResult } : {}),
  }
}

// ============================================================================
// Agent Definition Resolution
// ============================================================================

async function resolveAgentDef(agentId: string): Promise<AgentDefinition> {
  const allAgents = await loadAllAgentsDefault()
  const def = findAgentById(agentId, allAgents)
  if (!def) throw new Error(`Unknown sub-agent type: ${agentId}`)
  if (!def.metadata.subagent) throw new Error(`Agent '${agentId}' is not a sub-agent`)
  return def
}

function getWindowOptions(sessionId: string): { contextWindowId: string } | undefined {
  const id = getCurrentContextWindowId(sessionId)
  return id ? { contextWindowId: id } : undefined
}

// ============================================================================
// GitIgnore Loading
// ============================================================================

/**
 * Walk up from workdir to find the nearest .gitignore and return its content
 * formatted as exclusion rules for the system prompt.
 *
 * Caps content at 4 KB / 100 lines to prevent prompt bloat.
 */
export async function loadGitIgnoreRules(workdir: string): Promise<string> {
  if (!isAbsolute(workdir)) return ''

  let currentDir = workdir
  while (true) {
    const gitignorePath = join(currentDir, '.gitignore')
    try {
      await access(gitignorePath)
      const content = await readFile(gitignorePath, 'utf-8')
      const trimmed = content.trim()
      if (!trimmed) return ''

      // Cap at 100 lines or 4 KB to avoid prompt bloat
      const lines = trimmed.split('\n')
      const capped = lines.slice(0, 100)
      if (capped.length < lines.length) capped.push('# ... truncated (too many patterns)')
      const final = capped.join('\n').slice(0, 4096)

      return `## Repository Exclusion Rules (.gitignore)\n\nThe following patterns from \`.gitignore\` should be excluded from file searches:\n\n${final}`
    } catch {
      // No .gitignore in this directory, continue walking up
    }

    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) break
    currentDir = parentDir
  }

  return ''
}

// ============================================================================
// Execution
// ============================================================================

export async function executeSubAgent(options: SubAgentExecutionOptions): Promise<SubAgentResult> {
  const {
    subAgentType,
    prompt,
    sessionManager,
    sessionId,
    llmClient,
    toolRegistry,
    turnMetrics,
    statsIdentity,
    signal,
    onMessage,
  } = options

  const agentDef = await resolveAgentDef(subAgentType)
  const eventStore = getEventStore()
  const subAgentId = crypto.randomUUID()
  const session = sessionManager.requireSession(sessionId)
  const windowOptions = getWindowOptions(sessionId)

  logger.debug('Sub-agent starting', { subAgentType, subAgentId, sessionId })

  // --- Setup: context reset + prompt messages ---

  const resetMsgId = crypto.randomUUID()
  eventStore.append(
    sessionId,
    createMessageStartEvent(resetMsgId, 'user', `Fresh Context - ${agentDef.metadata.name} Sub-Agent`, {
      ...(windowOptions ?? {}),
      isSystemGenerated: true,
      messageKind: 'context-reset',
      subAgentId,
      subAgentType,
    }),
  )
  eventStore.append(sessionId, { type: 'message.done', data: { messageId: resetMsgId } })

  const promptMsgId = crypto.randomUUID()
  eventStore.append(
    sessionId,
    createMessageStartEvent(promptMsgId, 'user', prompt, {
      ...(windowOptions ?? {}),
      isSystemGenerated: true,
      messageKind: 'auto-prompt',
      subAgentId,
      subAgentType,
      metadata: {
        type: 'subagent',
        name: agentDef.metadata.name,
        color: agentDef.metadata.color ?? '#6b7280',
      },
    }),
  )
  eventStore.append(sessionId, { type: 'message.done', data: { messageId: promptMsgId } })
  if (onMessage) {
    onMessage(
      createChatMessageMessage({
        id: promptMsgId,
        role: 'user',
        content: prompt,
        timestamp: new Date().toISOString(),
        isSystemGenerated: true,
        messageKind: 'auto-prompt',
        subAgentId,
        subAgentType,
        metadata: {
          type: 'subagent',
          name: agentDef.metadata.name,
          color: agentDef.metadata.color ?? '#6b7280',
        },
      }),
    )
  }

  // --- Load context for system prompt ---

  const effectiveWorkdir = session.workspace ?? session.workdir

  const { content: instructionContent } = await getAllInstructions(effectiveWorkdir, session.projectId)
  const config = getRuntimeConfig()
  const configDir = getGlobalConfigDir(config.mode ?? 'production')
  const skills = await getEnabledSkillMetadata(configDir, config.workdir)

  const hasRunCommand = agentDef.metadata.allowedTools?.includes('run_command') ?? false
  const gitignoreSection = hasRunCommand ? await loadGitIgnoreRules(effectiveWorkdir) : ''

  const systemPrompt =
    buildBasePrompt(effectiveWorkdir, undefined, skills.length > 0 ? skills : undefined, llmClient.getModel()) +
    '\n\n' +
    agentDef.prompt +
    (gitignoreSection ? '\n\n' + gitignoreSection : '') +
    RETURN_VALUE_INSTRUCTION

  // --- Delegate to the shared agent loop ---

  const subAgentScope = { type: 'subagent' as const, sessionId, subAgentId, subAgentType }

  const loopResult = await runTopLevelAgentLoop(
    {
      mode: subAgentType,
      append: (event) => eventStore.append(sessionId, event),
      sessionManager,
      sessionId,
      llmClient,
      statsIdentity,
      signal,
      onMessage,
      assembleRequest: async (input) =>
        createAssemblyResult({
          systemPrompt,
          messages: input.messages,
          injectedFiles: input.injectedFiles,
          requestTools: input.promptTools,
          toolChoice: input.toolChoice,

          ...(instructionContent ? { customInstructions: instructionContent } : {}),
          ...(skills.length > 0 ? { skills } : {}),
        }),
      getToolRegistry: () => toolRegistry,
      getConversationMessages: async () => {
        const processedEvents = await processEventsForConversation(sessionId, llmClient, (event) =>
          eventStore.append(sessionId, event),
        )
        return getConversationMessages(subAgentScope, { events: processedEvents })
      },
      subAgentMetadata: { subAgentId, subAgentType },
      breakOnReturnValue: true,
      requireReturnValue: true,
    },
    turnMetrics,
  )

  // --- Build result ---

  logger.debug('Sub-agent execution complete', { subAgentType, subAgentId })

  return buildSubAgentResult(
    loopResult.returnValueContent,
    loopResult.returnValueResult ?? (subAgentType !== 'verifier' ? 'success' : undefined),
  )
}

// Backward-compatible factory (used by sub-agent.ts)
export function createSubAgentManager() {
  return { executeSubAgent }
}
