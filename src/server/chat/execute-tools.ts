import type { ToolCall, ToolResult } from '../../shared/types.js'
import type { SessionManager } from '../session/index.js'
import type { ToolContext, ToolRegistry } from '../tools/types.js'
import type { TurnMetrics } from './stream-pure.js'
import type { TurnEvent } from '../events/types.js'
import type { RequestContextMessage } from './request-context.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { StatsIdentity } from '../../shared/types.js'
import type { ProviderManager } from '../provider-manager.js'
import type { ServerMessage } from '../../shared/protocol.js'
import type { DangerLevel } from '../../shared/types.js'
import { createToolProgressHandler } from './tool-streaming.js'
import { createToolCallEvent, createToolResultEvent, createChatDoneEvent } from './stream-pure.js'
import { PathAccessDeniedError, AskUserInterrupt } from '../tools/index.js'
import { loadAllAgentsDefault, findAgentById } from '../agents/registry.js'
import { serverT } from '../i18n.js'
import { logger } from '../utils/logger.js'
import { sanitizeUtf8 } from '../utils/utf8.js'
import stripAnsi from 'strip-ansi'

export interface ToolBatchContext {
  toolRegistry: ToolRegistry
  sessionManager: SessionManager
  sessionId: string
  workdir: string
  dangerLevel?: DangerLevel
  isSubAgent?: boolean
  turnMetrics: TurnMetrics
  signal?: AbortSignal | undefined
  onMessage?: ((msg: ServerMessage) => void) | undefined
  llmClient?: LLMClientWithModel | undefined
  statsIdentity?: StatsIdentity | undefined
  providerManager?: ProviderManager | undefined
  onToolExecuted?: ((toolCall: ToolCall, result: ToolResult) => void) | undefined
  agentTimeout?: number
}

export interface ToolBatchResult {
  toolMessages: RequestContextMessage[]
  criteriaChanged: boolean
  returnValueContent?: string | undefined
  returnValueResult?: string | undefined
  stepDoneCalled?: boolean | undefined
}

function interruptedError(): string {
  return serverT({
    en: 'Tool execution was interrupted by user',
    fr: 'L’exécution de l’outil a été interrompue par l’utilisateur',
  })
}

/**
 * Extract a prompt string from tool call arguments, trying common keys.
 */
function extractSubAgentPrompt(args: Record<string, unknown>): string {
  return (args['prompt'] as string) || (args['query'] as string) || (args['task'] as string) || ''
}

/**
 * Transform sub-agent alias tool calls in place.
 * When a tool call name matches a registered sub-agent ID (e.g. "explorer"),
 * mutates it to call_sub_agent with the original name as subAgentType.
 * Must happen before event emission so the feed displays the correct tool name.
 */
export async function transformSubAgentAliases(
  toolCalls: ToolCall[],
  toolRegistry: ToolRegistry,
  projectDir?: string,
): Promise<void> {
  const hasCallSubAgent = toolRegistry.tools.some((t) => t.name === 'call_sub_agent')
  if (!hasCallSubAgent) return

  const agents = await loadAllAgentsDefault(projectDir)

  for (const tc of toolCalls) {
    const agentDef = findAgentById(tc.name, agents)
    if (!agentDef?.metadata.subagent) continue

    const prompt = extractSubAgentPrompt(tc.arguments)
    tc.name = 'call_sub_agent'
    tc.arguments = { subAgentType: agentDef.metadata.id, prompt }
  }
}

function createInterruptedResult(startTime?: number): ToolResult {
  return {
    success: false,
    error: interruptedError(),
    durationMs: startTime ? Date.now() - startTime : 0,
    truncated: false,
  }
}

export async function executeTools(
  assistantMsgId: string,
  toolCalls: ToolCall[],
  ctx: ToolBatchContext,
  append: (event: TurnEvent) => void,
): Promise<ToolBatchResult> {
  const toolMessages: RequestContextMessage[] = []
  let returnValueContent: string | undefined
  let returnValueResult: string | undefined
  let stepDoneCalled = false

  if (ctx.signal?.aborted) {
    throw new Error('Aborted')
  }

  // Transform sub-agent aliases in place before emitting events,
  // so the feed displays the correct tool name (call_sub_agent)
  // instead of the hallucinated name (e.g. "explorer").
  await transformSubAgentAliases(toolCalls, ctx.toolRegistry, ctx.sessionManager.getProjectWorkdir(ctx.sessionId))

  for (const toolCall of toolCalls) {
    append(createToolCallEvent(assistantMsgId, toolCall))
  }

  const handleToolExecutionError = async (
    error: unknown,
    _sessionId: string,
    startTime: number,
  ): Promise<ToolResult> => {
    if (error instanceof PathAccessDeniedError) {
      return {
        success: false,
        error: serverT(
          {
            en: 'User denied access to {{paths}}. If you need this file, explain why and ask for permission.',
            fr: 'Accès refusé par l’utilisateur : {{paths}}. Si vous avez besoin de ce fichier, expliquez pourquoi et demandez l’autorisation.',
          },
          { paths: error.paths.join(', ') },
        ),
        durationMs: Date.now() - startTime,
        truncated: false,
      }
    } else if (error instanceof AskUserInterrupt) {
      append({
        type: 'chat.ask_user',
        data: { callId: error.callId, question: error.question, type: error.type, options: error.options },
      })

      // Signal to the client that the agent is waiting for user input
      append(createChatDoneEvent(assistantMsgId, 'waiting_for_user'))

      // Arm the auto-answer countdown after the question event was appended,
      // so clients always receive chat.ask_user before its countdown.
      const { armAutoAnswer, awaitAnswer, consumeAutoAnswered } = await import('../tools/ask.js')
      armAutoAnswer({
        callId: error.callId,
        sessionId: ctx.sessionId,
        projectId: ctx.sessionManager.getSession(ctx.sessionId)?.projectId,
        type: error.type,
        options: error.options,
      })
      const answerPromise = awaitAnswer(error.callId)
      if (!answerPromise) {
        throw new Error(
          serverT(
            {
              en: 'No pending question found for callId: {{id}}',
              fr: 'Aucune question en attente trouvée pour callId : {{id}}',
            },
            { id: error.callId },
          ),
        )
      }
      const answer = await answerPromise
      return {
        success: true,
        output: answer,
        durationMs: Date.now() - startTime,
        truncated: false,
        ...(consumeAutoAnswered(error.callId) ? { metadata: { autoAnswered: true } } : {}),
      }
    } else if (error instanceof Error && (error.message === 'Aborted' || error.name === 'AbortError')) {
      return createInterruptedResult(startTime)
    } else {
      throw error
    }
  }

  const executeTool = async (
    toolCall: ToolCall,
    index: number,
  ): Promise<{
    toolCall: ToolCall
    toolResult: ToolResult
    content: string
    index: number
  }> => {
    if (ctx.signal?.aborted) {
      const toolResult = createInterruptedResult()
      append(createToolResultEvent(assistantMsgId, toolCall.id, toolResult))
      return {
        toolCall,
        toolResult,
        content: serverT({ en: 'Error: {{message}}', fr: 'Erreur : {{message}}' }, { message: interruptedError() }),
        index,
      }
    }

    if (toolCall.parseError) {
      if (toolCall.name === 'step_done') {
        const { parseError: _pe, rawArguments: _ra, ...rest } = toolCall
        toolCall = { ...rest, arguments: {} }
      } else {
        const toolResult: ToolResult = {
          success: false,
          error: serverT(
            {
              en: 'Failed to parse tool call arguments: {{error}}. Please ensure your JSON function call arguments are valid.',
              fr: 'Échec de l’analyse des arguments de l’appel d’outil : {{error}}. Assurez-vous que vos arguments JSON d’appel de fonction sont valides.',
            },
            { error: toolCall.parseError ?? '' },
          ),
          durationMs: 0,
          truncated: false,
        }
        append(createToolResultEvent(assistantMsgId, toolCall.id, toolResult))
        return {
          toolCall,
          toolResult,
          content: serverT(
            { en: 'Error: {{message}}', fr: 'Erreur : {{message}}' },
            { message: toolResult.error ?? '' },
          ),
          index,
        }
      }
    }

    const onProgress = ctx.onMessage
      ? createToolProgressHandler(append, assistantMsgId, toolCall.id, ctx.sessionId)
      : undefined

    const toolContext: ToolContext = {
      sessionManager: ctx.sessionManager,
      workdir: ctx.sessionManager.getEffectiveWorkdir(ctx.sessionId),
      sessionId: ctx.sessionId,
      signal: ctx.signal,
      llmClient: ctx.llmClient,
      statsIdentity: ctx.statsIdentity,
      lspManager: ctx.sessionManager.getLspManager(ctx.sessionId),
      onEvent: ctx.onMessage,
      onProgress,
      toolCallId: toolCall.id,
    }
    if (ctx.dangerLevel) {
      toolContext.dangerLevel = ctx.dangerLevel
    }
    if (ctx.isSubAgent) {
      toolContext.isSubAgent = true
    }
    if (ctx.providerManager) {
      toolContext.providerManager = ctx.providerManager
    }

    const startTime = Date.now()
    let toolResult: ToolResult
    try {
      toolResult = await ctx.toolRegistry.execute(toolCall.name, toolCall.arguments, toolContext)
    } catch (error) {
      toolResult = await handleToolExecutionError(error, ctx.sessionId, startTime)
    }

    ctx.onToolExecuted?.(toolCall, toolResult)

    if (toolCall.name === 'return_value' && !toolCall.parseError) {
      returnValueContent = (toolCall.arguments as Record<string, unknown>)['content'] as string
      returnValueResult = (toolCall.arguments as Record<string, unknown>)['result'] as string | undefined
    }

    // Detected at two levels:
    //   1. Here in execute-tools: signals the agent loop to break immediately
    //      (no further LLM calls after step_done).
    //   2. In executor.ts via onToolExecuted callback: signals the workflow
    //      orchestrator to evaluate transitions and move to the next step.
    // Both checks are needed — they serve different concerns.
    if (toolCall.name === 'step_done' && toolResult.success) {
      stepDoneCalled = true
    }

    const rawContent = stripAnsi(
      toolResult.success
        ? (toolResult.output ?? serverT({ en: 'Success', fr: 'Succès' }))
        : toolResult.output
          ? serverT(
              { en: '{{output}}\n\nError: {{error}}', fr: '{{output}}\n\nErreur : {{error}}' },
              { output: toolResult.output, error: toolResult.error ?? '' },
            )
          : serverT({ en: 'Error: {{error}}', fr: 'Erreur : {{error}}' }, { error: toolResult.error ?? '' }),
    )
    const { clean: content, corrupted } = sanitizeUtf8(rawContent)
    if (corrupted) {
      logger.warn('Tool result contained invalid UTF-8 (U+FFFD); sanitized before sending to the LLM', {
        toolCallId: toolCall.id,
        tool: toolCall.name,
      })
    }

    append(createToolResultEvent(assistantMsgId, toolCall.id, toolResult))

    return {
      toolCall,
      toolResult,
      content,
      index,
    }
  }

  const batchStart = Date.now()
  const executionPromises = toolCalls.map((toolCall, index) => executeTool(toolCall, index))
  const results = await Promise.all(executionPromises)
  ctx.turnMetrics.addToolTime(Date.now() - batchStart)

  results.sort((a, b) => a.index - b.index)

  for (const result of results) {
    toolMessages.push({
      role: 'tool',
      content: result.content,
      source: 'history',
      toolCallId: result.toolCall.id,
    })
  }

  return { toolMessages, criteriaChanged: false, returnValueContent, returnValueResult, stepDoneCalled }
}
