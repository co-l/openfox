import type OpenAI from 'openai'
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
} from 'openai/resources/chat/completions'
import type {
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMMessage,
  LLMToolDefinition,
  ReasoningEffort,
} from './types.js'
import type { ModelProfile } from './profiles.js'
import type { BackendCapabilities } from './backend.js'

export interface ModelParams {
  temperature?: number
  topP?: number
  topK?: number
  maxTokens?: number
}

export function buildModelParams(params: {
  temperature?: number
  topP?: number
  topK?: number | undefined
  maxTokens?: number
}): ModelParams {
  return {
    ...(params.temperature !== undefined && { temperature: params.temperature }),
    ...(params.topP !== undefined && { topP: params.topP }),
    ...(params.topK !== undefined && { topK: params.topK }),
    ...(params.maxTokens !== undefined && { maxTokens: params.maxTokens }),
  }
}

type AttachmentContent = Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>

function buildAttachmentContent(
  msgContent: string | null | undefined,
  attachments: { data: string; filename?: string }[],
  modelSupportsVision: boolean,
): AttachmentContent {
  const content: AttachmentContent = []
  if (msgContent?.trim()) {
    content.push({ type: 'text', text: msgContent })
  }
  for (const attachment of attachments) {
    content.push(convertAttachmentSync(attachment, modelSupportsVision))
  }
  return content
}

type MinimalCapabilities = Pick<BackendCapabilities, 'supportsTopK' | 'supportsChatTemplateKwargs'>
type MinimalProfile = Pick<ModelProfile, 'temperature' | 'defaultMaxTokens' | 'topP' | 'topK' | 'supportsVision'>

function convertToolCalls(
  toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[],
): OpenAI.ChatCompletionMessageToolCall[] {
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

function buildAssistantMessage(msg: LLMMessage, thinkingField?: string): Record<string, unknown> {
  const result: Record<string, unknown> = {
    role: 'assistant',
    content: msg.content || null,
  }
  if (msg.toolCalls?.length) {
    result['tool_calls'] = convertToolCalls(msg.toolCalls)
  }
  if (msg.thinkingContent) {
    result[thinkingField ?? 'reasoning'] = msg.thinkingContent
  }
  return result
}

function convertAttachmentSync(
  attachment: { data: string; filename?: string },
  modelSupportsVision: boolean,
): { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } } {
  if (modelSupportsVision) {
    return {
      type: 'image_url',
      image_url: { url: attachment.data },
    }
  }

  return {
    type: 'text',
    text: `[Image: ${attachment.filename || 'image'}] (vision not supported, cannot describe)`,
  }
}

export function convertMessages(
  messages: LLMMessage[],
  modelSupportsVision: boolean,
  thinkingField?: string,
): ChatCompletionMessageParam[] {
  const filtered = messages.filter((msg) => {
    return !(msg.role === 'assistant' && !msg.content?.trim() && (!msg.toolCalls || msg.toolCalls.length === 0))
  })

  return filtered.map((msg): ChatCompletionMessageParam => {
    if (msg.role === 'tool') {
      if (msg.attachments && msg.attachments.length > 0) {
        const content = buildAttachmentContent(msg.content, msg.attachments, modelSupportsVision)
        return {
          role: 'tool',
          content,
          tool_call_id: msg.toolCallId!,
        } as ChatCompletionMessageParam
      }
      return {
        role: 'tool',
        content: msg.content,
        tool_call_id: msg.toolCallId!,
      }
    }

    if (msg.role === 'assistant') {
      return buildAssistantMessage(msg, thinkingField) as unknown as ChatCompletionMessageParam
    }

    if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
      const content = buildAttachmentContent(msg.content, msg.attachments, modelSupportsVision)
      return {
        role: 'user',
        content,
      }
    }

    return {
      role: msg.role as 'system' | 'user' | 'assistant',
      content: msg.content,
    }
  })
}

export function convertTools(tools: LLMToolDefinition[]): ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
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
): Promise<{
  params: OpenAI.ChatCompletionCreateParamsNonStreaming | OpenAI.ChatCompletionCreateParamsStreaming
  modelParams: ModelParams
}> {
  const userVisionOverride = request.modelSettings?.supportsVision
  const modelSupportsVision = userVisionOverride ?? profile.supportsVision ?? false
  const convertedMessages = convertMessages(request.messages, modelSupportsVision, thinkingField)

  const temperature = request.modelSettings?.temperature ?? request.temperature ?? profile.temperature
  const maxTokens = request.modelSettings?.maxTokens ?? request.maxTokens ?? profile.defaultMaxTokens
  const topP = request.modelSettings?.topP ?? profile.topP
  const topK = capabilities.supportsTopK ? profile.topK : undefined

  const params: OpenAI.ChatCompletionCreateParamsNonStreaming | OpenAI.ChatCompletionCreateParamsStreaming = {
    model,
    messages: convertedMessages,
    ...(request.tools?.length ? { tools: convertTools(request.tools) } : {}),
    ...(request.toolChoice ? { tool_choice: request.toolChoice as ChatCompletionToolChoiceOption } : {}),
    temperature,
    max_tokens: maxTokens,
    top_p: topP,
    stream: isStreaming,
    ...(isStreaming ? { stream_options: { include_usage: true } } : {}),
  }

  if (topK !== undefined) {
    ;(params as unknown as Record<string, unknown>)['top_k'] = topK
  }

  const resolvedEffort = reasoningEffort ?? request.reasoningEffort

  if (resolvedEffort) {
    ;(params as unknown as Record<string, unknown>)['reasoning_effort'] = resolvedEffort

    const chatTemplateKwargs = request.modelSettings?.chatTemplateKwargs
    if (chatTemplateKwargs) {
      ;(params as unknown as Record<string, unknown>)['chat_template_kwargs'] = chatTemplateKwargs
    } else if (capabilities.supportsChatTemplateKwargs) {
      ;(params as unknown as Record<string, unknown>)['chat_template_kwargs'] = {
        enable_thinking: resolvedEffort !== 'none',
      }
    }
  }

  const modelParams = buildModelParams({ temperature, topP, topK, maxTokens })

  return { params, modelParams }
}

async function buildCreateParamsFromInput<
  T extends OpenAI.ChatCompletionCreateParamsNonStreaming | OpenAI.ChatCompletionCreateParamsStreaming,
>(
  input: {
    model: string
    request: LLMCompletionRequest
    profile: MinimalProfile
    capabilities: MinimalCapabilities
    reasoningEffort?: ReasoningEffort
    thinkingField?: string
  },
  isStreaming: boolean,
): Promise<{ params: T; modelParams: ModelParams }> {
  const { model, request, profile, capabilities, reasoningEffort, thinkingField } = input
  return buildChatCompletionCreateParams(
    model,
    request,
    profile,
    capabilities,
    reasoningEffort,
    isStreaming,
    thinkingField,
  ) as Promise<{ params: T; modelParams: ModelParams }>
}

export const buildNonStreamingCreateParams = (input: Parameters<typeof buildCreateParamsFromInput>[0]) =>
  buildCreateParamsFromInput<OpenAI.ChatCompletionCreateParamsNonStreaming>(input, false)

export const buildStreamingCreateParams = (input: Parameters<typeof buildCreateParamsFromInput>[0]) =>
  buildCreateParamsFromInput<OpenAI.ChatCompletionCreateParamsStreaming>(input, true)

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
