import type { Attachment, InjectedFile, Provider, StatsIdentity } from '../../shared/types.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { SessionManager } from '../session/index.js'
import { getEventStore, getContextMessages, getCurrentContextWindowId } from '../events/index.js'
import { getAllInstructions } from './instructions.js'
import { shouldCompact } from './compactor.js'
import { COMPACTION_PROMPT } from '../chat/prompts.js'
import { assembleAgentRequest, type RequestContextMessage } from '../chat/request-context.js'
import {
  TurnMetrics,
  createMessageStartEvent,
  createChatDoneEvent,
} from '../chat/stream-pure.js'
import { consumeStreamWithToolLoop } from '../chat/stream-pure.js'
import { loadAllAgentsDefault, findAgentById, getSubAgents } from '../agents/registry.js'
import { getToolRegistryForAgent } from '../tools/index.js'
import { getEnabledSkillMetadata } from '../skills/registry.js'
import { getGlobalConfigDir } from '../../cli/paths.js'
import { getRuntimeConfig } from '../runtime-config.js'
import { logger } from '../utils/logger.js'

function getCurrentWindowMessageOptions(sessionId: string): { contextWindowId: string } | undefined {
  const contextWindowId = getCurrentContextWindowId(sessionId)
  return contextWindowId ? { contextWindowId } : undefined
}

function toRequestContextMessages(messages: Array<{
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
  toolCallId?: string
  attachments?: Attachment[]
}>): RequestContextMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    source: 'history',
    ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.attachments ? { attachments: message.attachments } : {}),
  }))
}

interface ContextCompactionOptions {
  sessionManager: SessionManager
  sessionId: string
  llmClient: LLMClientWithModel
  statsIdentity: StatsIdentity
  signal?: AbortSignal
}

export async function maybeAutoCompactContext(options: ContextCompactionOptions): Promise<boolean> {
  const config = getRuntimeConfig()
  const contextState = options.sessionManager.getContextState(options.sessionId)
  if (!shouldCompact(contextState.currentTokens, contextState.maxTokens, config.context.compactionThreshold)) {
    return false
  }

  try {
    await performContextCompaction({
      ...options,
      tokenCountAtClose: contextState.currentTokens,
      trigger: 'auto',
    })
    return true
  } catch (error) {
    // Abort errors should still propagate (user cancelled)
    if (error instanceof Error && error.message === 'Aborted') {
      throw error
    }

    logger.error('Auto-compaction failed, continuing without compaction', {
      sessionId: options.sessionId,
      error: error instanceof Error ? error.message : String(error),
      currentTokens: contextState.currentTokens,
      maxTokens: contextState.maxTokens,
    })

    // Emit a visible warning so the user knows compaction failed
    const eventStore = getEventStore()
    eventStore.append(options.sessionId, {
      type: 'chat.error',
      data: {
        error: `Auto-compaction failed: ${error instanceof Error ? error.message : 'Unknown error'}. Continuing with full context.`,
        recoverable: true,
      },
    })

    return false
  }
}

export async function performManualContextCompaction(options: ContextCompactionOptions & {
  tokenCountAtClose: number
}): Promise<void> {
  await performContextCompaction({
    ...options,
    trigger: 'manual',
  })
}

async function performContextCompaction(options: ContextCompactionOptions & {
  tokenCountAtClose: number
  trigger: 'auto' | 'manual'
}): Promise<void> {
  const { sessionManager, sessionId, llmClient, statsIdentity, signal, tokenCountAtClose, trigger } = options
  const eventStore = getEventStore()
  const session = sessionManager.requireSession(sessionId)
  const { content: instructions, files } = await getAllInstructions(session.workdir, session.projectId)
  const injectedFiles: InjectedFile[] = files.map((file) => ({
    path: file.path,
    content: file.content ?? '',
    source: file.source,
  }))
  const requestMessages = toRequestContextMessages(getContextMessages(sessionId))

  const config = getRuntimeConfig()
  const allAgents = await loadAllAgentsDefault()
  const plannerDef = findAgentById('planner', allAgents)!
  const subAgentDefs = getSubAgents(allAgents)
  const toolRegistry = getToolRegistryForAgent(plannerDef)
  const configDir = getGlobalConfigDir(config.mode ?? 'production')
  const skills = await getEnabledSkillMetadata(configDir)

  const assembledRequest = assembleAgentRequest({
    agentDef: plannerDef,
    subAgentDefs,
    workdir: session.workdir,
    messages: requestMessages,
    injectedFiles,
    promptTools: toolRegistry.definitions,
    requestTools: toolRegistry.definitions,
    toolChoice: 'none',
    disableThinking: true,
    ...(instructions ? { customInstructions: instructions } : {}),
    ...(skills.length > 0 ? { skills } : {}),
  })

  // Append compaction instruction as a system-reminder user message
  // (same pattern as planner/builder mode transitions — preserves cache prefix)
  const compactionReminder = `<system-reminder>\n${COMPACTION_PROMPT}\n</system-reminder>`
  const llmMessages = [
    ...assembledRequest.messages,
    { role: 'user' as const, content: compactionReminder },
  ]

  const compactPromptMsgId = crypto.randomUUID()
  eventStore.append(sessionId, createMessageStartEvent(compactPromptMsgId, 'user', COMPACTION_PROMPT, {
    ...(getCurrentWindowMessageOptions(sessionId) ?? {}),
    isSystemGenerated: true,
    messageKind: 'auto-prompt',
    metadata: { type: 'compaction', name: 'Compaction', color: '#64748b' },
  }))
  eventStore.append(sessionId, { type: 'message.done', data: { messageId: compactPromptMsgId } })

  const assistantMsgId = crypto.randomUUID()
  eventStore.append(sessionId, createMessageStartEvent(assistantMsgId, 'assistant', undefined, getCurrentWindowMessageOptions(sessionId)))

  const turnMetrics = new TurnMetrics()

  const compactionToolRegistry = {
    execute: async (name: string, args: Record<string, unknown>, ctx: {
      sessionId: string
      workdir: string
      signal?: AbortSignal
      llmClient: LLMClientWithModel
      statsIdentity: StatsIdentity
      dangerLevel?: 'normal' | 'dangerous'
      toolCallId: string
    }) => {
      return toolRegistry.execute(name, args, {
        ...ctx,
        sessionManager,
      })
    },
  }

  const result = await consumeStreamWithToolLoop({
    messageId: assistantMsgId,
    systemPrompt: assembledRequest.systemPrompt,
    llmClient,
    messages: llmMessages,
    tools: toolRegistry.definitions,
    toolChoice: 'auto',
    disableThinking: true,
    turnMetrics,
    toolRegistry: compactionToolRegistry,
    sessionId,
    workdir: session.workdir,
    onEvent: (event) => eventStore.append(sessionId, event),
    statsIdentity,
    ...(session.dangerLevel ? { dangerLevel: session.dangerLevel } : {}),
    ...(signal ? { signal } : {}),
  })

  if (result.aborted) {
    throw new Error('Aborted')
  }

  const compactionStats = turnMetrics.buildStats(statsIdentity, 'compaction')
  eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'complete', compactionStats))

  let summary = (result.content ?? '').trim()
  if (!summary && result.thinkingContent != null) {
    logger.info('Using thinking content as compaction summary (text content was empty)', { sessionId })
    summary = (result.thinkingContent ?? '').trim()
  }

  if (!summary) {
    throw new Error('Compaction produced empty summary')
  }

  sessionManager.compactContext(sessionId, summary, tokenCountAtClose)

  logger.info(`${trigger === 'auto' ? 'Auto' : 'Manual'} compaction complete`, {
    sessionId,
    trigger,
    tokensBefore: tokenCountAtClose,
    summaryLength: summary.length,
    summaryTokens: result.usage.completionTokens,
  })
}

export function resolveCompactionStatsIdentity(
  llmClient: LLMClientWithModel,
  getActiveProvider?: () => Provider | undefined,
): StatsIdentity {
  const provider = getActiveProvider?.()
  const model = llmClient.getModel()
  const backend = llmClient.getBackend?.() ?? 'unknown'

  return {
    providerId: provider?.id ?? `provider:${model}`,
    providerName: provider?.name ?? 'Unknown Provider',
    backend,
    model,
  }
}
