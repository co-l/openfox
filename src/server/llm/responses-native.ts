/**
 * OpenAI Responses API client (`POST /v1/responses`).
 *
 * Some provider models (OpenCode Go: gpt-5.6-luna, grok-4.6,
 * muse-spark-1.2-contributor — see https://opencode.ai/docs/go/) are served
 * through OpenAI's Responses API, whose request/response schema differs from
 * `/v1/chat/completions`. This module translates in both directions so
 * client.ts keeps consuming OpenAI chat shapes:
 *
 *   request   chat/completions params  →  /responses body
 *   response  /responses output[]      →  ChatCompletionResponse
 *   stream    /responses SSE events    →  ChatCompletionChunk
 *
 * Translation notes:
 * - system message → top-level `instructions`; conversation → `input[]`
 * - tools lose their `function` nesting (flat `{type:'function',name,...}`)
 * - `max_tokens` → `max_output_tokens`
 * - `reasoning_effort` → `reasoning: { effort }` ('none' is omitted — the
 *   Responses API has no "off", absence is the default)
 * - assistant tool_calls in history → `function_call` input items, and tool
 *   role messages → `function_call_output` items (keyed by `call_id`)
 * - `store: false` keeps every request stateless (ZDR-friendly)
 */

import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from './openai-types.js'
import { logger } from '../utils/logger.js'
import { ChatHttpClient, DONE, type ChatRequest } from './http-shared.js'

export interface ResponsesClientOptions {
  baseURL: string
  apiKey: string
}

// ============================================================================
// Request translation
// ============================================================================

export interface ResponsesRequestBody {
  model: string
  input: Array<Record<string, unknown>>
  instructions?: string
  tools?: Array<Record<string, unknown>>
  tool_choice?: unknown
  max_output_tokens?: number
  stream?: boolean
  store?: boolean
  reasoning?: { effort?: string }
  [key: string]: unknown
}

type ResponsesInputItem = Record<string, unknown>

function messageToInputItem(message: ChatCompletionMessageParam): ResponsesInputItem | null {
  if (message.role === 'system' || message.role === 'developer') return null

  if (message.role === 'tool') {
    return { type: 'function_call_output', call_id: message.tool_call_id ?? '', output: message.content ?? '' }
  }

  if (message.role === 'assistant' && message.tool_calls?.length) {
    // Assistant messages carrying tool calls become function_call items; the
    // textual part (usually empty in agent loops) is emitted before them.
    const items: ResponsesInputItem[] = []
    if (message.content) items.push({ role: 'assistant', content: message.content })
    for (const toolCall of message.tool_calls) {
      items.push({
        type: 'function_call',
        call_id: toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      })
    }
    return items.length === 1 ? items[0]! : { __multi: items }
  }

  return { role: message.role, content: message.content ?? '' }
}

function flattenInput(items: Array<ResponsesInputItem>): Array<ResponsesInputItem> {
  return items.flatMap((item) =>
    item['__multi'] !== undefined ? (item['__multi'] as Array<ResponsesInputItem>) : [item],
  )
}

function convertTools(tools: ChatCompletionTool[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }))
}

export function buildResponsesRequest(
  params: ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming,
): ResponsesRequestBody {
  const systemMessages = params.messages.filter((m) => m.role === 'system' || m.role === 'developer')
  const instructions = systemMessages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n\n')

  const body: ResponsesRequestBody = {
    model: params.model,
    input: flattenInput(
      params.messages.map(messageToInputItem).filter((item): item is ResponsesInputItem => item !== null),
    ),
    stream: Boolean(params.stream),
    store: false,
  }

  if (instructions) body.instructions = instructions
  if (params.tools?.length) body.tools = convertTools(params.tools)
  if (params.tool_choice !== undefined) {
    const choice = params.tool_choice
    body.tool_choice = choice === 'auto' || choice === 'none' ? choice : 'auto'
  }
  // GPT-5.x-family models served through the Responses API reject ALL
  // sampling params ("'temperature'/'top_p' is not supported with this
  // model"), so none are forwarded — only max_output_tokens is safe.
  // The openai backend sends the modern max_completion_tokens param name.
  const maxTokens = params.max_tokens ?? (params as unknown as { max_completion_tokens?: number }).max_completion_tokens
  if (maxTokens !== undefined) body.max_output_tokens = maxTokens

  // The Responses API expresses reasoning as a `reasoning.effort` object and
  // has no explicit "off" — omit the field entirely for 'none'.
  const effort = params.reasoning_effort
  if (effort && effort !== 'none') {
    body.reasoning = { effort }
  }

  return body
}

// ============================================================================
// Response translation (non-streaming)
// ============================================================================

interface ResponsesOutputItem {
  type?: string
  id?: string
  role?: string
  name?: string
  call_id?: string
  arguments?: string
  content?: Array<{ type?: string; text?: string }>
  summary?: Array<{ type?: string; text?: string }>
}

interface ResponsesApiResponse {
  id?: string
  status?: string
  incomplete_details?: { reason?: string } | null
  error?: { message?: string } | null
  output?: ResponsesOutputItem[]
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }
}

function mapResponseStatus(
  status?: string,
  incompleteReason?: string,
): ChatCompletionResponse['choices'][0]['finish_reason'] {
  switch (status) {
    case 'incomplete':
      return incompleteReason === 'max_output_tokens' ? 'length' : 'stop'
    case 'failed':
    case 'cancelled':
      return 'content_filter'
    default:
      return 'stop'
  }
}

export function parseResponsesResponse(data: ResponsesApiResponse): ChatCompletionResponse {
  let content = ''
  let reasoning = ''
  const toolCalls: ChatCompletionResponse['choices'][0]['message']['tool_calls'] = []

  for (const item of data.output ?? []) {
    if (item.type === 'message') {
      for (const block of item.content ?? []) {
        if (block.type === 'output_text' && block.text) content += block.text
      }
    } else if (item.type === 'reasoning') {
      for (const block of item.summary ?? []) {
        if (block.text) reasoning += block.text
      }
    } else if (item.type === 'function_call') {
      toolCalls.push({
        id: item.call_id ?? item.id ?? `call_${toolCalls.length}`,
        type: 'function',
        function: { name: item.name ?? '', arguments: item.arguments ?? '{}' },
      })
    }
  }

  const promptTokens = data.usage?.input_tokens ?? 0
  const completionTokens = data.usage?.output_tokens ?? 0

  const message: ChatCompletionResponse['choices'][0]['message'] = { content }
  if (reasoning) message['reasoning_content'] = reasoning
  if (toolCalls.length > 0) message['tool_calls'] = toolCalls

  return {
    id: data.id ?? `resp_${Date.now()}`,
    choices: [
      {
        finish_reason:
          toolCalls.length > 0 ? 'tool_calls' : mapResponseStatus(data.status, data.incomplete_details?.reason),
        message,
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: data.usage?.total_tokens ?? promptTokens + completionTokens,
    },
  }
}

// ============================================================================
// Stream translation (SSE events → chat chunks)
// ============================================================================

type StreamToolCall = NonNullable<ChatCompletionChunk['choices'][0]['delta']['tool_calls']>[number]

/**
 * Translate one Responses SSE event object into a chat chunk, `DONE` at
 * terminal events, or null for events with no chat equivalent.
 */
export function parseResponsesEvent(event: Record<string, unknown>): ChatCompletionChunk | typeof DONE | null {
  const type = event['type']
  const responseId = typeof event['response_id'] === 'string' ? event['response_id'] : 'resp'

  switch (type) {
    case 'response.output_text.delta':
      return chunk(responseId, { content: String(event['delta'] ?? '') })

    case 'response.reasoning_summary_text.delta':
      return chunk(responseId, { reasoning_content: String(event['delta'] ?? '') })

    case 'response.reasoning_text.delta':
      return chunk(responseId, { reasoning_content: String(event['delta'] ?? '') })

    case 'response.output_item.added': {
      const item = event['item'] as ResponsesOutputItem | undefined
      if (item?.type === 'function_call') {
        const callId = item.call_id ?? item.id
        const toolCall: StreamToolCall = {
          index: 0,
          ...(callId ? { id: callId } : {}),
          function: { name: item.name ?? '', arguments: item.arguments ?? '' },
        }
        return chunk(responseId, { tool_calls: [toolCall] })
      }
      return null
    }

    case 'response.function_call_arguments.delta': {
      const toolCall: StreamToolCall = { index: 0, function: { arguments: String(event['delta'] ?? '') } }
      return chunk(responseId, { tool_calls: [toolCall] })
    }

    case 'response.output_text.done':
    case 'response.reasoning_summary_text.done':
    case 'response.reasoning_text.done':
    case 'response.function_call_arguments.done':
    case 'response.output_item.done':
    case 'response.content_part.added':
    case 'response.content_part.done':
      return null

    case 'response.completed': {
      const response = event['response'] as ResponsesApiResponse | undefined
      return finalChunk(responseId, response)
    }

    case 'response.failed': {
      const response = event['response'] as ResponsesApiResponse | undefined
      const message = response?.error?.message ?? 'Responses API request failed'
      logger.warn('Responses API stream failed', { message })
      return finalChunk(responseId, response)
    }

    case 'error': {
      const message = (event['message'] as string | undefined) ?? 'Responses API stream error'
      logger.warn('Responses API stream error event', { message })
      return null
    }

    default:
      return null
  }
}

function chunk(id: string, delta: ChatCompletionChunk['choices'][0]['delta']): ChatCompletionChunk {
  return { id, choices: [{ delta, finish_reason: null }] }
}

function finalChunk(id: string, response?: ResponsesApiResponse): ChatCompletionChunk | typeof DONE {
  const usage = response?.usage
  const c: ChatCompletionChunk = {
    id,
    choices: [
      {
        delta: {},
        finish_reason: mapResponseStatus(response?.status, response?.incomplete_details?.reason),
      },
    ],
  }
  if (usage) {
    c.usage = {
      prompt_tokens: usage.input_tokens ?? 0,
      completion_tokens: usage.output_tokens ?? 0,
      total_tokens: usage.total_tokens ?? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
    }
  }
  return c
}

// ============================================================================
// HTTP client
// ============================================================================

/**
 * HTTP client for the OpenAI Responses API. Mirrors OpenAIHttpClient's
 * interface so client.ts can dispatch per model.
 */
export class OpenAIResponsesHttpClient extends ChatHttpClient {
  private baseURL: string
  private apiKey: string

  constructor(options: ResponsesClientOptions) {
    super()
    this.baseURL = options.baseURL
    this.apiKey = options.apiKey
  }

  protected buildRequest(
    params: ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming,
  ): ChatRequest {
    return {
      url: `${this.baseURL}/responses`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(buildResponsesRequest(params)),
    }
  }

  protected parseNonStreaming(data: unknown): ChatCompletionResponse {
    return parseResponsesResponse(data as ResponsesApiResponse)
  }

  protected parseStreamLine(trimmed: string): ChatCompletionChunk | typeof DONE | null {
    if (!trimmed.startsWith('data: ')) return null

    const data = trimmed.slice(6)
    if (data === '[DONE]') return DONE

    try {
      return parseResponsesEvent(JSON.parse(data) as Record<string, unknown>)
    } catch (error) {
      logger.warn('Failed to parse Responses SSE event', { data, error })
      return null
    }
  }
}
