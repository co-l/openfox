import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from './openai-types.js'
import { logger } from '../utils/logger.js'
import { LLMError } from '../utils/errors.js'

export interface RequestOptions {
  signal?: AbortSignal | null | undefined
  /** Extra headers merged over the client's default headers (e.g. opencode session affinity). */
  headers?: Record<string, string>
}

export interface ChatRequest {
  url: string
  headers: Record<string, string>
  body: string
}

/** Signal that the streaming parser hit the end-of-stream marker. */
export const DONE = Symbol('done')

/**
 * Shared HTTP plumbing for the OpenAI and native Ollama chat clients. Both
 * endpoints are JSON-over-HTTP with line-delimited streams; only the request
 * shape, response mapping, and stream framing differ.
 */
export abstract class ChatHttpClient {
  protected abstract buildRequest(
    params: ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming,
  ): ChatRequest

  protected abstract parseNonStreaming(data: unknown): ChatCompletionResponse

  /**
   * Map one trimmed stream line to a chunk, or `null` to skip it, or `DONE`
   * to end the stream (SSE's `[DONE]` marker).
   */
  protected abstract parseStreamLine(trimmed: string): ChatCompletionChunk | typeof DONE | null

  private async post(
    params: ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming,
    options?: RequestOptions,
  ): Promise<Response> {
    const { url, headers, body } = this.buildRequest(params)
    logger.debug('HTTP request to LLM', { url, bodyKeys: Object.keys(params) })
    return postJson(url, { ...headers, ...options?.headers }, body, options)
  }

  async createChatCompletion(
    params: ChatCompletionCreateParamsNonStreaming,
    options?: RequestOptions,
    returnRaw?: boolean,
  ): Promise<ChatCompletionResponse & { raw?: string }> {
    const response = await this.post(params, options)
    return parseCompletionResponse(response, (data) => this.parseNonStreaming(data), returnRaw)
  }

  createChatCompletionStream(
    params: ChatCompletionCreateParamsStreaming,
    options?: RequestOptions,
  ): AsyncGenerator<ChatCompletionChunk> {
    const parseStreamLine = this.parseStreamLine.bind(this)
    const responsePromise = this.post(params, options)

    async function* generate(): AsyncGenerator<ChatCompletionChunk> {
      const response = await responsePromise
      for await (const trimmed of readResponseLines(response)) {
        const chunk = parseStreamLine(trimmed)
        if (chunk === null) continue
        if (chunk === DONE) return
        yield chunk
      }
    }

    return generate()
  }
}

/**
 * POST a JSON body and surface non-2xx responses as an LLMError with the
 * provider's error text.
 */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: string,
  options?: RequestOptions,
): Promise<Response> {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal: options?.signal ?? null,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new LLMError(`HTTP ${response.status}: ${errorText}`)
  }

  return response
}

/**
 * Read a non-streaming response, parse it with the provider-specific mapper,
 * and optionally attach the raw text.
 */
export async function parseCompletionResponse<T>(
  response: Response,
  parse: (data: unknown) => T,
  returnRaw?: boolean,
): Promise<T & { raw?: string }> {
  const rawText = await response.text()
  try {
    const mapped = parse(JSON.parse(rawText))
    if (returnRaw) {
      return { ...mapped, raw: rawText }
    }
    return mapped as T & { raw?: string }
  } catch (error) {
    throw new LLMError(`Failed to parse response: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Yield trimmed, non-empty lines from a streaming response body. Both the
 * SSE stream (OpenAI) and NDJSON stream (native Ollama) are line-delimited.
 */
export async function* readResponseLines(response: Response): AsyncGenerator<string> {
  if (!response.body) {
    throw new LLMError('No response body for streaming')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed) yield trimmed
      }
    }
  } finally {
    reader.releaseLock()
  }
}
