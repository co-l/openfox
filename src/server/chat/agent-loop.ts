/**
 * Unified Agent Execution Loop
 *
 * Extracts the shared execution logic from runPlannerTurn, runBuilderTurn,
 * and executeSubAgent into reusable helpers.
 *
 * - executeToolBatch(): shared tool execution (used by all agent types)
 * - runTopLevelAgentLoop(): replaces duplicated planner/builder turns
 */

import type { InjectedFile, StatsIdentity, ToolCall, ToolMode, ToolResult } from '../../shared/types.js'
import type { ServerMessage } from '../../shared/protocol.js'
import type { LLMClientWithModel } from '../llm/client.js'
import { getModelProfile } from '../llm/profiles.js'
import type { LLMToolDefinition } from '../llm/types.js'
import type { ProviderManager } from '../provider-manager.js'
import type { SessionManager } from '../session/index.js'
import type { ToolRegistry } from '../tools/types.js'
import type { RequestContextMessage, MinimalMessage } from './request-context.js'
import type { RetryPatternConfig } from './auto-patterns.js'
import {
  streamLLMPure,
  consumeStreamGenerator,
  TurnMetrics,
  createMessageStartEvent,
  createMessageDoneEvent,
  createChatDoneEvent,
  evaluateLLMRetry,
  sleepThroughRetryBackoff,
  recordLLMFailure,
  clearLLMFailure,
} from './stream-pure.js'
import { LiveEditContextTracker } from './edit-file-preview.js'
import { preflightPathTool } from './tool-preflight.js'
import { getCurrentContextWindowId, getCurrentWindowMessageOptions } from '../events/index.js'
import { getAllInstructions } from '../context/instructions.js'
import { getEnabledSkillMetadata } from '../skills/registry.js'
import { getRuntimeConfig } from '../runtime-config.js'
import { getGlobalConfigDir } from '../../cli/paths.js'
import { getSetting, SETTINGS_KEYS } from '../db/settings.js'
import {
  createChatMessageUpdatedMessage,
  createChatDoneMessage,
  createChatLLMRetryMessage,
  createChatLLMRetryFailedMessage,
  createChatStatsMessage,
} from '../ws/protocol.js'
import { executeTools, type ToolBatchContext } from './execute-tools.js'
import {
  CHARS_PER_TOKEN,
  estimateToolResultTokens,
  fitToolResults,
  isContextLengthError,
  messageChars,
  promptOverflow,
} from './token-budget.js'
import { appendCompactionPrompt, shouldCompact } from '../context/compactor.js'
import { loadAllAgentsDefault, getSubAgents } from '../agents/registry.js'
import { createRetryLimiter, type RetryLimiter } from './retry-limiter.js'
import { drainQueue } from './drain-queue.js'
import { COMPACTION_PROMPT, CONTINUE_PROMPT, CONTINUE_AFTER_STREAM_ERROR_PROMPT } from './prompts.js'
import { logger } from '../utils/logger.js'
import { emitPluginHook } from '../plugins/hook-emitter.js'
import { applyPluginMessageTransforms } from '../plugins/message-transforms.js'
import type { LLMRetryPolicy } from '../runner/types.js'
import { DEFAULT_LLM_RETRY_POLICY } from '../runner/types.js'
import { serverT } from '../i18n.js'

function emitPartialDoneEvents(
  _sessionId: string,
  assistantMsgId: string,
  statsIdentity: import('../../shared/types.js').StatsIdentity,
  mode: import('../../shared/types.js').ToolMode,
  turnMetrics: TurnMetrics,
  append: (event: import('../events/types.js').TurnEvent) => void,
  agentType?: 'sub-agent',
): void {
  const stats = turnMetrics.buildStats(statsIdentity, mode)
  append(
    createMessageDoneEvent(assistantMsgId, {
      stats,
      partial: true,
    }),
  )
  append(createChatDoneEvent(assistantMsgId, 'stopped', stats, agentType))
}

function emitDoneAndBreak(
  assistantMsgId: string,
  segments: import('../../shared/types.js').MessageSegment[] | undefined,
  statsIdentity: import('../../shared/types.js').StatsIdentity,
  mode: import('../../shared/types.js').ToolMode,
  turnMetrics: TurnMetrics,
  append: (event: import('../events/types.js').TurnEvent) => void,
  onMessage: ((msg: ServerMessage) => void) | undefined,
  reason: 'complete' | 'stopped' | 'error' | 'waiting_for_user' | 'truncated' | 'step_done',
  agentType?: 'sub-agent',
): void {
  const stats = turnMetrics.buildStats(statsIdentity, mode)
  append(
    createMessageDoneEvent(assistantMsgId, {
      ...(segments ? { segments } : {}),
      stats,
    }),
  )
  append(createChatDoneEvent(assistantMsgId, reason, stats, agentType))
  if (onMessage) {
    onMessage(
      createChatMessageUpdatedMessage(assistantMsgId, {
        isStreaming: false,
        stats,
      }),
    )
    onMessage(createChatDoneMessage(assistantMsgId, reason, stats, agentType))
  }
}

/**
 * Broadcast the cumulative turn stats to the client as an LLM call completes,
 * so the sidebar can render live numbers while the turn is still running.
 */
function emitLiveTurnStats(
  turnMetrics: TurnMetrics,
  statsIdentity: import('../../shared/types.js').StatsIdentity,
  mode: import('../../shared/types.js').ToolMode,
  onMessage: ((msg: ServerMessage) => void) | undefined,
): void {
  if (!onMessage) return
  onMessage(createChatStatsMessage(turnMetrics.buildStats(statsIdentity, mode)))
}

// ============================================================================
// Types
// ============================================================================

export interface TopLevelLoopConfig {
  mode: ToolMode
  retryPatterns?: RetryPatternConfig[]
  maxRetriesPerTurn?: number
  /** Resolves retry patterns and the retry cap fresh on every LLM round, so a
   *  mid-turn edit (deleting/toggling a pattern in the UI) takes effect on the
   *  next round. When set, takes precedence over the static `retryPatterns`
   *  and `maxRetriesPerTurn` above. */
  retryPatternsProvider?:
    | (() => Promise<{
        retryPatterns: RetryPatternConfig[]
        maxRetriesPerTurn: number
      }>)
    | undefined
  /** Function to append events (provided by orchestrator) */
  append: (event: import('../events/types.js').TurnEvent) => void
  sessionManager: SessionManager
  sessionId: string
  llmClient: LLMClientWithModel
  /** Re-resolve the LLM client for each attempt so a mid-turn provider switch
   *  (e.g. during retry backoff) takes effect on the next attempt. Falls back
   *  to `llmClient` when absent. */
  getLLMClient?: (() => LLMClientWithModel) | undefined
  statsIdentity: StatsIdentity
  providerManager?: ProviderManager | undefined
  /** Override model settings (e.g. for sub-agents with model override).
   *  When set, these are used instead of sessionManager.getCurrentModelSettings(). */
  modelSettings?: {
    temperature?: number
    topP?: number
    topK?: number
    maxTokens?: number
    supportsVision?: boolean
    chatTemplateKwargs?: Record<string, unknown>
    queryParams?: Record<string, unknown>
    omitParams?: string[]
  }
  signal?: AbortSignal | undefined
  onMessage?: ((msg: ServerMessage) => void) | undefined
  assembleRequest: (input: {
    workdir: string
    messages: RequestContextMessage[]
    injectedFiles: InjectedFile[]
    promptTools: LLMToolDefinition[]
    toolChoice: 'auto' | 'none' | 'required'
    customInstructions?: string
    skills?: import('../skills/types.js').SkillMetadata[]
  }) => Promise<{
    systemPrompt: string
    messages: MinimalMessage[]
    tools: LLMToolDefinition[]
  }>
  getToolRegistry: () => ToolRegistry
  onToolExecuted?: ((toolCall: ToolCall, result: ToolResult) => void) | undefined
  injectKickoff?: (() => void | Promise<void>) | undefined
  /** Called after auto-compaction completes within the loop, before the next iteration.
   *  Reinjects the agent definition reminder into the new context window. */
  injectAgentReminder?: (() => void) | undefined
  /** Called after a compaction creates a new context window, so the fresh
   *  system prompt + tools become canonical for that window. */
  rebuildCachedContext?: (() => Promise<void> | void) | undefined
  /** When set, assistant messages are tagged with sub-agent metadata for scope isolation. */
  subAgentMetadata?: { subAgentId: string; subAgentType: string; subAgentName?: string }
  /** When set and return_value tool is called, emit done events and break immediately. */
  breakOnReturnValue?: boolean
  /** When set, if the loop would normally break without return_value being called,
   *  inject a nudge and continue. Retries up to maxReturnValueNudges times.
   *  Prevents sub-agents from finishing without passing their result back. */
  requireReturnValue?: boolean
  /** Maximum number of return_value nudges before giving up. Default 10. */
  maxReturnValueNudges?: number
  /** Build conversation messages for the LLM, with image processing applied.
   *  Called each iteration to get fresh context. */
  getConversationMessages: () => Promise<RequestContextMessage[]>
  /** When true, the loop starts in compacting mode (used for manual compaction).
   *  After compaction completes, the loop breaks instead of continuing. */
  initialCompacting?: boolean
  /** When true, only warm up the LLM cache by sending system prompt + tools.
   *  Skips message creation, event emission, tool execution — just prefills the KV cache. */
  warmup?: boolean
  /** Overrides for the LLM-failure retry backoff policy (retried inside streamLLMPure). */
  llmRetryPolicy?: Partial<LLMRetryPolicy>
}

// ============================================================================
// Top-Level Agent Loop (replaces runPlannerTurn / runBuilderTurn)
// ============================================================================

const MAX_TRUNCATION_RETRIES = 3
const MAX_CONTEXT_LENGTH_RETRIES = 3
const OUTPUT_RESERVE_TOKENS = 2048
/** Output room a compaction request keeps for the summary (see fitToolResults). */
const COMPACTION_SUMMARY_TOKENS = 4096
/**
 * Message characters a request needs before its measured prompt tokens are
 * used as the density: below, the system prompt and tool definitions (counted
 * in the tokens, not in the characters) skew it too much.
 */
const DENSITY_MIN_CHARS = 40_000

export async function runTopLevelAgentLoop(
  config: TopLevelLoopConfig,
  turnMetrics: TurnMetrics,
): Promise<{ returnValueContent?: string; returnValueResult?: string; failed?: { error: string } }> {
  const { mode, sessionManager, sessionId, llmClient, signal, onMessage, statsIdentity } = config
  const append = config.append
  const agentType = config.subAgentMetadata ? ('sub-agent' as const) : undefined
  // Sub-agent identity tags spread into scoped events (assistant messages,
  // compaction prompt/summary, rejection, nudges) so they stay in the
  // sub-agent's context and chatfeed window. Empty for top-level runs.
  const subAgentTags = (): { subAgentId?: string; subAgentType?: string } =>
    config.subAgentMetadata
      ? { subAgentId: config.subAgentMetadata.subAgentId, subAgentType: config.subAgentMetadata.subAgentType }
      : {}
  // Fresh per attempt when a resolver is provided (provider switch mid-turn).
  const resolveClient = () => config.getLLMClient?.() ?? llmClient

  const retryLimiter: RetryLimiter = createRetryLimiter(config.maxRetriesPerTurn ?? 10)
  let truncationRetryCount = 0
  let contextRetryCount = 0
  let pendingToolResultTokens = 0
  let returnValueContent: string | undefined
  let returnValueResult: string | undefined
  let currentMaxTokensOverride: number | undefined
  let lastPatternMatch: { pattern: string; field: string; matchedContent: string } | undefined
  let compacting = config.initialCompacting ?? false
  // Set after a compaction attempt that produced no usable summary: the
  // single retry runs without thinking (see the compacting branch below).
  let compactionRetryWithoutThinking = false
  // Characters per prompt token, measured on the last large enough request
  // (its characters, system prompt and tool definitions included / the prompt
  // tokens the backend counted or, on an overflow, reported). Our ~4 characters per token estimate is far off
  // for code and logs (llama.cpp counted ~3): once measured, this density
  // sizes the compaction requests and the pre-send estimate for the rest of
  // the turn. Measured on every response, not only on overflows: when the
  // configured window is smaller than the backend's, nothing ever overflows.
  let measuredCharsPerToken: number | undefined
  // Characters of the request last sent: messages, system prompt and tools.
  let lastRequestChars: number | undefined
  // Characters of the last assembled system prompt and tool definitions. The
  // summary request is sized before it is assembled: this fixed part weighs
  // more on it than on the larger request the density was measured on, and
  // leaving it out made it come out larger than its target.
  let lastOverheadChars = 0
  let returnValueNudgeCount = 0

  /** Context size the auto-compaction is decided on, its window and threshold. */
  const compactionMeasure = () => {
    const contextState = sessionManager.getContextState(sessionId)
    return {
      tokens: config.subAgentMetadata
        ? (sessionManager.getSubAgentContextTokens?.(config.subAgentMetadata.subAgentId) ?? 0)
        : contextState.currentTokens,
      window: config.subAgentMetadata
        ? sessionManager.getCurrentModelContext(sessionId, config.mode)
        : contextState.maxTokens,
      threshold:
        sessionManager.getModelCompactionThreshold(sessionId, config.mode) ??
        getRuntimeConfig().context.compactionThreshold,
    }
  }

  for (;;) {
    if (signal?.aborted) throw new Error('Aborted')

    // Warmup mode: just assemble the request to populate the cache, then fire a
    // minimal LLM call to prefill the KV cache. No events, no messages, no tools.
    if (config.warmup) {
      const session = sessionManager.requireSession(sessionId)
      const runtimeConfig = getRuntimeConfig()
      const configDir = getGlobalConfigDir(runtimeConfig.mode ?? 'production')
      const skills = await getEnabledSkillMetadata(configDir, sessionManager.getProjectWorkdir(sessionId))
      const { content: instructionContent } = await getAllInstructions(session.workdir, session.projectId)
      const toolRegistry = config.getToolRegistry()

      const assembledRequest = await config.assembleRequest({
        workdir: session.workdir,
        messages: [],
        injectedFiles: [],
        promptTools: toolRegistry.definitions,
        toolChoice: 'none',
        ...(instructionContent ? { customInstructions: instructionContent } : {}),
        ...(skills.length > 0 ? { skills } : {}),
      })

      const modelSettings = sessionManager.getCurrentModelSettings(sessionId, config.mode)

      await resolveClient().complete({
        sessionId,
        messages: [{ role: 'system', content: assembledRequest.systemPrompt }],
        tools: assembledRequest.tools,
        maxTokens: 1,
        temperature: 0,
        ...(modelSettings ? { modelSettings } : {}),
      })

      return {}
    }

    // Pause gate: block before the next LLM request if the user requested a
    // pause. The current (in-flight) request is never aborted — the pause only
    // takes effect here, at the request boundary.
    const pauseOutcome = await sessionManager.enterPauseGate(sessionId, signal)
    if (pauseOutcome === 'aborted') {
      throw new Error('Aborted')
    }

    const session = sessionManager.requireSession(sessionId)

    // Inject kickoff prompt (e.g., builder kickoff) on first iteration
    if (retryLimiter.count() === 0) {
      await config.injectKickoff?.()
    }

    const { content: instructionContent, files } = await getAllInstructions(session.workdir, session.projectId)
    if (signal?.aborted) throw new Error('Aborted')

    const injectedFiles: InjectedFile[] = files.map((f) => ({
      path: f.path,
      content: f.content ?? '',
      source: f.source,
    }))

    const toolRegistry = config.getToolRegistry()
    const currentWindowMessageOptions = getCurrentWindowMessageOptions(sessionId)

    // The threshold is checked after each response, on the measured prompt.
    // Tool results added since can push the next request over it (or over the
    // window: a big read_file): check again before sending.
    if (!compacting && pendingToolResultTokens > 0) {
      const measure = compactionMeasure()
      const pendingTokens = measuredCharsPerToken
        ? Math.ceil((pendingToolResultTokens * CHARS_PER_TOKEN) / measuredCharsPerToken)
        : pendingToolResultTokens
      if (shouldCompact(measure.tokens + pendingTokens, measure.window, measure.threshold)) {
        appendCompactionPrompt(sessionId, append, config.subAgentMetadata)
        compacting = true
      }
    }

    // ---- LLM round with automatic failure retry ----
    // Case 1: a request fails before any content → retry the same request with
    // exponential backoff; nothing is written (message.start deferred).
    // Case 2: the stream fails mid-flight → keep the partial content, finalize
    // its bubble, append ONE visible continuation prompt, then retry against
    // the enriched context. History only ever grows — no tombstones.
    const retryPolicy: LLMRetryPolicy = { ...DEFAULT_LLM_RETRY_POLICY, ...config.llmRetryPolicy }
    const runtimeConfig = getRuntimeConfig()
    let requestFailures = 0
    let requestFirstFailureAt = 0
    let continuationAppended = false
    let previousContextTokens: number
    let result!: import('./stream-pure.js').PureStreamResult
    let assistantMsgId: string
    let assistantMessageStarted = false

    for (;;) {
      // Resolve fresh per attempt: resolveClient() supports provider switches
      // mid-turn (retries/truncation use a re-resolved client). The same client
      // backs the profile default (used by the maxTokens fallback sites below)
      // and the actual LLM call.
      const attemptClient = resolveClient()
      const profileDefaultMaxTokens = getModelProfile(attemptClient.getModel()).defaultMaxTokens

      let requestMessages = await config.getConversationMessages()

      // A compaction request runs on a nearly full context: when it would not
      // leave room for the summary, shorten tool results (start and end kept,
      // see fitToolResults for the order), rather than let it overflow too.
      if (compacting) {
        const window = sessionManager.getCurrentModelContext(sessionId, config.mode)
        const charsPerToken = measuredCharsPerToken ?? CHARS_PER_TOKEN
        const estimate = measuredCharsPerToken
          ? Math.ceil((messageChars(requestMessages) + lastOverheadChars) / charsPerToken)
          : compactionMeasure().tokens + pendingToolResultTokens
        const excess = estimate - (window - COMPACTION_SUMMARY_TOKENS - OUTPUT_RESERVE_TOKENS)
        if (excess > 0) {
          // fitToolResults counts CHARS_PER_TOKEN characters per token.
          const fitted = fitToolResults(requestMessages, Math.ceil((excess * charsPerToken) / CHARS_PER_TOKEN))
          requestMessages = fitted.messages
          logger.info('Shortened tool results to fit the compaction request', {
            sessionId,
            excessTokens: excess,
            savedTokens: fitted.savedTokens,
          })
        }
      }

      // The format-retry continuation is appended once per round (not on
      // LLM-error retries) — its persisted copy feeds later context rebuilds.
      if (requestFailures === 0 && retryLimiter.count() > 0) {
        const continueMsgId = crypto.randomUUID()
        const continueContent = lastPatternMatch
          ? `Your previous response was interrupted because it matched pattern "${lastPatternMatch.pattern}" in ${lastPatternMatch.field}.\nMatched content:\n${lastPatternMatch.matchedContent}\n\n${CONTINUE_PROMPT}`
          : CONTINUE_PROMPT
        append(
          createMessageStartEvent(continueMsgId, 'user', continueContent, {
            ...(currentWindowMessageOptions ?? {}),
            isSystemGenerated: true,
            messageKind: 'correction',
          }),
        )
        append({ type: 'message.done', data: { messageId: continueMsgId } })
        requestMessages.push({ role: 'user', content: continueContent, source: 'history' })
      }

      const configDir = getGlobalConfigDir(runtimeConfig.mode ?? 'production')
      const skills = await getEnabledSkillMetadata(configDir, sessionManager.getProjectWorkdir(sessionId))
      if (signal?.aborted) throw new Error('Aborted')

      const assembledRequest = await config.assembleRequest({
        workdir: session.workdir,
        messages: requestMessages,
        injectedFiles,
        promptTools: toolRegistry.definitions,
        toolChoice: 'auto',
        ...(instructionContent ? { customInstructions: instructionContent } : {}),
        ...(skills.length > 0 ? { skills } : {}),
      })
      lastOverheadChars = assembledRequest.systemPrompt.length + JSON.stringify(assembledRequest.tools ?? []).length
      lastRequestChars = messageChars(requestMessages) + lastOverheadChars

      assistantMsgId = crypto.randomUUID()
      // The assistant message.start is DEFERRED until the first streamed event:
      // a request that fails before any content (case 1) leaves nothing behind.
      assistantMessageStarted = false
      const ensureAssistantMessage = () => {
        if (assistantMessageStarted) return
        assistantMessageStarted = true
        append(
          createMessageStartEvent(assistantMsgId, 'assistant', undefined, {
            ...(currentWindowMessageOptions ?? {}),
            ...subAgentTags(),
          }),
        )
      }

      const contextState = sessionManager.getContextState(sessionId)
      // Sub-agents run in a fresh scoped context: their output budget must be
      // clamped against their own context usage, never the parent session's
      // (a big parent session would otherwise leave the sub-agent only the
      // 256-token safety floor — the root cause of truncated sub-agent plans).
      const subAgentContextTokens = config.subAgentMetadata
        ? (sessionManager.getSubAgentContextTokens?.(config.subAgentMetadata.subAgentId) ?? 0)
        : undefined
      previousContextTokens = subAgentContextTokens ?? contextState.currentTokens

      const contextWindow = sessionManager.getCurrentModelContext(sessionId, config.mode)
      const availableForOutput = Math.max(
        256,
        contextWindow - previousContextTokens - pendingToolResultTokens - OUTPUT_RESERVE_TOKENS,
      )

      let modelSettings =
        config.modelSettings ??
        (compacting && compactionRetryWithoutThinking
          ? sessionManager.getCurrentModelSettings(sessionId, config.mode, { thinking: false })
          : sessionManager.getCurrentModelSettings(sessionId, config.mode))
      if (modelSettings && currentMaxTokensOverride !== undefined) {
        modelSettings = { ...modelSettings, maxTokens: currentMaxTokensOverride }
      }

      if (modelSettings) {
        const requestedMaxTokens = modelSettings.maxTokens ?? profileDefaultMaxTokens
        modelSettings = { ...modelSettings, maxTokens: Math.min(requestedMaxTokens, availableForOutput) }
      }

      // Build set of sub-agent IDs so streamLLMPure can show the correct
      // tool name in preparing events instead of hallucinated aliases.
      const allAgents = await loadAllAgentsDefault(sessionManager.getProjectWorkdir(sessionId))
      const subAgentAliases = new Set(getSubAgents(allAgents).map((a) => a.metadata.id))

      const transformResult = await applyPluginMessageTransforms(assembledRequest.messages, {
        sessionId,
        ...(session.projectId ? { projectId: session.projectId } : {}),
        workdir: sessionManager.getEffectiveWorkdir(sessionId),
        model: attemptClient.getModel(),
        systemPrompt: assembledRequest.systemPrompt,
        ...(config.mode ? { mode: config.mode } : {}),
        ...(signal ? { signal } : {}),
      })

      // Resolve retry patterns fresh each round so a mid-turn edit (deleting
      // or toggling a pattern, changing the cap) takes effect on the next
      // LLM round instead of on the next turn.
      const freshRetry = config.retryPatternsProvider ? await config.retryPatternsProvider() : undefined
      if (freshRetry) {
        retryLimiter.setMaxRetries(freshRetry.maxRetriesPerTurn)
      }
      const roundRetryPatterns = freshRetry ? freshRetry.retryPatterns : config.retryPatterns

      const streamGen = streamLLMPure({
        messageId: assistantMsgId,
        systemPrompt: transformResult.systemPrompt,
        llmClient: attemptClient,
        sessionId,
        messages: transformResult.messages,
        tools: assembledRequest.tools,
        toolChoice: 'auto',
        signal,
        subAgentAliases,
        ...(roundRetryPatterns ? { retryPatterns: roundRetryPatterns } : {}),
        ...(modelSettings && { modelSettings }),
        preflight: (path) =>
          preflightPathTool(path, {
            workdir: sessionManager.getEffectiveWorkdir(sessionId),
            readFiles: sessionManager.getReadFiles(sessionId),
          }),
      })

      // Per-turn cache of file contents read to build live edit context for
      // streaming edit_file preparing events. The tracker dedupes recomputes
      // and WebSocket payloads across the many partial chunks of a call.
      const editFileContentCache = new Map<string, string>()
      const liveEditTracker = new LiveEditContextTracker()

      const attemptResult = await consumeStreamGenerator(streamGen, async (event) => {
        ensureAssistantMessage()
        // While the LLM streams an edit_file call, enrich its preparing events
        // with a live edit context (surrounding lines) computed from the file —
        // the same shape the final tool result carries. The file content is
        // read once per path for the whole turn, and the context is recomputed
        // only when the parsed edit spec changes.
        if (event.type === 'tool.preparing' && event.data.name === 'edit_file') {
          const editContext = await liveEditTracker.next(
            event.data.index,
            event.data.arguments,
            session.workdir,
            editFileContentCache,
          )
          append(editContext && editContext.length > 0 ? { ...event, data: { ...event.data, editContext } } : event)
          return
        }
        append(event)
      })

      if (!attemptResult.error) {
        ensureAssistantMessage()
        result = attemptResult
        // A density above the estimate means fewer tokens than characters / 4
        // were reported (e.g. only the uncached part): not a measure, ignored.
        if (lastRequestChars !== undefined && lastRequestChars >= DENSITY_MIN_CHARS) {
          const charsPerToken = lastRequestChars / Math.max(1, attemptResult.usage.promptTokens)
          if (charsPerToken >= 1 && charsPerToken <= CHARS_PER_TOKEN) measuredCharsPerToken = charsPerToken
        }
        // The overflow retries are a budget per run of failures, not per turn:
        // a long turn can compact several times.
        contextRetryCount = 0
        const usage = attemptResult.usage
        emitPluginHook('llm.completed', {
          sessionId,
          data: {
            providerId:
              config.providerManager?.getActiveProviderId?.() ?? config.providerManager?.getActiveProvider?.()?.id,
            model: attemptClient.getModel(),
            finishReason: attemptResult.finishReason,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            ...(usage.cachedPromptTokens !== undefined && {
              cachedPromptTokens: usage.cachedPromptTokens,
            }),
            ...(usage.cacheWriteTokens !== undefined && {
              cacheWriteTokens: usage.cacheWriteTokens,
            }),
            ...(usage.cacheSource !== undefined && { cacheSource: usage.cacheSource }),
            toolCalls: attemptResult.toolCalls.length,
          },
        })
        break
      }

      // ---- LLM failure ----
      // Case 2: content was streamed → finalize the partial bubble and append
      // ONE visible continuation prompt; the retry rebuilds context from the
      // store (which already includes the partial + continuation).
      if (assistantMessageStarted && !continuationAppended) {
        append(createMessageDoneEvent(assistantMsgId, { partial: true }))
        onMessage?.(createChatMessageUpdatedMessage(assistantMsgId, { isStreaming: false, partial: true }))
        const continueMsgId = crypto.randomUUID()
        append(
          createMessageStartEvent(continueMsgId, 'user', CONTINUE_AFTER_STREAM_ERROR_PROMPT, {
            ...(currentWindowMessageOptions ?? {}),
            isSystemGenerated: true,
            messageKind: 'correction',
          }),
        )
        append({ type: 'message.done', data: { messageId: continueMsgId } })
        continuationAppended = true
      }

      if (signal?.aborted) throw new Error('Aborted')

      // The prompt alone exceeds the window: a smaller maxTokens cannot help.
      // Compact (the summary request is shortened to fit, see above); if the
      // summary request itself overflowed, shorten it by what was measured.
      const overflow = promptOverflow(attemptResult.error)
      const measure = compactionMeasure()
      if (overflow && measure.threshold > 0 && contextRetryCount < MAX_CONTEXT_LENGTH_RETRIES) {
        contextRetryCount += 1
        // Always set: every attempt records its size before it is sent.
        if (lastRequestChars !== undefined) {
          // Messages lighter than our estimate (a heavy system prompt) keep the
          // estimate; an implausible value (nearly empty request) is ignored.
          const charsPerToken = lastRequestChars / overflow.promptTokens
          if (charsPerToken >= 1) measuredCharsPerToken = Math.min(charsPerToken, CHARS_PER_TOKEN)
        }
        if (!compacting) {
          appendCompactionPrompt(sessionId, append, config.subAgentMetadata)
          compacting = true
        }
        logger.warn('Request exceeds the context window, compacting', {
          sessionId,
          promptTokens: overflow.promptTokens,
          windowTokens: overflow.windowTokens,
        })
        continue
      }

      // Context overflow: the prompt (including tool results) plus the requested
      // maxTokens exceeds the model's window. The error is deterministic, so
      // retry immediately with a reduced maxTokens instead of waiting out backoff.
      if (isContextLengthError(attemptResult.error) && contextRetryCount < MAX_CONTEXT_LENGTH_RETRIES) {
        contextRetryCount += 1
        const currentMax = modelSettings?.maxTokens ?? currentMaxTokensOverride ?? profileDefaultMaxTokens
        currentMaxTokensOverride = Math.max(256, Math.floor(currentMax / 2))
        continue
      }

      // Backoff decision — the shared LLMRetryPolicy (same defaults as workflows).
      requestFailures += 1
      if (requestFirstFailureAt === 0) {
        requestFirstFailureAt = Date.now()
      }
      const decision = evaluateLLMRetry(requestFailures, requestFirstFailureAt, Date.now(), retryPolicy)
      if (!decision.retry) {
        if (!config.subAgentMetadata) {
          recordLLMFailure(sessionId)
          config.onMessage?.(createChatLLMRetryFailedMessage(attemptResult.error, requestFailures))
        }
        return { failed: { error: attemptResult.error } }
      }
      if (!config.subAgentMetadata) {
        config.onMessage?.(createChatLLMRetryMessage(decision.attempt, decision.delayMs, attemptResult.error))
      }
      const waitResult = await sleepThroughRetryBackoff(decision.delayMs, sessionId, signal)
      if (waitResult === 'aborted') throw new Error('Aborted')
      // Loop: rebuild the request — case 1 uses the same context, case 2 picks
      // up the persisted partial + continuation.
    }

    // Success — clear any recorded failure so a later chat.retry is rejected.
    if (!config.subAgentMetadata) {
      clearLLMFailure(sessionId)
    }

    // Check if a retry pattern matched mid-stream
    if (result.patternMatch) {
      if (!retryLimiter.canRetry()) {
        append({
          type: 'chat.error',
          data: {
            error: serverT(
              {
                en: 'Auto-retry limit exceeded after {{count}} retries',
                fr: 'Limite de relance automatique dépassée après {{count}} tentatives',
              },
              { count: retryLimiter.maxRetries() },
            ),
            recoverable: false,
          },
        })
        append(createChatDoneEvent(assistantMsgId, 'error', undefined, agentType))
        throw new Error('Auto-retry limit exceeded')
      }
      retryLimiter.increment()
      lastPatternMatch = {
        pattern: result.patternMatch.pattern,
        field: result.patternMatch.field,
        matchedContent: result.patternMatch.matchedContent,
      }

      // Emit pattern.retry event
      append({
        type: 'pattern.retry',
        data: {
          messageId: assistantMsgId,
          pattern: result.patternMatch.pattern,
          field: result.patternMatch.field,
          attempt: retryLimiter.count(),
          maxAttempts: retryLimiter.maxRetries(),
          matchedContent: result.patternMatch.matchedContent,
        },
      })

      // Emit system message showing what matched
      const matchMsgId = crypto.randomUUID()
      const matchMessage = `Pattern "${result.patternMatch.pattern}" matched — auto-retry #${retryLimiter.count()}`
      append(
        createMessageStartEvent(matchMsgId, 'user', matchMessage, {
          ...(currentWindowMessageOptions ?? {}),
          isSystemGenerated: true,
          messageKind: 'correction',
        }),
      )
      append({ type: 'message.done', data: { messageId: matchMsgId } })

      continue
    }

    if (result.aborted) {
      // Only finalize if the assistant message was actually started (a turn
      // aborted during the backoff wait never created one).
      if (assistantMessageStarted) {
        emitPartialDoneEvents(sessionId, assistantMsgId, statsIdentity, mode, turnMetrics, append, agentType)
      }
      throw new Error('Aborted')
    }

    // The retry loop above guarantees `result` has no error — record usage and
    // update the context size.
    turnMetrics.addLLMCall(
      result.timing,
      result.usage.promptTokens,
      result.usage.completionTokens,
      previousContextTokens,
      result.modelParams,
      result.usage,
    )
    // Accumulate wall-clock thinking time across LLM attempts in this turn.
    if (result.thinkingDurationMs !== undefined) {
      turnMetrics.addThinkingTime(result.thinkingDurationMs)
    }
    // Stream the running turn totals to the client so the sidebar can build
    // dynamically as each LLM call completes. Sub-agent turns run inside the
    // parent turn — their stats would clobber the parent's live numbers, so
    // only top-level turns broadcast.
    if (!config.subAgentMetadata) {
      emitLiveTurnStats(turnMetrics, statsIdentity, mode, config.onMessage)
    }
    sessionManager.setCurrentContextSize(
      sessionId,
      result.usage.promptTokens,
      result.usage.completionTokens,
      config.subAgentMetadata?.subAgentId,
    )
    pendingToolResultTokens = 0
    currentMaxTokensOverride = undefined

    // Check compaction threshold with fresh promptTokens from LLM.
    // When exceeded, append compaction prompt and let the next iteration
    // handle summarization — same agent, same loop, no nested call.
    // A response with tool calls is not interrupted: its calls run first and
    // the pre-send check compacts before the next request (their results are
    // pending then). Compacting here dropped those calls: the model's work
    // (a write of what it had just read) was lost and redone after the summary.
    if (!compacting && result.toolCalls.length === 0) {
      const measure = compactionMeasure()
      if (shouldCompact(measure.tokens, measure.window, measure.threshold)) {
        // Close the response first: it stayed "streaming" for good otherwise,
        // live and after a reload.
        if (assistantMessageStarted) {
          append(
            createMessageDoneEvent(assistantMsgId, {
              segments: result.segments,
              stats: turnMetrics.buildStats(statsIdentity, mode),
            }),
          )
          onMessage?.(createChatMessageUpdatedMessage(assistantMsgId, { isStreaming: false }))
        }
        appendCompactionPrompt(sessionId, append, config.subAgentMetadata)
        compacting = true
        continue
      }
    }

    if (!compacting && result.finishReason === 'length' && result.toolCalls.length === 0) {
      if (truncationRetryCount < MAX_TRUNCATION_RETRIES) {
        truncationRetryCount += 1
        const currentMaxTokens =
          result.modelParams?.maxTokens ?? getModelProfile(resolveClient().getModel()).defaultMaxTokens
        const promptTokens = result.usage.promptTokens
        const contextWindow = sessionManager.getCurrentModelContext(sessionId, config.mode)
        const newMaxTokens = Math.min(
          Math.floor(currentMaxTokens * 1.5),
          Math.max(256, contextWindow - promptTokens - OUTPUT_RESERVE_TOKENS),
        )
        currentMaxTokensOverride = newMaxTokens
        // Finalize the truncated assistant message so the frontend properly closes it
        const interimStats = turnMetrics.buildStats(statsIdentity, mode)
        append(
          createMessageDoneEvent(assistantMsgId, {
            segments: result.segments,
            stats: interimStats,
          }),
        )
        // Tell the frontend to fold the streaming message back into messages
        onMessage?.(createChatMessageUpdatedMessage(assistantMsgId, { isStreaming: false }))
        // Emit continue message to event store so getConversationMessages picks it up next iteration
        // We don't broadcast it via WebSocket, so the frontend won't see it
        const continueMsgId = crypto.randomUUID()
        append(
          createMessageStartEvent(
            continueMsgId,
            'user',
            'Continue your previous response exactly where you left off.',
            {
              ...(currentWindowMessageOptions ?? {}),
              isSystemGenerated: true,
            },
          ),
        )
        append({ type: 'message.done', data: { messageId: continueMsgId } })
        continue
      } else {
        // Exhausted retries, emit truncated
        const stats = turnMetrics.buildStats(statsIdentity, mode)
        append(
          createMessageDoneEvent(assistantMsgId, {
            segments: result.segments,
            stats,
            partial: true,
          }),
        )
        append(createChatDoneEvent(assistantMsgId, 'truncated', stats, agentType))
        break
      }
    }

    if (result.toolCalls.length > 0) {
      if (compacting) {
        // Close the attempt first: it stayed "streaming" for good otherwise.
        if (assistantMessageStarted) {
          append(createMessageDoneEvent(assistantMsgId, { segments: result.segments, partial: true }))
          onMessage?.(createChatMessageUpdatedMessage(assistantMsgId, { isStreaming: false, partial: true }))
        }
        const rejectionMsgId = crypto.randomUUID()
        append(
          createMessageStartEvent(
            rejectionMsgId,
            'user',
            `Tool calls are not possible at this stage. STOP and produce a summary for compaction purposes NOW:

${COMPACTION_PROMPT}`,
            {
              ...(currentWindowMessageOptions ?? {}),
              isSystemGenerated: true,
              messageKind: 'correction',
              ...subAgentTags(),
            },
          ),
        )
        append({ type: 'message.done', data: { messageId: rejectionMsgId } })
        retryLimiter.reset()
        continue
      }

      append(
        createMessageDoneEvent(assistantMsgId, {
          segments: result.segments,
        }),
      )

      try {
        const batchContext: ToolBatchContext = {
          toolRegistry,
          sessionManager,
          sessionId,
          workdir: sessionManager.getEffectiveWorkdir(sessionId),
          turnMetrics,
          signal,
          onMessage,
          llmClient: resolveClient(),
          statsIdentity,
          onToolExecuted: config.onToolExecuted,
        }
        if (session.dangerLevel) {
          batchContext.dangerLevel = session.dangerLevel
        }
        // Fresh per iteration: `session` was re-required from the DB above, so a
        // mid-turn toggle of night mode takes effect on this very batch.
        if (session.nightMode) {
          batchContext.nightMode = true
        }
        if (config.subAgentMetadata) {
          batchContext.isSubAgent = true
        }
        if (config.providerManager) {
          batchContext.providerManager = config.providerManager
        }
        batchContext.agentTimeout = getRuntimeConfig().agent.toolTimeout
        batchContext.allowParallelSubAgents = getSetting(SETTINGS_KEYS.AGENT_ALLOW_PARALLEL_SUB_AGENTS) === 'true'
        const batchResult = await executeTools(assistantMsgId, result.toolCalls, batchContext, append)
        pendingToolResultTokens = estimateToolResultTokens(batchResult.toolMessages)
        if (batchResult.stepDoneCalled) {
          emitDoneAndBreak(
            assistantMsgId,
            result.segments,
            statsIdentity,
            mode,
            turnMetrics,
            append,
            onMessage,
            'step_done',
            agentType,
          )
          break
        }
        if (batchResult.returnValueContent) {
          returnValueContent = batchResult.returnValueContent
          returnValueResult = batchResult.returnValueResult
          if (config.breakOnReturnValue) {
            emitDoneAndBreak(
              assistantMsgId,
              result.segments,
              statsIdentity,
              mode,
              turnMetrics,
              append,
              onMessage,
              'complete',
              agentType,
            )
            break
          }
        }
        if (batchResult.returnValueResult) {
          returnValueResult = batchResult.returnValueResult
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'Aborted') {
          emitPartialDoneEvents(sessionId, assistantMsgId, statsIdentity, mode, turnMetrics, append, agentType)
          throw error
        }
        throw error
      }

      if (signal?.aborted) {
        emitPartialDoneEvents(sessionId, assistantMsgId, statsIdentity, mode, turnMetrics, append, agentType)
        throw new Error('Aborted')
      }

      if (!config.subAgentMetadata) {
        void drainQueue(sessionManager, sessionId, append, onMessage)
      }

      retryLimiter.reset()
      continue
    }

    if (compacting) {
      // The summary request runs with the context nearly full, so its output
      // budget can be tiny: a thinking model may spend all of it reasoning and
      // return no answer, or a cut one. That reasoning must not become the
      // summary (the next window would start from it, and the next compaction
      // copy it). Retry once without thinking; on that retry, a complete
      // reasoning-only answer is accepted (setups that route the whole answer
      // through the reasoning field), a cut one is not.
      const answer = result.content?.trim() ?? ''
      const reasoning = result.thinkingContent?.trim() ?? ''
      const cut = result.finishReason === 'length'
      const isRetry = compactionRetryWithoutThinking
      const summary = answer && !(cut && !isRetry) ? answer : isRetry && !cut ? reasoning : ''
      if (!summary && !isRetry && (answer || reasoning)) {
        logger.warn('Compaction produced no usable summary, retrying without thinking', {
          sessionId,
          finishReason: result.finishReason,
          answerChars: answer.length,
          reasoningChars: reasoning.length,
        })
        if (assistantMessageStarted) {
          append(createMessageDoneEvent(assistantMsgId, { partial: true }))
          onMessage?.(createChatMessageUpdatedMessage(assistantMsgId, { isStreaming: false, partial: true }))
        }
        const retryMsgId = crypto.randomUUID()
        append(
          createMessageStartEvent(
            retryMsgId,
            'user',
            'Your previous reply contained no summary. Reply now with the summary only, as instructed above, without deliberating first.',
            {
              ...(currentWindowMessageOptions ?? {}),
              isSystemGenerated: true,
              messageKind: 'correction',
              ...subAgentTags(),
            },
          ),
        )
        append({ type: 'message.done', data: { messageId: retryMsgId } })
        compactionRetryWithoutThinking = true
        continue
      }
      compactionRetryWithoutThinking = false
      if (!summary) {
        // Close the attempt first: it stayed "streaming" for good otherwise.
        if (assistantMessageStarted) {
          append(createMessageDoneEvent(assistantMsgId, { partial: true }))
          onMessage?.(createChatMessageUpdatedMessage(assistantMsgId, { isStreaming: false, partial: true }))
        }
        append({
          type: 'chat.error',
          data: {
            error: serverT({
              en: 'Compaction produced empty summary, continuing with full context',
              fr: 'La compaction a produit un résumé vide, poursuite avec le contexte complet',
            }),
            recoverable: true,
          },
        })
        logger.warn('Compaction produced empty summary, continuing', { sessionId })
        compacting = false
        if (config.initialCompacting) break
        continue
      }

      // The new context window starts fresh — apply the current system prompt
      // + tools so they are canonical and never stale there. Best-effort: a
      // rebuild failure must not break the compaction itself. Top-level only:
      // a sub-agent compaction must never rebuild the parent's cached context
      // or reinject the parent's reminder.
      if (!config.subAgentMetadata) {
        try {
          await config.rebuildCachedContext?.()
        } catch (error) {
          logger.error('Failed to rebuild cached context after compaction', {
            sessionId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      const closedWindowId = getCurrentContextWindowId(sessionId) ?? ''
      // Sub-agent compaction is scoped: it stays in the current window (the
      // parent's window must not rotate), so no fresh window id is minted.
      const newWindowId = config.subAgentMetadata ? closedWindowId : crypto.randomUUID()
      const tokenCountAtClose = result.usage.promptTokens

      append({
        type: 'context.compacted',
        data: {
          closedWindowId,
          newWindowId,
          beforeTokens: tokenCountAtClose,
          afterTokens: 0,
          summary,
          ...subAgentTags(),
        },
      })

      append({
        type: 'message.start',
        data: {
          messageId: assistantMsgId,
          role: 'assistant',
          content: summary,
          contextWindowId: newWindowId,
          isCompactionSummary: true,
          ...subAgentTags(),
        },
      })
      append(createMessageDoneEvent(assistantMsgId, { stats: turnMetrics.buildStats(statsIdentity, mode) }))
      append(createChatDoneEvent(assistantMsgId, 'complete', undefined, agentType))

      // Sub-agent compaction: emit a fresh-context marker so the chatfeed
      // shows a new window boundary — mirrors the reinjected agent reminder
      // the top-level agent gets after compaction. Purely visual (excluded
      // from LLM context), scoped to the sub-agent.
      if (config.subAgentMetadata) {
        const freshMsgId = crypto.randomUUID()
        append(
          createMessageStartEvent(
            freshMsgId,
            'user',
            `Fresh Context - ${config.subAgentMetadata.subAgentName ?? config.subAgentMetadata.subAgentType} Sub-Agent`,
            {
              ...(currentWindowMessageOptions ?? {}),
              isSystemGenerated: true,
              messageKind: 'context-reset',
              ...subAgentTags(),
            },
          ),
        )
        append({ type: 'message.done', data: { messageId: freshMsgId } })
      }

      // Reinject the agent reminder into the new window (top-level only)
      if (!config.subAgentMetadata) {
        config.injectAgentReminder?.()
      }
      compacting = false

      // Manual compaction (initialCompacting) is a one-shot operation — break after done.
      // Auto-compaction continues the loop for subsequent user messages.
      if (config.initialCompacting) break
      continue
    }

    // If sub-agent finished without calling return_value, nudge and retry
    if (config.requireReturnValue && !returnValueContent) {
      const maxNudges = config.maxReturnValueNudges ?? 10
      if (returnValueNudgeCount < maxNudges) {
        returnValueNudgeCount++
        const nudgeMsgId = crypto.randomUUID()
        append(
          createMessageStartEvent(
            nudgeMsgId,
            'user',
            'You must call return_value with a summary of your findings before finishing. Call return_value now.',
            {
              ...(currentWindowMessageOptions ?? {}),
              isSystemGenerated: true,
              messageKind: 'correction',
              ...subAgentTags(),
            },
          ),
        )
        append({ type: 'message.done', data: { messageId: nudgeMsgId } })
        continue
      }
    }

    const stats = turnMetrics.buildStats(statsIdentity, mode)
    append(
      createMessageDoneEvent(assistantMsgId, {
        segments: result.segments,
        stats,
      }),
    )
    append(createChatDoneEvent(assistantMsgId, 'complete', stats, agentType))

    break
  }

  return {
    ...(returnValueContent ? { returnValueContent } : {}),
    ...(returnValueResult ? { returnValueResult } : {}),
  }
}

export { CONTINUE_PROMPT, CONTINUE_AFTER_STREAM_ERROR_PROMPT } from './prompts.js'
