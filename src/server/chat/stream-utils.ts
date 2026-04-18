import type { LLMClient } from '../llm/types.js'
import type { LLMCompletionRequest } from '../llm/types.js'
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