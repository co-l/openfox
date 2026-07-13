import WebSocket from 'ws'
import type { ClientRequest, IncomingMessage } from 'node:http'
import type { ToolCall } from '../../../shared/types.js'
import type { ModelConfig } from '../../../shared/types.js'
import type {
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMMessage,
  LLMStreamEvent,
  LLMToolDefinition,
} from '../../llm/types.js'
import type { ProviderAuthAdapter, ProviderRequestContext, ProviderTransportAdapter } from './types.js'
import { fetchCodexModels } from './models-dev-catalog.js'

const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'
const RESPONSES_LITE_MODEL = 'gpt-5.6-luna'
const CODEX_COMPATIBILITY_VERSION = '0.144.0'
const RESPONSES_LITE_HEADER = 'x-openai-internal-codex-responses-lite'
const RESPONSES_WEBSOCKET_PROTOCOL = 'responses_websockets=2026-02-06'
const RESPONSES_LITE_CLIENT_METADATA = 'ws_request_header_x_openai_internal_codex_responses_lite'

interface CodexSseEvent {
  type: string
  response?: {
    id?: string
    usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }
    status?: string
  }
  delta?: string
  item?: {
    id?: string
    type?: string
    name?: string
    call_id?: string
    arguments?: string
    content?: Array<{ type?: string; text?: string }>
  }
  output_index?: number
}

export interface CodexTransportOptions {
  endpoint?: string
  fetch?: typeof fetch
  websocketFactory?: (url: string, options: WebSocket.ClientOptions) => WebSocket
}

export class CodexTransportAdapter implements ProviderTransportAdapter {
  readonly id = 'openai-codex'
  private readonly endpoint: string
  private readonly request: typeof fetch
  private readonly websocketFactory: (url: string, options: WebSocket.ClientOptions) => WebSocket

  constructor(
    private readonly auth: ProviderAuthAdapter,
    options: CodexTransportOptions = {},
  ) {
    this.endpoint = options.endpoint ?? CODEX_RESPONSES_URL
    this.request = options.fetch ?? fetch
    this.websocketFactory = options.websocketFactory ?? ((url, wsOptions) => new WebSocket(url, wsOptions))
  }

  async listModels(): Promise<ModelConfig[]> {
    try {
      return await fetchCodexModels(this.request)
    } catch {
      return [
        { id: 'gpt-5.4', contextWindow: 1050000, source: 'default' },
        { id: 'gpt-5.3-codex', contextWindow: 400000, source: 'default' },
        { id: 'gpt-5.3-codex-spark', contextWindow: 128000, source: 'default' },
      ]
    }
  }

  async complete(request: LLMCompletionRequest, context: ProviderRequestContext): Promise<LLMCompletionResponse> {
    let result: LLMCompletionResponse | undefined
    for await (const event of this.stream(request, context)) {
      if (event.type === 'done') result = event.response
      if (event.type === 'error') throw new Error(event.error)
    }
    if (!result) throw new Error('Codex response completed without a final response')
    return result
  }

  async *stream(request: LLMCompletionRequest, context: ProviderRequestContext): AsyncIterable<LLMStreamEvent> {
    if (!context.credentialRef) {
      yield { type: 'error', error: 'OpenAI account is not connected' }
      return
    }

    try {
      const access = await this.auth.getAccessContext(context.credentialRef)
      const model = context.model ?? 'gpt-5.2-codex'
      const sessionId = crypto.randomUUID()
      const codexRequest = buildCodexRequest(request, model)
      const isResponsesLite = model === RESPONSES_LITE_MODEL
      const headers = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...access.headers,
        ...(isResponsesLite && {
          'session-id': sessionId,
          'x-session-affinity': sessionId,
          version: CODEX_COMPATIBILITY_VERSION,
          [RESPONSES_LITE_HEADER]: 'true',
        }),
      }
      const preparedRequest = isResponsesLite ? prepareResponsesLiteRequest(codexRequest, sessionId) : codexRequest
      const response = isResponsesLite
        ? await this.requestResponsesLiteWithRetry(preparedRequest, headers, request.signal)
        : await this.request(this.endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(preparedRequest),
            ...(request.signal && { signal: request.signal }),
          })
      if (!response.ok) {
        const detail = await response.text()
        throw new Error(`Codex HTTP ${response.status}: ${detail}`)
      }
      if (!response.body) throw new Error('Codex response has no stream body')

      let responseId = ''
      let content = ''
      let thinking = ''
      let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
      const calls = new Map<number, { id: string; name: string; arguments: string }>()

      for await (const event of parseSse(response.body)) {
        if (event.response?.id) responseId = event.response.id
        if (event.response?.usage) {
          usage = {
            promptTokens: event.response.usage.input_tokens ?? 0,
            completionTokens: event.response.usage.output_tokens ?? 0,
            totalTokens:
              event.response.usage.total_tokens ??
              (event.response.usage.input_tokens ?? 0) + (event.response.usage.output_tokens ?? 0),
          }
        }

        if (event.type === 'response.output_text.delta' && event.delta) {
          content += event.delta
          yield { type: 'text_delta', content: event.delta }
        }
        if (event.type === 'response.reasoning_summary_text.delta' && event.delta) {
          thinking += event.delta
          yield { type: 'thinking_delta', content: event.delta }
        }
        if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
          const index = event.output_index ?? calls.size
          const call = {
            id: event.item.call_id ?? event.item.id ?? '',
            name: event.item.name ?? '',
            arguments: event.item.arguments ?? '',
          }
          calls.set(index, call)
          yield {
            type: 'tool_call_delta',
            index,
            ...(call.id && { id: call.id }),
            ...(call.name && { name: call.name }),
            ...(call.arguments && { arguments: call.arguments }),
          }
        }
        if (event.type === 'response.function_call_arguments.delta' && event.delta) {
          const index = event.output_index ?? 0
          const call = calls.get(index) ?? { id: '', name: '', arguments: '' }
          call.arguments += event.delta
          calls.set(index, call)
          yield { type: 'tool_call_delta', index, arguments: event.delta }
        }
      }

      const toolCalls = parseToolCalls(calls)
      yield {
        type: 'done',
        response: {
          id: responseId,
          content: content.trim(),
          ...(thinking.trim() && { thinkingContent: thinking.trim() }),
          ...(toolCalls.length && { toolCalls }),
          finishReason: toolCalls.length ? 'tool_calls' : 'stop',
          usage,
        },
      }
    } catch (error) {
      yield { type: 'error', error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async requestResponsesLiteWithRetry(
    body: Record<string, unknown>,
    headers: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<Response> {
    const maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.requestResponsesLiteOverWebSocket(body, headers, signal)
      } catch (error) {
        const status = error instanceof CodexWebSocketHandshakeError ? error.status : undefined
        const retryable = status === 502 || status === 503 || status === 504
        if (!retryable || attempt === maxAttempts || signal?.aborted) throw error
        await delay(250 * 2 ** (attempt - 1), signal)
      }
    }
    throw new Error('Codex WebSocket retry loop completed unexpectedly')
  }

  private requestResponsesLiteOverWebSocket(
    body: Record<string, unknown>,
    headers: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<Response> {
    const websocketUrl = this.endpoint.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')
    const socket = this.websocketFactory(websocketUrl, {
      headers: {
        ...headers,
        'openai-beta': RESPONSES_WEBSOCKET_PROTOCOL,
      },
    })
    const encoder = new TextEncoder()

    return new Promise<Response>((resolve, reject) => {
      let opened = false
      let settled = false

      const cleanupBeforeOpen = () => {
        socket.off('open', onOpen)
        socket.off('error', onInitialError)
        socket.off('close', onInitialClose)
        socket.off('unexpected-response', onUnexpectedResponse)
        signal?.removeEventListener('abort', onAbortBeforeOpen)
      }
      const onInitialError = (error: Error) => {
        if (settled) return
        settled = true
        cleanupBeforeOpen()
        reject(error)
      }
      const onUnexpectedResponse = (_request: ClientRequest, response: IncomingMessage) => {
        if (settled) return
        settled = true
        cleanupBeforeOpen()
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)))
        response.on('end', () => {
          const detail = Buffer.concat(chunks).toString('utf8').trim()
          reject(new CodexWebSocketHandshakeError(response.statusCode ?? 0, detail))
        })
        response.on('error', (error: Error) => reject(error))
      }
      const onInitialClose = (code: number, reason: Buffer) => {
        if (opened || settled) return
        settled = true
        cleanupBeforeOpen()
        reject(
          new Error(`Codex WebSocket closed before open (${code}${reason.length ? `: ${reason.toString()}` : ''})`),
        )
      }
      const onAbortBeforeOpen = () => {
        if (settled) return
        settled = true
        cleanupBeforeOpen()
        socket.terminate()
        reject(new DOMException('Aborted', 'AbortError'))
      }
      const onOpen = () => {
        opened = true
        cleanupBeforeOpen()
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            let completed = false
            const finish = () => {
              if (completed) return
              completed = true
              cleanup()
              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              controller.close()
              socket.close()
            }
            const fail = (error: Error) => {
              if (completed) return
              completed = true
              cleanup()
              controller.error(error)
              socket.terminate()
            }
            const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
              if (isBinary) {
                fail(new Error('Unexpected binary Codex WebSocket frame'))
                return
              }
              const text = data.toString()
              let event: Record<string, unknown>
              try {
                event = JSON.parse(text) as Record<string, unknown>
              } catch {
                fail(new Error('Invalid Codex WebSocket event'))
                return
              }
              if (event['type'] === 'error') {
                const nested = isRecord(event['error']) ? event['error'] : undefined
                const message = typeof nested?.['message'] === 'string' ? nested['message'] : text
                fail(new Error(message))
                return
              }
              controller.enqueue(encoder.encode(`data: ${text}\n\n`))
              if (
                event['type'] === 'response.completed' ||
                event['type'] === 'response.done' ||
                event['type'] === 'response.failed' ||
                event['type'] === 'response.incomplete'
              ) {
                finish()
              }
            }
            const onError = (error: Error) => fail(error)
            const onClose = (code: number, reason: Buffer) => {
              if (!completed)
                fail(
                  new Error(
                    `Codex WebSocket closed before completion (${code}${reason.length ? `: ${reason.toString()}` : ''})`,
                  ),
                )
            }
            const onAbort = () => fail(new DOMException('Aborted', 'AbortError'))
            const cleanup = () => {
              socket.off('message', onMessage)
              socket.off('error', onError)
              socket.off('close', onClose)
              signal?.removeEventListener('abort', onAbort)
            }

            socket.on('message', onMessage)
            socket.once('error', onError)
            socket.once('close', onClose)
            signal?.addEventListener('abort', onAbort, { once: true })

            const { stream: _stream, background: _background, ...payload } = body
            socket.send(
              JSON.stringify({
                type: 'response.create',
                ...payload,
                client_metadata: {
                  ...(isRecord(payload['client_metadata']) ? payload['client_metadata'] : {}),
                  [RESPONSES_LITE_CLIENT_METADATA]: 'true',
                },
              }),
              (error) => {
                if (error) fail(error)
              },
            )
          },
          cancel() {
            socket.terminate()
          },
        })
        settled = true
        resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
      }

      socket.once('open', onOpen)
      socket.once('error', onInitialError)
      socket.once('close', onInitialClose)
      socket.once('unexpected-response', onUnexpectedResponse)
      signal?.addEventListener('abort', onAbortBeforeOpen, { once: true })
    })
  }
}

function buildCodexRequest(request: LLMCompletionRequest, model: string): Record<string, unknown> {
  const instructions = request.messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n')
  const input = request.messages.filter((message) => message.role !== 'system').flatMap(toCodexInputItems)

  return {
    model,
    stream: true,
    store: false,
    instructions,
    input,
    tools: request.tools?.map(toCodexTool) ?? [],
    tool_choice: request.toolChoice ?? 'auto',
    ...(request.reasoningEffort && { reasoning: { effort: request.reasoningEffort } }),
    ...(request.maxTokens && { max_output_tokens: request.maxTokens }),
  }
}

function prepareResponsesLiteRequest(request: Record<string, unknown>, sessionId: string): Record<string, unknown> {
  const input = Array.isArray(request['input']) ? structuredClone(request['input']) : []
  const tools = Array.isArray(request['tools']) ? structuredClone(request['tools']) : []
  const instructions = typeof request['instructions'] === 'string' ? request['instructions'] : ''

  stripImageDetail(input)

  const prepared: Record<string, unknown> = {
    ...request,
    input: [
      { type: 'additional_tools', role: 'developer', tools },
      ...(instructions
        ? [
            {
              type: 'message',
              role: 'developer',
              content: [{ type: 'input_text', text: instructions }],
            },
          ]
        : []),
      ...input,
    ],
    tool_choice: 'auto',
    parallel_tool_calls: false,
    prompt_cache_key: sessionId,
    reasoning: {
      ...(isRecord(request['reasoning']) ? request['reasoning'] : {}),
      context: 'all_turns',
    },
  }

  delete prepared['tools']
  delete prepared['instructions']
  delete prepared['max_output_tokens']
  return prepared
}

function stripImageDetail(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) stripImageDetail(item)
    return
  }
  if (!isRecord(value)) return
  if (value['type'] === 'input_image') delete value['detail']
  for (const item of Object.values(value)) stripImageDetail(item)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toCodexInputItems(message: LLMMessage): Record<string, unknown>[] {
  if (message.role === 'tool') {
    return [{ type: 'function_call_output', call_id: message.toolCallId ?? '', output: message.content }]
  }
  if (message.role === 'assistant') {
    const items: Record<string, unknown>[] = []
    if (message.content) {
      items.push({ role: 'assistant', content: [{ type: 'output_text', text: message.content }] })
    }
    for (const call of message.toolCalls ?? []) {
      items.push({
        type: 'function_call',
        call_id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.arguments),
      })
    }
    return items
  }
  return [{ role: message.role, content: [{ type: 'input_text', text: message.content }] }]
}

function toCodexTool(tool: LLMToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    strict: false,
  }
}

async function* parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<CodexSseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() ?? ''
      for (const block of blocks) {
        const data = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n')
        if (!data || data === '[DONE]') continue
        yield JSON.parse(data) as CodexSseEvent
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function parseToolCalls(calls: Map<number, { id: string; name: string; arguments: string }>): ToolCall[] {
  return [...calls.values()].map((call) => {
    try {
      return { id: call.id, name: call.name, arguments: JSON.parse(call.arguments || '{}') as Record<string, unknown> }
    } catch (error) {
      return {
        id: call.id,
        name: call.name,
        arguments: {},
        parseError: error instanceof Error ? error.message : 'Invalid JSON',
        rawArguments: call.arguments,
      }
    }
  })
}

class CodexWebSocketHandshakeError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`Codex WebSocket handshake failed (${status})${detail ? `: ${detail}` : ''}`)
    this.name = 'CodexWebSocketHandshakeError'
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}
