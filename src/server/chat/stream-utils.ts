import type { LLMClient } from '../llm/types.js'
import type { LLMCompletionRequest, LLMToolDefinition } from '../llm/types.js'
import { streamWithSegments } from '../llm/streaming.js'

function buildStreamRequestObject(params: {
  messages: LLMCompletionRequest['messages']
  tools?: LLMToolDefinition[] | undefined
  toolChoice?: LLMCompletionRequest['toolChoice']
  disableThinking?: boolean | undefined
  signal?: AbortSignal | undefined
  onVisionFallbackStart?: ((attachmentId: string, filename?: string) => void) | undefined
  onVisionFallbackDone?: ((attachmentId: string, description: string) => void) | undefined
}): LLMCompletionRequest {
  const { messages, tools, toolChoice, disableThinking, signal, onVisionFallbackStart, onVisionFallbackDone } = params
  const streamRequest: LLMCompletionRequest = {
    messages,
    ...(tools && { tools }),
    ...(toolChoice && { toolChoice }),
    disableThinking: disableThinking ?? false,
    ...(signal && { signal }),
  }
  if (onVisionFallbackStart) streamRequest.onVisionFallbackStart = onVisionFallbackStart
  if (onVisionFallbackDone) streamRequest.onVisionFallbackDone = onVisionFallbackDone
  return streamRequest
}

export function createStreamRequest(client: LLMClient, request: LLMCompletionRequest) {
  const { messages, tools, toolChoice, disableThinking, signal, onVisionFallbackStart, onVisionFallbackDone } = request
  return streamWithSegments(client, buildStreamRequestObject({ messages, tools, toolChoice, disableThinking, signal, onVisionFallbackStart, onVisionFallbackDone }))
}

export type BuildStreamRequestOptions = Parameters<typeof buildStreamRequestObject>[0]

export function buildStreamRequest(client: LLMClient, options: BuildStreamRequestOptions) {
  return streamWithSegments(client, buildStreamRequestObject(options))
}