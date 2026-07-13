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

const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'

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
}

export class CodexTransportAdapter implements ProviderTransportAdapter {
  readonly id = 'openai-codex'
  private readonly endpoint: string
  private readonly request: typeof fetch

  constructor(
    private readonly auth: ProviderAuthAdapter,
    options: CodexTransportOptions = {},
  ) {
    this.endpoint = options.endpoint ?? CODEX_RESPONSES_URL
    this.request = options.fetch ?? fetch
  }

  async listModels(): Promise<ModelConfig[]> {
    return [
      { id: 'gpt-5.2-codex', contextWindow: 200000, source: 'default' },
      { id: 'gpt-5.1-codex-max', contextWindow: 200000, source: 'default' },
      { id: 'gpt-5.1-codex-mini', contextWindow: 200000, source: 'default' },
    ]
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
      const response = await this.request(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...access.headers,
        },
        body: JSON.stringify(buildCodexRequest(request, context.model ?? 'gpt-5.2-codex')),
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

function toCodexInputItems(message: LLMMessage): Record<string, unknown>[] {
  if (message.role === 'tool') {
    return [{ type: 'function_call_output', call_id: message.toolCallId ?? '', output: message.content }]
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    const items: Record<string, unknown>[] = []
    if (message.content) {
      items.push({ role: 'assistant', content: [{ type: 'output_text', text: message.content }] })
    }
    for (const call of message.toolCalls) {
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
