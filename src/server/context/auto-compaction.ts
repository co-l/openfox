import type { Attachment, InjectedFile, Provider, StatsIdentity } from '../../shared/types.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { SessionManager } from '../session/index.js'
import { getEventStore, getContextMessages, getCurrentContextWindowId } from '../events/index.js'
import { getAllInstructions } from './instructions.js'
import { shouldCompact } from './compactor.js'
import { COMPACTION_PROMPT, FORMAT_CORRECTION_PROMPT, MAX_FORMAT_RETRIES } from '../chat/prompts.js'
import { assemblePlannerRequest, type RequestContextMessage } from '../chat/request-context.js'
import {
  TurnMetrics,
  createMessageStartEvent,
  createMessageDoneEvent,
  createChatDoneEvent,
} from '../chat/stream-pure.js'
import { streamLLMPure, consumeStreamGenerator } from '../chat/stream-pure.js'
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

  await performContextCompaction({
    ...options,
    tokenCountAtClose: contextState.currentTokens,
    trigger: 'auto',
  })
  return true
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
  const assembledRequest = assemblePlannerRequest({
    workdir: session.workdir,
    messages: requestMessages,
    includeRuntimeReminder: false,
    injectedFiles,
    promptTools: [],
    requestTools: [],
    toolChoice: 'none',
    disableThinking: true,
    ...(instructions ? { customInstructions: instructions } : {}),
  })

  const compactPromptMsgId = crypto.randomUUID()
  eventStore.append(sessionId, createMessageStartEvent(compactPromptMsgId, 'user', COMPACTION_PROMPT, {
    ...(getCurrentWindowMessageOptions(sessionId) ?? {}),
    isSystemGenerated: true,
    messageKind: 'auto-prompt',
  }))
  eventStore.append(sessionId, { type: 'message.done', data: { messageId: compactPromptMsgId } })

  const assistantMsgId = crypto.randomUUID()
  eventStore.append(sessionId, createMessageStartEvent(assistantMsgId, 'assistant', undefined, getCurrentWindowMessageOptions(sessionId)))

  const turnMetrics = new TurnMetrics()
  const correctionMessages: Array<{ role: 'user'; content: string }> = []
  let result: Awaited<ReturnType<typeof consumeStreamGenerator>> | null = null

  for (let attempt = 0; attempt < MAX_FORMAT_RETRIES; attempt++) {
    const streamGen = streamLLMPure({
      messageId: assistantMsgId,
      systemPrompt: assembledRequest.systemPrompt,
      llmClient,
      messages: [...assembledRequest.messages, ...correctionMessages],
      tools: [],
      toolChoice: 'none',
      disableThinking: true,
      ...(signal ? { signal } : {}),
    })
    result = await consumeStreamGenerator(streamGen, event => {
      eventStore.append(sessionId, event)
    })

    if (result.aborted) {
      throw new Error('Aborted')
    }

    if (!result.xmlFormatError) {
      break
    }

    logger.warn('Compaction XML tool format error, retrying', {
      sessionId,
      attempt: attempt + 1,
      maxAttempts: MAX_FORMAT_RETRIES,
    })

    correctionMessages.push({ role: 'user', content: FORMAT_CORRECTION_PROMPT })
  }

  if (!result || result.xmlFormatError) {
    throw new Error('Compaction summary generation failed due to XML tool format output')
  }

  turnMetrics.addLLMCall(result.timing, result.usage.promptTokens, result.usage.completionTokens)
  const compactionStats = turnMetrics.buildStats(statsIdentity, 'planner')
  eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
    segments: result.segments,
    stats: compactionStats,
    promptContext: assembledRequest.promptContext,
  }))
  eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'complete', compactionStats))

  sessionManager.compactContext(sessionId, result.content, tokenCountAtClose)

  logger.info(`${trigger === 'auto' ? 'Auto' : 'Manual'} compaction complete`, {
    sessionId,
    trigger,
    tokensBefore: tokenCountAtClose,
    summaryTokens: result.usage.completionTokens,
  })
}

export function resolveCompactionStatsIdentity(
  llmClient: LLMClientWithModel,
  getActiveProvider?: () => Provider | undefined,
): StatsIdentity {
  const provider = getActiveProvider?.()
  const model = llmClient.getModel()
  const backend = provider?.backend ?? (llmClient.getBackend() === 'unknown' ? 'unknown' : llmClient.getBackend())

  return {
    providerId: provider?.id ?? `provider:${model}`,
    providerName: provider?.name ?? 'Unknown Provider',
    backend,
    model,
  }
}
