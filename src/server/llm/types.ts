import type { ToolCall, Attachment } from '../../shared/types.js'

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  thinkingContent?: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  name?: string
  attachments?: Attachment[]
}

export interface LLMToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface LLMCompletionRequest {
  messages: LLMMessage[]
  tools?: LLMToolDefinition[]
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } }
  temperature?: number
  maxTokens?: number
  stream?: boolean
  signal?: AbortSignal
  reasoningEffort?: ReasoningEffort
  // User-configured model settings override
  modelSettings?: {
    temperature?: number
    topP?: number
    topK?: number
    maxTokens?: number
    supportsVision?: boolean
    chatTemplateKwargs?: Record<string, unknown>
    queryParams?: Record<string, unknown>
  }
}

export interface LLMCompletionResponse {
  id: string
  content: string
  toolCalls?: ToolCall[]
  thinkingContent?: string
  reasoning_content?: string
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter'
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

export type LLMStreamEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'thinking_delta'; content: string }
  | { type: 'tool_call_delta'; index: number; id?: string; name?: string; arguments?: string }
  | { type: 'done'; response: LLMCompletionResponse }
  | { type: 'error'; error: string }

export type StreamEvent = LLMStreamEvent

export interface LLMClient {
  complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse>
  stream(request: LLMCompletionRequest): AsyncIterable<LLMStreamEvent>
}
