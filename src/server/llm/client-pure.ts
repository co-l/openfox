import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
  ChatCompletionMessageToolCall,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from './openai-types.js'
import type {
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMMessage,
  LLMToolDefinition,
  ReasoningEffort,
} from './types.js'
import type { Attachment } from '../../shared/types.js'
import type { ModelProfile } from './profiles.js'
import type { BackendCapabilities } from './backend.js'
import { TEXT_MIME_PREFIXES, TEXT_MIME_EXACT } from '../../shared/constants.js'
import {
  extractPdfFromDataUrl,
  extractPdfBlocksFromDataUrl,
  formatVisionFallbackDescription,
} from './resolve-attachments.js'
import { sanitizeToolSchema } from './schema-sanitizer.js'

import type { ContentPart } from './resolve-attachments.js'
export { resolveAttachmentsInMessages } from './resolve-attachments.js'

export interface ModelParams {
  temperature?: number
  topP?: number
  topK?: number
  maxTokens?: number
}

export function parseToolArguments(
  raw: string | null | undefined,
  _meta: { id?: string; name?: string },
): { arguments: Record<string, unknown>; parseError?: string } {
  const input = raw?.trim() ? raw : '{}'
  try {
    const parsed = JSON.parse(input) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { arguments: {}, parseError: 'Tool arguments must be a JSON object' }
    }
    return { arguments: parsed as Record<string, unknown> }
  } catch (error) {
    return {
      arguments: {},
      parseError: error instanceof Error ? error.message : 'Invalid JSON',
    }
  }
}

export function buildModelParams(params: {
  temperature?: number
  topP?: number
  topK?: number | undefined
  maxTokens?: number
  /** Sampling params stripped from the wire request — excluded from modelParams too. */
  omitParams?: string[]
}): ModelParams {
  const isOmitted = (key: string): boolean => params.omitParams?.includes(key) ?? false
  return {
    ...(!isOmitted('temperature') && params.temperature !== undefined && { temperature: params.temperature }),
    ...(!isOmitted('top_p') && params.topP !== undefined && { topP: params.topP }),
    ...(!isOmitted('top_k') && params.topK !== undefined && { topK: params.topK }),
    ...(!isOmitted('max_tokens') && params.maxTokens !== undefined && { maxTokens: params.maxTokens }),
  }
}

type AttachmentContent = ContentPart[]

async function buildAttachmentContent(
  msgContent: string | null | undefined,
  attachments: Attachment[],
  modelSupportsVision: boolean,
): Promise<AttachmentContent> {
  const content: AttachmentContent = []
  if (msgContent?.trim()) {
    content.push({ type: 'text', text: msgContent })
  }
  for (const attachment of attachments) {
    const parts = await convertAttachment(attachment, modelSupportsVision)
    content.push(...parts)
  }
  return content
}

type MinimalCapabilities = Pick<
  BackendCapabilities,
  | 'supportsTopK'
  | 'supportsChatTemplateKwargs'
  | 'supportsNumCtx'
  | 'routesEffortViaChatTemplateKwargs'
  | 'usesMaxCompletionTokens'
>
type MinimalProfile = Pick<
  ModelProfile,
  'temperature' | 'defaultMaxTokens' | 'topP' | 'topK' | 'supportsVision' | 'apiProtocol'
>

function convertToolCalls(
  toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[],
): ChatCompletionMessageToolCall[] {
  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    type: 'function' as const,
    function: {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.arguments),
    },
  }))
}

export function getThinking(
  msg: Record<string, string | null | undefined>,
  override?: string,
): string | null | undefined {
  if (override) {
    const val = msg[override]
    if (val) return val
  }
  return msg['reasoning'] ?? msg['reasoning_content'] ?? msg['thinking']
}

function buildAssistantMessage(
  msg: LLMMessage,
  thinkingField?: string,
  sendReasoningInMessages?: boolean,
  inlineThinking?: boolean,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    role: 'assistant',
    content: msg.content || ' ',
  }
  if (msg.toolCalls?.length) {
    result['tool_calls'] = convertToolCalls(msg.toolCalls)
  }
  if (sendReasoningInMessages === false) return result

  const echoField = thinkingField ?? 'reasoning'
  // DeepSeek-style providers (reasoning_content) reject tool-call continuations
  // when the reasoning field is absent, even empty. Only they get the empty
  // echo — default 'reasoning' providers keep their prior wire contract.
  const isReasoningContentProvider = thinkingField === 'reasoning_content'

  if (msg.thinkingContent) {
    if (inlineThinking && isReasoningContentProvider && !msg.toolCalls?.length) {
      // Providers like the DeepSeek API ignore the reasoning field in requests
      // without tools (it is not concatenated into context). Inline the CoT into
      // the assistant content so the model retains it across turns.
      result['content'] = `${msg.thinkingContent}\n\n${msg.content || ''}`.trim() || ' '
    } else {
      result[echoField] = msg.thinkingContent
    }
  } else if (isReasoningContentProvider && msg.toolCalls?.length) {
    result[echoField] = ''
  }
  return result
}

async function convertAttachment(attachment: Attachment, modelSupportsVision: boolean): Promise<AttachmentContent> {
  const mimeType = attachment.mimeType

  if (TEXT_MIME_EXACT.includes(mimeType) || TEXT_MIME_PREFIXES.some((p) => mimeType.startsWith(p))) {
    return [{ type: 'text', text: `[File: ${attachment.filename || 'file'}]\n${attachment.data}` }]
  }

  if (mimeType === 'application/pdf') {
    if (modelSupportsVision) {
      return extractPdfBlocksFromDataUrl(attachment.data, attachment.filename || 'document.pdf')
    }
    if (attachment.pdfContent) {
      return [{ type: 'text', text: attachment.pdfContent }]
    }
    const text = await extractPdfFromDataUrl(attachment.data, attachment.filename || 'document.pdf')
    return [{ type: 'text', text }]
  }

  if (modelSupportsVision) {
    return [{ type: 'image_url', image_url: { url: attachment.data } }]
  }

  if (attachment.description) {
    return [{ type: 'text', text: formatVisionFallbackDescription(attachment.filename, attachment.description) }]
  }

  return [{ type: 'text', text: `[Image: ${attachment.filename || 'image'}] (vision not supported, cannot describe)` }]
}

export async function convertMessages(
  messages: LLMMessage[],
  modelSupportsVision: boolean,
  thinkingField?: string,
  sendReasoningInMessages?: boolean,
  inlineThinking?: boolean,
): Promise<ChatCompletionMessageParam[]> {
  const filtered = messages.filter((msg) => {
    if (msg.role !== 'assistant') return true
    const isEmpty = !msg.content?.trim() && (!msg.toolCalls || msg.toolCalls.length === 0)
    if (!isEmpty) return true
    // Half-baked (aborted mid-thinking) assistant messages: keep only when their
    // thinking block will actually be echoed back. Providers with
    // sendReasoningInMessages=false (e.g. Mistral) reject empty-content
    // assistant messages, so keep filtering those out.
    return Boolean(msg.thinkingContent && sendReasoningInMessages !== false)
  })

  const result: ChatCompletionMessageParam[] = []
  for (const msg of filtered) {
    if (msg.role === 'tool') {
      if (msg.attachments && msg.attachments.length > 0) {
        const content = await buildAttachmentContent(msg.content, msg.attachments, modelSupportsVision)
        result.push({
          role: 'tool',
          content,
          tool_call_id: msg.toolCallId!,
        } as ChatCompletionMessageParam)
      } else {
        result.push({
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.toolCallId!,
        })
      }
    } else if (msg.role === 'assistant') {
      result.push(
        buildAssistantMessage(
          msg,
          thinkingField,
          sendReasoningInMessages,
          inlineThinking,
        ) as unknown as ChatCompletionMessageParam,
      )
    } else if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
      const content = await buildAttachmentContent(msg.content, msg.attachments, modelSupportsVision)
      result.push({
        role: 'user',
        content,
      })
    } else {
      result.push({
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content,
      })
    }
  }
  return result
}

export function convertTools(tools: LLMToolDefinition[]): ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: sanitizeToolSchema(tool.function.parameters),
    },
  }))
}

async function buildChatCompletionCreateParams(
  model: string,
  request: LLMCompletionRequest,
  profile: MinimalProfile,
  capabilities: MinimalCapabilities,
  reasoningEffort: ReasoningEffort | undefined,
  isStreaming: boolean,
  thinkingField?: string,
  sendReasoningInMessages?: boolean,
  apiProtocol?: 'chat-completions' | 'responses',
): Promise<{
  params: ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming
  modelParams: ModelParams
}> {
  const userVisionOverride = request.modelSettings?.supportsVision
  const modelSupportsVision = userVisionOverride ?? profile.supportsVision ?? false
  // DeepSeek-style providers (reasoning_content) only concatenate the reasoning
  // field into context when the request carries tools. Without tools, inline
  // the CoT into the assistant content so the model retains it across turns.
  const inlineThinking = thinkingField === 'reasoning_content' && !request.tools?.length
  const convertedMessages = await convertMessages(
    request.messages,
    modelSupportsVision,
    thinkingField,
    sendReasoningInMessages,
    inlineThinking,
  )

  const temperature = request.modelSettings?.temperature ?? request.temperature ?? profile.temperature
  const maxTokens = request.modelSettings?.maxTokens ?? request.maxTokens ?? profile.defaultMaxTokens
  const topP = request.modelSettings?.topP ?? profile.topP
  const topK = capabilities.supportsTopK ? profile.topK : undefined

  const params: ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming = {
    model,
    messages: convertedMessages,
    ...(request.tools?.length ? { tools: convertTools(request.tools) } : {}),
    ...(request.toolChoice ? { tool_choice: request.toolChoice as ChatCompletionToolChoiceOption } : {}),
    temperature,
    ...(capabilities.usesMaxCompletionTokens ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
    ...(topP !== undefined && { top_p: topP }),
    stream: isStreaming,
    ...(isStreaming ? { stream_options: { include_usage: true } } : {}),
  }

  if (topK !== undefined) {
    ;(params as unknown as Record<string, unknown>)['top_k'] = topK
  }

  // Ollama's OpenAI-compatible endpoint cannot request a larger context (it
  // silently truncates prompts to its 4096-token default, dropping the user
  // message). The num_ctx-capable backend talks to the native /api/chat
  // endpoint which consumes this field via options.num_ctx.
  if (capabilities.supportsNumCtx && request.modelSettings?.numCtx) {
    ;(params as unknown as Record<string, unknown>)['num_ctx'] = request.modelSettings.numCtx
  }

  let resolvedEffort = reasoningEffort ?? request.reasoningEffort
  // Responses-class models (e.g. OpenAI gpt-5) reject any reasoning_effort
  // other than "none" when the request carries function tools — but only on
  // /v1/chat/completions; the Responses API supports tools + effort together.
  // When such a model is bound for chat completions (non-openai backend or an
  // explicit override), clamp the effort so agentic (tool-using) calls work.
  if (request.tools?.length && apiProtocol !== 'responses' && profile.apiProtocol === 'responses') {
    resolvedEffort = 'none'
  }

  const queryParams = request.modelSettings?.queryParams as Record<string, unknown> | undefined
  const hasQueryParams = queryParams && Object.keys(queryParams).length > 0
  const hasExplicitModelSettings = hasQueryParams || !!request.modelSettings?.chatTemplateKwargs

  if (capabilities.routesEffortViaChatTemplateKwargs) {
    // llama.cpp only reads reasoning_effort from chat_template_kwargs (Jinja
    // template variables); a top-level body field is silently ignored.
    let userKwargs: Record<string, unknown> | undefined = request.modelSettings?.chatTemplateKwargs
    if (hasQueryParams) {
      // Merge the user's explicit queryParams, but route chat_template_kwargs
      // separately so the resolved effort can be layered onto it.
      const { chat_template_kwargs: userKwargsFromQP, ...restQueryParams } = queryParams as Record<string, unknown>
      Object.assign(params as unknown as Record<string, unknown>, restQueryParams)
      if (userKwargsFromQP) {
        userKwargs = userKwargsFromQP as Record<string, unknown>
      }
    }
    const kwargs: Record<string, unknown> = { ...(userKwargs ?? {}) }
    if (resolvedEffort === 'none') {
      // 'none' is the universal "thinking off" switch. Official Qwen templates
      // reject reasoning_effort:'none' (400), so express it as enable_thinking.
      delete kwargs['reasoning_effort']
      kwargs['enable_thinking'] = false
    } else if (resolvedEffort && kwargs['reasoning_effort'] === undefined) {
      kwargs['reasoning_effort'] = resolvedEffort
    }
    if (Object.keys(kwargs).length > 0) {
      ;(params as unknown as Record<string, unknown>)['chat_template_kwargs'] = kwargs
    }
  } else if (hasQueryParams) {
    // queryParams are the user's explicit config — merge into params
    Object.assign(params as unknown as Record<string, unknown>, queryParams)
    // reasoning_effort from client config supersedes queryParams (user-set thinkingLevel wins)
    if (resolvedEffort) {
      ;(params as unknown as Record<string, unknown>)['reasoning_effort'] = resolvedEffort
    }
  } else if (hasExplicitModelSettings) {
    // User provided explicit chatTemplateKwargs — use as-is, no reasoning_effort injected
    const chatTemplateKwargs = request.modelSettings!.chatTemplateKwargs
    if (chatTemplateKwargs) {
      ;(params as unknown as Record<string, unknown>)['chat_template_kwargs'] = chatTemplateKwargs
    }
  } else {
    // No explicit model settings — apply reasoning_effort from client config if set
    if (resolvedEffort) {
      ;(params as unknown as Record<string, unknown>)['reasoning_effort'] = resolvedEffort
    }

    // Only inject chat_template_kwargs when the request explicitly asks for
    // reasoning (per-request), not when it comes from the client config alone.
    // This prevents session model thinking config from leaking into requests
    // to override models (sub-agent model overrides to different providers).
    if (request.reasoningEffort && capabilities.supportsChatTemplateKwargs) {
      ;(params as unknown as Record<string, unknown>)['chat_template_kwargs'] = {
        enable_thinking: true,
      }
    }
  }

  // Strip params the model rejects (some hosted models reject certain sampling params).
  // Runs after all merges so it wins over queryParams additions.
  const omitParams = request.modelSettings?.omitParams
  if (omitParams && omitParams.length > 0) {
    const paramRecord = params as unknown as Record<string, unknown>
    for (const key of omitParams) {
      delete paramRecord[key]
    }
  }

  // modelParams feed stats and the truncation-retry budget — align them with
  // the actual wire request so omitted params aren't reported as sent.
  const modelParams = buildModelParams({
    temperature,
    topP,
    topK,
    maxTokens,
    ...(omitParams !== undefined && { omitParams }),
  })

  return { params, modelParams }
}

async function buildCreateParamsFromInput<
  T extends ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming,
>(
  input: {
    model: string
    request: LLMCompletionRequest
    profile: MinimalProfile
    capabilities: MinimalCapabilities
    reasoningEffort?: ReasoningEffort
    thinkingField?: string
    sendReasoningInMessages?: boolean
    apiProtocol?: 'chat-completions' | 'responses'
  },
  isStreaming: boolean,
): Promise<{ params: T; modelParams: ModelParams }> {
  const {
    model,
    request,
    profile,
    capabilities,
    reasoningEffort,
    thinkingField,
    sendReasoningInMessages,
    apiProtocol,
  } = input
  return buildChatCompletionCreateParams(
    model,
    request,
    profile,
    capabilities,
    reasoningEffort,
    isStreaming,
    thinkingField,
    sendReasoningInMessages,
    apiProtocol,
  ) as Promise<{ params: T; modelParams: ModelParams }>
}

export const buildNonStreamingCreateParams = (input: Parameters<typeof buildCreateParamsFromInput>[0]) =>
  buildCreateParamsFromInput<ChatCompletionCreateParamsNonStreaming>(input, false)

export const buildStreamingCreateParams = (input: Parameters<typeof buildCreateParamsFromInput>[0]) =>
  buildCreateParamsFromInput<ChatCompletionCreateParamsStreaming>(input, true)

export function mapFinishReason(reason: string | null): LLMCompletionResponse['finishReason'] {
  switch (reason) {
    case 'stop':
      return 'stop'
    case 'tool_calls':
      return 'tool_calls'
    case 'length':
      return 'length'
    case 'content_filter':
      return 'content_filter'
    default:
      return 'stop'
  }
}
