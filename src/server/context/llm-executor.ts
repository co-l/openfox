/**
 * Shared LLM Execution Logic
 *
 * Provides a reusable LLM execution context for both main agents and subagents.
 * Handles:
 * - LLM streaming with token tracking
 * - Context state emission (with optional subAgentId for routing to UI)
 * - Auto-compaction via planner agent (same logic for main and subagents)
 *
 * Both agent-loop.ts and sub-agents/manager.ts use this class.
 */

import type { InjectedFile, StatsIdentity, ToolCall, ToolResult, Criterion } from '../../shared/types.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { SessionManager } from '../session/index.js'
import type { ToolRegistry } from '../tools/types.js'
import type { RequestContextMessage } from '../chat/request-context.js'
import { streamLLMPure, consumeStreamGenerator, TurnMetrics, createMessageStartEvent, createMessageDoneEvent, createChatDoneEvent } from '../chat/stream-pure.js'
import { getEventStore } from '../events/index.js'
import { emitContextState } from '../events/session.js'
import { shouldCompact } from './compactor.js'
import { estimateContextSize } from './tokenizer.js'
import { COMPACTION_PROMPT } from '../chat/prompts.js'
import { assembleAgentRequest } from '../chat/request-context.js'
import { getToolRegistryForAgent } from '../tools/index.js'
import { loadAllAgentsDefault, findAgentById } from '../agents/registry.js'
import { getAllInstructions } from './instructions.js'
import { getEnabledSkillMetadata } from '../skills/registry.js'
import { getRuntimeConfig } from '../runtime-config.js'
import { getGlobalConfigDir } from '../../cli/paths.js'
import { logger } from '../utils/logger.js'
import { appendNudgeMessage } from './nudge-helpers.js'

export interface LLMExecutorConfig {
  sessionId: string
  subAgentId?: string
  subAgentType?: string
  sessionManager: SessionManager
  llmClient: LLMClientWithModel
  statsIdentity: StatsIdentity
  systemPrompt: string
  messages: RequestContextMessage[]
  tools: ToolRegistry['definitions']
  signal?: AbortSignal | undefined
  turnMetrics: TurnMetrics
  injectedFiles?: InjectedFile[]
  customInstructions?: string
  onToolExecuted?: (toolCall: ToolCall, result: ToolResult) => void
}

interface CompactionContext {
  systemPrompt: string
  messages: RequestContextMessage[]
  tools: ToolRegistry['definitions']
  injectedFiles: InjectedFile[]
  customInstructions?: string
}

export class LLMExecutor {
  private readonly config: LLMExecutorConfig
  private readonly eventStore = getEventStore()
  private compactionCount = 0
  private currentTokens = 0
  private maxTokens = 0

  constructor(config: LLMExecutorConfig) {
    this.config = config
    this.initContextSize()
  }

  private initContextSize(): void {
    const contextState = this.config.sessionManager.getContextState(this.config.sessionId)
    this.maxTokens = contextState.maxTokens
  }

  private emitContextState(tokens: number): void {
    const { sessionId, sessionManager, subAgentId } = this.config
    const contextState = sessionManager.getContextState(sessionId)
    const dangerZone = this.maxTokens - tokens < 20000
    const canCompact = contextState.canCompact && this.compactionCount < 10

    sessionManager.setCurrentContextSize(sessionId, tokens)
    this.currentTokens = tokens

    emitContextState(
      sessionId,
      tokens,
      this.maxTokens,
      this.compactionCount,
      dangerZone,
      canCompact,
      subAgentId,
    )
  }

  private async checkAndCompact(): Promise<boolean> {
    const { sessionId } = this.config
    const config = getRuntimeConfig()

    if (!shouldCompact(this.currentTokens, this.maxTokens, config.context.compactionThreshold)) {
      return false
    }

    logger.info('Auto-compaction triggered for executor', {
      sessionId,
      subAgentId: this.config.subAgentId,
      currentTokens: this.currentTokens,
      maxTokens: this.maxTokens,
      threshold: config.context.compactionThreshold,
    })

    try {
      await this.performCompaction()
      return true
    } catch (error) {
      if (error instanceof Error && error.message === 'Aborted') {
        throw error
      }

      logger.error('Auto-compaction failed in executor, continuing', {
        sessionId,
        subAgentId: this.config.subAgentId,
        error: error instanceof Error ? error.message : String(error),
      })

      this.eventStore.append(sessionId, {
        type: 'chat.error',
        data: {
          error: `Auto-compaction failed: ${error instanceof Error ? error.message : 'Unknown error'}. Continuing with full context.`,
          recoverable: true,
        },
      })

      return false
    }
  }

  async performCompaction(): Promise<void> {
    const { sessionId, sessionManager, llmClient, statsIdentity, signal, subAgentId } = this.config
    const session = sessionManager.requireSession(sessionId)
    const { content: instructions, files } = await getAllInstructions(session.workdir, session.projectId)

    const compactionCtx: CompactionContext = {
      systemPrompt: this.config.systemPrompt,
      messages: this.config.messages,
      tools: this.config.tools,
      injectedFiles: this.config.injectedFiles ?? files.map(f => ({ path: f.path, content: f.content ?? '', source: f.source })),
      customInstructions: this.config.customInstructions ?? instructions,
    }

    const allAgents = await loadAllAgentsDefault()
    const plannerDef = findAgentById('planner', allAgents)!
    const plannerToolRegistry = getToolRegistryForAgent(plannerDef)
    const configDir = getGlobalConfigDir(getRuntimeConfig().mode ?? 'production')
    const skills = await getEnabledSkillMetadata(configDir)

    const assembledRequest = assembleAgentRequest({
      agentDef: plannerDef,
      subAgentDefs: [],
      workdir: session.workdir,
      messages: compactionCtx.messages.map(m => ({
        role: m.role,
        content: m.content,
        source: m.source,
        ...(m.toolCalls ? { toolCalls: m.toolCalls } : {}),
        ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
      })),
      injectedFiles: compactionCtx.injectedFiles,
      promptTools: plannerToolRegistry.definitions,
      requestTools: plannerToolRegistry.definitions,
      toolChoice: 'none',
      disableThinking: true,
      ...(compactionCtx.customInstructions ? { customInstructions: compactionCtx.customInstructions } : {}),
      ...(skills.length > 0 ? { skills } : {}),
    })

    const compactionReminder = `<system-reminder>\n${COMPACTION_PROMPT}\n</system-reminder>`
    const llmMessages = [
      ...assembledRequest.messages,
      { role: 'user' as const, content: compactionReminder },
    ]

    const compactPromptMsgId = crypto.randomUUID()
    this.eventStore.append(sessionId, createMessageStartEvent(compactPromptMsgId, 'user', COMPACTION_PROMPT, {
      ...(subAgentId ? { subAgentId } : {}),
      ...(this.config.subAgentType ? { subAgentType: this.config.subAgentType } : {}),
      isSystemGenerated: true,
      messageKind: 'auto-prompt',
      metadata: {
        type: 'compaction',
        name: 'Compaction',
        color: '#64748b',
        ...(subAgentId ? { subAgentId } : {}),
      },
    }))
    this.eventStore.append(sessionId, { type: 'message.done', data: { messageId: compactPromptMsgId } })

    const assistantMsgId = crypto.randomUUID()
    this.eventStore.append(sessionId, createMessageStartEvent(assistantMsgId, 'assistant', undefined, {
      ...(subAgentId ? { subAgentId } : {}),
      ...(this.config.subAgentType ? { subAgentType: this.config.subAgentType } : {}),
    }))

    const compactionTurnMetrics = new TurnMetrics()

    const result = await consumeStreamGenerator(streamLLMPure({
      messageId: assistantMsgId,
      systemPrompt: assembledRequest.systemPrompt,
      llmClient,
      messages: llmMessages,
      tools: plannerToolRegistry.definitions,
      toolChoice: 'none',
      disableThinking: true,
      signal,
    }), event => this.eventStore.append(sessionId, event))

    if (result.aborted) {
      throw new Error('Aborted')
    }

    const stats = compactionTurnMetrics.buildStats(statsIdentity, 'compaction')
    this.eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'complete', stats))

    const summary = (result.content ?? result.thinkingContent ?? '').trim()
    if (!summary) {
      throw new Error('Compaction produced empty summary')
    }

    this.compactionCount++
    this.config.messages = [{ role: 'user', content: `Previous context summary: ${summary}`, source: 'history' }]

    const contextEstimate = estimateContextSize(compactionCtx.systemPrompt, [{ role: 'user', content: summary }], this.maxTokens)
    this.emitContextState(contextEstimate.estimatedTokens)

    logger.info('Compaction complete in executor', {
      sessionId,
      subAgentId: this.config.subAgentId,
      tokensBefore: this.currentTokens,
      tokensAfter: contextEstimate.estimatedTokens,
      compactionCount: this.compactionCount,
    })
  }

  async execute(): Promise<{
    content: string
    toolCalls: ToolCall[]
    usage: { promptTokens: number; completionTokens: number }
    aborted: boolean
  }> {
    const { llmClient, signal, systemPrompt, messages, tools, subAgentId, subAgentType } = this.config

    const assistantMsgId = crypto.randomUUID()
    this.eventStore.append(this.sessionId, createMessageStartEvent(assistantMsgId, 'assistant', undefined, {
      ...(subAgentId ? { subAgentId } : {}),
      ...(subAgentType ? { subAgentType } : {}),
    }))

    const streamGen = streamLLMPure({
      messageId: assistantMsgId,
      systemPrompt,
      llmClient,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.toolCalls ? { toolCalls: m.toolCalls } : {}),
        ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
      })),
      tools,
      toolChoice: 'auto',
      signal,
      disableThinking: true,
    })

    const result = await consumeStreamGenerator(streamGen, event => this.eventStore.append(this.sessionId, event))

    if (!result.aborted) {
      this.config.turnMetrics.addLLMCall(result.timing, result.usage.promptTokens, result.usage.completionTokens)
      this.emitContextState(result.usage.promptTokens)
    }

    return {
      content: result.content,
      toolCalls: result.toolCalls,
      usage: result.usage,
      aborted: result.aborted,
    }
  }

  async executeWithCompaction(): Promise<{
    content: string
    toolCalls: ToolCall[]
    usage: { promptTokens: number; completionTokens: number }
    aborted: boolean
  }> {
    if (this.signal?.aborted) {
      throw new Error('Aborted')
    }

    await this.checkAndCompact()

    return this.execute()
  }

  getMessages(): RequestContextMessage[] {
    return this.config.messages
  }

  addMessage(message: RequestContextMessage): void {
    this.config.messages = [...this.config.messages, message]
  }

  getCompactionCount(): number {
    return this.compactionCount
  }

  getCurrentTokens(): number {
    return this.currentTokens
  }

  getMaxTokens(): number {
    return this.maxTokens
  }

  get sessionId(): string {
    return this.config.sessionId
  }

  private get signal(): AbortSignal | undefined {
    return this.config.signal
  }
}

export interface NudgeConfig {
  maxConsecutiveNudges: number
  getCriteriaAwaiting: (criteria: Criterion[]) => Criterion[]
  buildNudgeContent: (criteria: Criterion[]) => string
  buildRestartContent: (criteria: Criterion[]) => string
}

function buildPromptContext(
  systemPrompt: string,
  injectedFiles: InjectedFile[],
  userMessage: string,
  messages: RequestContextMessage[],
  tools: ToolRegistry['definitions'],
): import('../../shared/types.js').PromptContext {
  return {
    systemPrompt,
    injectedFiles,
    userMessage,
    messages: messages.map(m => ({ role: m.role as 'user' | 'assistant' | 'tool', content: m.content, source: m.source })) as import('../../shared/types.js').PromptContextMessage[],
    tools: tools.map(t => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters })),
    requestOptions: { toolChoice: 'auto', disableThinking: true },
  }
}

export interface RunSubAgentOptions {
  subAgentType: string
  prompt: string
  sessionManager: SessionManager
  sessionId: string
  llmClient: LLMClientWithModel
  toolRegistry: { definitions: ToolRegistry['definitions'] }
  turnMetrics: TurnMetrics
  statsIdentity: StatsIdentity
  signal?: AbortSignal | undefined
  onMessage?: ((msg: import('../../shared/protocol.js').ServerMessage) => void) | undefined
  nudgeConfig?: NudgeConfig
}

export interface SubAgentResult {
  content: string
  result?: string
  allPassed?: boolean
  failed?: Array<{ id: string; reason: string }>
}

const RETURN_VALUE_NUDGE = 'You must call return_value with a summary of your findings before finishing. Call return_value now.'

export async function runSubAgentWithExecutor(options: RunSubAgentOptions): Promise<SubAgentResult> {
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
    nudgeConfig,
    onMessage,
  } = options

  const eventStore = getEventStore()
  const subAgentInstanceId = crypto.randomUUID()
  const currentWindowMessageOptions = { contextWindowId: '' }

  let session = sessionManager.requireSession(sessionId)

  const allAgents = await loadAllAgentsDefault()
  const agentDef = findAgentById(subAgentType, allAgents)
  if (!agentDef) {
    throw new Error(`Unknown sub-agent type: ${subAgentType}`)
  }

  const { content: instructionContent, files } = await getAllInstructions(session.workdir, session.projectId)
  const injectedFiles: InjectedFile[] = files.map(f => ({ path: f.path, content: f.content ?? '', source: f.source }))
  const configDir = getGlobalConfigDir(getRuntimeConfig().mode ?? 'production')
  const skills = await getEnabledSkillMetadata(configDir)

  const systemPrompt = (await import('../chat/prompts.js')).buildSubAgentSystemPrompt(
    session.workdir,
    agentDef,
    skills.length > 0 ? skills : undefined,
  )

  const initialContextMessages: RequestContextMessage[] = [
    { role: 'user', content: prompt, source: 'runtime' },
  ]

  const executor = new LLMExecutor({
    sessionId,
    subAgentId: subAgentInstanceId,
    subAgentType,
    sessionManager,
    llmClient,
    statsIdentity,
    systemPrompt,
    messages: [...initialContextMessages],
    tools: toolRegistry.definitions,
    signal,
    turnMetrics,
    injectedFiles,
    customInstructions: instructionContent,
  })

  let consecutiveEmptyStops = 0
  let returnValueContent: string | null = null
  let returnValueResult: string | undefined = undefined
  let returnValueNudged = false

  for (;;) {
    if (signal?.aborted) {
      throw new Error('Aborted')
    }

    const assistantMsgId = crypto.randomUUID()
    eventStore.append(sessionId, createMessageStartEvent(assistantMsgId, 'assistant', undefined, {
      contextWindowId: currentWindowMessageOptions.contextWindowId,
      subAgentId: subAgentInstanceId,
      subAgentType,
    }))

    const result = await executor.executeWithCompaction()

    if (result.aborted) {
      const stats = turnMetrics.buildStats(statsIdentity, subAgentType)
      eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
        stats,
        partial: true,
        promptContext: buildPromptContext(
          systemPrompt,
          injectedFiles,
          prompt,
          executor.getMessages().map(m => ({ role: m.role, content: m.content, source: m.source })),
          toolRegistry.definitions,
        ),
      }))
      eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'stopped', stats))
      throw new Error('Aborted')
    }

    executor.addMessage({
      role: 'assistant',
      content: result.content,
      source: 'history',
      ...(result.toolCalls.length > 0 && { toolCalls: result.toolCalls }),
    })

    if (result.toolCalls.length === 0) {
      if (nudgeConfig) {
        session = sessionManager.requireSession(sessionId)
        const criteriaAwaiting = nudgeConfig.getCriteriaAwaiting(session.criteria)
        if (criteriaAwaiting.length > 0) {
          if (consecutiveEmptyStops < nudgeConfig.maxConsecutiveNudges) {
            consecutiveEmptyStops += 1
            const nudgeContent = nudgeConfig.buildNudgeContent(criteriaAwaiting)

            eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
              segments: [],
              promptContext: buildPromptContext(systemPrompt, injectedFiles, prompt, executor.getMessages(), toolRegistry.definitions),
            }))
            appendNudgeMessage(eventStore, sessionId, nudgeContent, currentWindowMessageOptions, {
              subAgentId: subAgentInstanceId,
              subAgentType,
            })
            executor.addMessage({ role: 'user', content: nudgeContent, source: 'runtime' })
            continue
          }

          const stalledMsgId = crypto.randomUUID()
          eventStore.append(sessionId, createMessageStartEvent(stalledMsgId, 'user', nudgeConfig.buildRestartContent(criteriaAwaiting), {
            contextWindowId: currentWindowMessageOptions.contextWindowId,
            isSystemGenerated: true,
            messageKind: 'correction',
            subAgentId: subAgentInstanceId,
            subAgentType,
          }))
          eventStore.append(sessionId, { type: 'message.done', data: { messageId: stalledMsgId } })
        }
      }

      if (!returnValueContent && !returnValueNudged) {
        returnValueNudged = true
        const nudgeMsgId = crypto.randomUUID()
        eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
          segments: [],
          promptContext: buildPromptContext(systemPrompt, injectedFiles, prompt, executor.getMessages(), toolRegistry.definitions),
        }))
        eventStore.append(sessionId, createMessageStartEvent(nudgeMsgId, 'user', RETURN_VALUE_NUDGE, {
          contextWindowId: currentWindowMessageOptions.contextWindowId,
          isSystemGenerated: true,
          messageKind: 'correction',
          subAgentId: subAgentInstanceId,
          subAgentType,
        }))
        eventStore.append(sessionId, { type: 'message.done', data: { messageId: nudgeMsgId } })
        executor.addMessage({ role: 'user', content: RETURN_VALUE_NUDGE, source: 'runtime' })
        continue
      }

      const stats = turnMetrics.buildStats(statsIdentity, subAgentType)
      eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
        segments: [],
        stats,
        promptContext: buildPromptContext(systemPrompt, injectedFiles, prompt, executor.getMessages(), toolRegistry.definitions),
      }))
      eventStore.append(sessionId, createChatDoneEvent(assistantMsgId, 'complete', stats))
      break
    }

    eventStore.append(sessionId, createMessageDoneEvent(assistantMsgId, {
      segments: [],
      promptContext: buildPromptContext(systemPrompt, injectedFiles, prompt, executor.getMessages(), toolRegistry.definitions),
    }))

    const batchResult = await (async () => {
      const { executeToolBatch } = await import('../chat/agent-loop.js')
      return executeToolBatch(assistantMsgId, result.toolCalls, {
        toolRegistry: toolRegistry as never,
        sessionManager,
        sessionId,
        workdir: session.workdir,
        turnMetrics,
        signal,
        onMessage,
      })
    })()

    if (batchResult.returnValueContent) {
      returnValueContent = batchResult.returnValueContent
    }
    if (batchResult.returnValueResult) {
      returnValueResult = batchResult.returnValueResult
    }

    executor.addMessage({ role: 'tool', content: batchResult.toolMessages.map(m => m.content).join('\n'), source: 'history' })

    session = sessionManager.requireSession(sessionId)

    if (nudgeConfig) {
      consecutiveEmptyStops = 0
    }
  }

  const finalContent = returnValueContent ?? ''

  if (subAgentType === 'verifier') {
    session = sessionManager.requireSession(sessionId)
    const remaining = nudgeConfig?.getCriteriaAwaiting(session.criteria) ?? []
    const failed = session.criteria
      .filter(c => c.status.type === 'failed')
      .map(c => ({
        id: c.id,
        reason: c.status.type === 'failed' ? c.status.reason : 'unknown',
      }))
    return {
      content: returnValueContent ?? finalContent,
      ...(returnValueResult ? { result: returnValueResult } : {}),
      allPassed: failed.length === 0 && remaining.length === 0,
      failed,
    }
  }

  return {
    content: returnValueContent ?? finalContent,
    ...(returnValueResult ? { result: returnValueResult } : { result: 'success' }),
  }
}