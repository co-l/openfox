/**
 * Native Ollama /api/chat client.
 *
 * Ollama's OpenAI-compatible /v1 endpoint defaults to a 4096-token context and
 * silently truncates anything beyond it (dropping early messages such as the
 * user's prompt), and it has no way to request a larger context — top-level
 * `num_ctx` is ignored by every released version. The native /api/chat endpoint
 * accepts `options.num_ctx`, so the Ollama backend talks to it directly.
 *
 * This module translates the OpenAI-shaped request params produced by
 * client-pure into a native /api/chat body, and native responses back into the
 * OpenAI shape that client.ts already knows how to parse (thinking deltas,
 * tool-call accumulation, usage).
 */

import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatCompletionMessageToolCall,
  ChatCompletionMessageParam,
} from './openai-types.js'
import { logger } from '../utils/logger.js'
import { ChatHttpClient, DONE, type ChatRequest } from './http-shared.js'
import './proxy.js'

export interface OllamaClientOptions {
  /** Base URL WITHOUT the /v1 prefix (e.g. http://localhost:11434). */
  baseURL: string
}

interface OllamaToolCall {
  id?: string
  function?: {
    index?: number
    name?: string
    arguments?: string | Record<string, unknown> | null
  }
}

interface OllamaMessage {
  role?: string
  content?: string
  reasoning?: string
  thinking?: string
  tool_calls?: OllamaToolCall[]
}

interface OllamaChatResponse {
  message?: OllamaMessage
  done?: boolean
  done_reason?: string
  prompt_eval_count?: number
  eval_count?: number
}

function mapDoneReason(reason?: string): ChatCompletionResponse['choices'][0]['finish_reason'] {
  switch (reason) {
    case 'length':
      return 'length'
    case 'tool_calls':
      return 'tool_calls'
    case 'content_filter':
      return 'content_filter'
    default:
      return 'stop'
  }
}

function stringifyToolArguments(rawArguments: string | Record<string, unknown> | null | undefined): string {
  if (typeof rawArguments === 'string') return rawArguments
  if (rawArguments === undefined || rawArguments === null) return '{}'
  return JSON.stringify(rawArguments)
}

const OLLAMA_THINK_LEVELS = new Set(['low', 'medium', 'high', 'max'])

/**
 * Map a reasoning effort to Ollama's `think` field, which only accepts a
 * boolean or the levels low/medium/high/max. Anything unrecognized falls back
 * to `true` so an exotic level can never produce a 400.
 */
export function toOllamaThink(effort: string): boolean | string {
  if (effort === 'none') return false
  if (effort === 'xhigh') return 'max'
  if (OLLAMA_THINK_LEVELS.has(effort)) return effort
  return true
}

/**
 * Native /api/chat expects `tool_calls[].function.arguments` as an object,
 * while OpenAI-shaped history messages carry it as a JSON string. Parse the
 * string back into an object; messages without tool calls pass through
 * untouched.
 *
 * Also converts OpenAI-style content arrays to Ollama-native format:
 * - Text parts are concatenated into the `content` string
 * - image_url parts are extracted as base64 strings into the `images` array
 */
function toNativeMessage(message: ChatCompletionMessageParam): Record<string, unknown> {
  const raw = message as unknown as Record<string, unknown>
  const toolCalls = raw['tool_calls']

  // Handle content: if it's an array, convert to Ollama-native format
  const content = raw['content']
  if (Array.isArray(content)) {
    const textParts: string[] = []
    const imageParts: string[] = []

    for (const part of content) {
      if (part.type === 'text') {
        textParts.push(part.text)
      } else if (part.type === 'image_url') {
        const match = part.image_url.url.match(/^data:image\/[^;]+;base64,(.+)$/)
        if (match && match[1]) {
          imageParts.push(match[1])
        }
      }
    }

    const result: Record<string, unknown> = {
      ...raw,
      content: textParts.join('\n'),
    }

    if (imageParts.length > 0) {
      result['images'] = imageParts
    }

    // If there are also tool_calls, convert their arguments
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      result['tool_calls'] = toolCalls.map((toolCall) => {
        const fn = (toolCall as { function?: { arguments?: unknown } }).function
        if (!fn || typeof fn.arguments !== 'string') return toolCall
        try {
          return {
            ...toolCall,
            function: { ...fn, arguments: JSON.parse(fn.arguments) },
          }
        } catch {
          return toolCall
        }
      })
    }

    return result
  }

  // No content array - handle tool calls if present
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    return {
      ...raw,
      tool_calls: toolCalls.map((toolCall) => {
        const fn = (toolCall as { function?: { arguments?: unknown } }).function
        if (!fn || typeof fn.arguments !== 'string') return toolCall
        try {
          return {
            ...toolCall,
            function: { ...fn, arguments: JSON.parse(fn.arguments) },
          }
        } catch {
          return toolCall
        }
      }),
    }
  }

  // No tool calls and content is not an array - pass through unchanged
  return raw
}

/**
 * Translate an OpenAI-shaped completion request into a native /api/chat body.
 * `options.num_ctx` is the critical field: without it Ollama runs the model at
 * its 4096-token default and drops the user message from truncated prompts.
 */
export function buildOllamaChatRequest(
  params: ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming,
): Record<string, unknown> {
  const options: Record<string, unknown> = {}
  if (params.temperature !== undefined) options['temperature'] = params.temperature
  if (params.top_p !== undefined) options['top_p'] = params.top_p
  if (params.top_k !== undefined) options['top_k'] = params.top_k
  if (params.max_tokens !== undefined) options['num_predict'] = params.max_tokens
  if (params['num_ctx'] !== undefined) options['num_ctx'] = params['num_ctx']
  if (params['stop']) options['stop'] = params['stop']
  if (params['frequency_penalty'] !== undefined) options['frequency_penalty'] = params['frequency_penalty']
  if (params['presence_penalty'] !== undefined) options['presence_penalty'] = params['presence_penalty']
  if (params['seed'] !== undefined) options['seed'] = params['seed']

  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages.map(toNativeMessage),
    stream: Boolean(params.stream),
    ...(params.tools && params.tools.length > 0 ? { tools: params.tools } : {}),
    ...(Object.keys(options).length > 0 ? { options } : {}),
  }

  if (params['response_format'] && typeof params['response_format'] === 'object') {
    const type = (params['response_format'] as { type?: string }).type
    if (type === 'json_object' || type === 'json') {
      body['format'] = 'json'
    }
  }

  // Thinking control: chat_template_kwargs.enable_thinking (bool) or
  // reasoning_effort (level string / "none") map to the native `think` field.
  const kwargs = params.chat_template_kwargs
  if (kwargs && typeof kwargs['enable_thinking'] === 'boolean') {
    body['think'] = kwargs['enable_thinking']
  }
  if (params.reasoning_effort) {
    body['think'] = toOllamaThink(params.reasoning_effort)
  }

  return body
}

function nativeToolCallToOpenAIResponse(toolCall: OllamaToolCall, index: number): ChatCompletionMessageToolCall {
  const fn = toolCall.function ?? {}
  return {
    id: toolCall.id ?? `call_${index}`,
    type: 'function',
    function: {
      name: fn.name ?? '',
      arguments: stringifyToolArguments(fn.arguments),
    },
  }
}

type StreamToolCall = NonNullable<ChatCompletionChunk['choices'][0]['delta']['tool_calls']>[number]

function nativeToolCallToOpenAIStream(toolCall: OllamaToolCall, index: number): StreamToolCall {
  const fn = toolCall.function ?? {}
  return {
    index: typeof fn.index === 'number' ? fn.index : index,
    id: toolCall.id ?? `call_${index}`,
    function: {
      name: fn.name ?? '',
      arguments: stringifyToolArguments(fn.arguments),
    },
  }
}

/**
 * Translate a native non-streaming /api/chat response into the OpenAI shape.
 */
export function parseOllamaChatResponse(data: OllamaChatResponse): ChatCompletionResponse {
  const msg = data.message ?? {}
  const toolCalls = (msg.tool_calls ?? []).map(nativeToolCallToOpenAIResponse)
  const promptTokens = typeof data.prompt_eval_count === 'number' ? data.prompt_eval_count : 0
  const completionTokens = typeof data.eval_count === 'number' ? data.eval_count : 0

  const message: ChatCompletionResponse['choices'][0]['message'] = {
    content: msg.content ?? '',
  }
  if (msg.reasoning) message['reasoning_content'] = msg.reasoning
  if (msg.thinking) message['thinking'] = msg.thinking
  if (toolCalls.length > 0) message['tool_calls'] = toolCalls

  return {
    id: `chatcmpl-${Date.now()}`,
    choices: [
      {
        finish_reason: mapDoneReason(data.done_reason),
        message,
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  }
}

/**
 * Translate one native streaming /api/chat line into an OpenAI-shaped chunk.
 */
export function parseOllamaChatChunk(data: OllamaChatResponse): ChatCompletionChunk {
  const msg = data.message ?? {}
  const toolCalls = (msg.tool_calls ?? []).map(nativeToolCallToOpenAIStream)

  const delta: ChatCompletionChunk['choices'][0]['delta'] = {}
  if (msg.content) delta['content'] = msg.content
  if (msg.reasoning) delta['reasoning_content'] = msg.reasoning
  if (msg.thinking) delta['thinking'] = msg.thinking
  if (toolCalls.length > 0) delta['tool_calls'] = toolCalls

  const promptTokens = typeof data.prompt_eval_count === 'number' ? data.prompt_eval_count : undefined
  const completionTokens = typeof data.eval_count === 'number' ? data.eval_count : undefined

  return {
    id: `chatcmpl-${Date.now()}`,
    choices: [
      {
        delta,
        finish_reason: data.done ? mapDoneReason(data.done_reason) : null,
      },
    ],
    ...(promptTokens !== undefined
      ? {
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens ?? 0,
            total_tokens: promptTokens + (completionTokens ?? 0),
          },
        }
      : {}),
  }
}

/**
 * HTTP client for Ollama's native /api/chat endpoint. Mirrors
 * OpenAIHttpClient's interface so client.ts can dispatch on backend.
 */
export class OllamaHttpClient extends ChatHttpClient {
  private baseURL: string

  constructor(options: OllamaClientOptions) {
    super()
    this.baseURL = options.baseURL
  }

  protected buildRequest(
    params: ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming,
  ): ChatRequest {
    return {
      url: `${this.baseURL}/api/chat`,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildOllamaChatRequest(params)),
    }
  }

  protected parseNonStreaming(data: unknown): ChatCompletionResponse {
    return parseOllamaChatResponse(data as OllamaChatResponse)
  }

  protected parseStreamLine(trimmed: string): ChatCompletionChunk | typeof DONE | null {
    try {
      return parseOllamaChatChunk(JSON.parse(trimmed) as OllamaChatResponse)
    } catch (error) {
      logger.warn('Failed to parse Ollama stream chunk', { data: trimmed, error })
      return null
    }
  }
}
