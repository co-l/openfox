import type { LLMClient, LLMCompletionRequest, LLMToolDefinition, ReasoningEffort } from '../llm/types.js'
import { streamWithSegments } from '../llm/streaming.js'

function buildStreamRequestObject(params: {
  messages: LLMCompletionRequest['messages']
  tools?: LLMToolDefinition[] | undefined
  toolChoice?: LLMCompletionRequest['toolChoice']
  reasoningEffort?: ReasoningEffort | undefined
  signal?: AbortSignal | undefined
  modelSettings?:
    | { temperature?: number; topP?: number; topK?: number; maxTokens?: number; supportsVision?: boolean }
    | undefined
}): LLMCompletionRequest {
  const { messages, tools, toolChoice, reasoningEffort, signal, modelSettings } = params
  return {
    messages,
    ...(tools && { tools }),
    ...(toolChoice && { toolChoice }),
    ...(reasoningEffort && { reasoningEffort }),
    ...(signal && { signal }),
    ...(modelSettings && { modelSettings }),
  }
}

export type BuildStreamRequestOptions = Parameters<typeof buildStreamRequestObject>[0]

export function buildStreamRequest(client: LLMClient, options: BuildStreamRequestOptions) {
  return streamWithSegments(client, buildStreamRequestObject(options))
}
