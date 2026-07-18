import type { ToolCall, ToolResult } from '../../shared/types.js'
import type { SessionManager } from '../session/index.js'
import type { ToolContext, ToolRegistry } from '../tools/types.js'
import type { TurnMetrics } from './stream-pure.js'
import type { TurnEvent } from '../events/types.js'
import type { RequestContextMessage } from './request-context.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { StatsIdentity } from '../../shared/types.js'
import type { ServerMessage } from '../../shared/protocol.js'
import type { DangerLevel } from '../../shared/types.js'
import { createToolProgressHandler } from './tool-streaming.js'
import { createToolCallEvent, createToolResultEvent, createChatDoneEvent } from './stream-pure.js'
import { PathAccessDeniedError, AskUserInterrupt } from '../tools/index.js'
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

const INTERRUPTED_ERROR = 'Tool execution was interrupted by user'

function createInterruptedResult(startTime?: number): ToolResult {
  return {
    success: false,
    error: INTERRUPTED_ERROR,
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
        error: `User denied access to ${error.paths.join(', ')}. If you need this file, explain why and ask for permission.`,
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

      const { awaitAnswer } = await import('../tools/ask.js')
      const answerPromise = awaitAnswer(error.callId)
      if (!answerPromise) {
        throw new Error(`No pending question found for callId: ${error.callId}`)
      }
      const answer = await answerPromise
      return {
        success: true,
        output: answer,
        durationMs: Date.now() - startTime,
        truncated: false,
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
        content: `Error: ${INTERRUPTED_ERROR}`,
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
          error: `Failed to parse tool call arguments: ${toolCall.parseError}. Please ensure your JSON function call arguments are valid.`,
          durationMs: 0,
          truncated: false,
        }
        append(createToolResultEvent(assistantMsgId, toolCall.id, toolResult))
        return {
          toolCall,
          toolResult,
          content: `Error: ${toolResult.error}`,
          index,
        }
      }
    }

    const onProgress = ctx.onMessage
      ? createToolProgressHandler(append, assistantMsgId, toolCall.id, ctx.sessionId)
      : undefined

    const toolContext: ToolContext = {
      sessionManager: ctx.sessionManager,
      workdir: ctx.workdir,
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

    const content = stripAnsi(
      toolResult.success
        ? (toolResult.output ?? 'Success')
        : toolResult.output
          ? `${toolResult.output}\n\nError: ${toolResult.error}`
          : `Error: ${toolResult.error}`,
    )

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
