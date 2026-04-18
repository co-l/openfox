import type { LLMClient } from '../llm/types.js'
import type { LLMCompletionRequest, LLMToolDefinition } from '../llm/types.js'
import { streamWithSegments } from '../llm/streaming.js'

export function createStreamRequest(client: LLMClient, request: LLMCompletionRequest) {
  const { messages, tools, toolChoice, disableThinking, signal, onVisionFallbackStart, onVisionFallbackDone } = request
  const streamRequest: LLMCompletionRequest = {
    messages,
    ...(tools && { tools }),
    ...(toolChoice && { toolChoice }),
    disableThinking: disableThinking ?? false,
    ...(signal && { signal }),
  }
  if (onVisionFallbackStart) streamRequest.onVisionFallbackStart = onVisionFallbackStart
  if (onVisionFallbackDone) streamRequest.onVisionFallbackDone = onVisionFallbackDone

  return streamWithSegments(client, streamRequest)
}

export interface BuildStreamRequestOptions {
  messages: LLMCompletionRequest['messages']
  tools?: LLMToolDefinition[] | undefined
  toolChoice?: 'auto' | 'none' | 'required' | undefined
  disableThinking?: boolean | undefined
  signal?: AbortSignal | undefined
  onVisionFallbackStart?: ((attachmentId: string, filename?: string) => void) | undefined
  onVisionFallbackDone?: ((attachmentId: string, description: string) => void) | undefined
}

export function buildStreamRequest(client: LLMClient, options: BuildStreamRequestOptions) {
  const { messages, tools, toolChoice, disableThinking, signal, onVisionFallbackStart, onVisionFallbackDone } = options
  const streamRequest: LLMCompletionRequest = {
    messages,
    ...(tools && { tools }),
    ...(toolChoice && { toolChoice }),
    disableThinking: disableThinking ?? false,
    ...(signal && { signal }),
  }
  if (onVisionFallbackStart) streamRequest.onVisionFallbackStart = onVisionFallbackStart
  if (onVisionFallbackDone) streamRequest.onVisionFallbackDone = onVisionFallbackDone

  return streamWithSegments(client, streamRequest)
}