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
import { extractPdfFromDataUrl, extractPdfBlocksFromDataUrl } from './resolve-attachments.js'

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
}): ModelParams {
  return {
    ...(params.temperature !== undefined && { temperature: params.temperature }),
    ...(params.topP !== undefined && { topP: params.topP }),
    ...(params.topK !== undefined && { topK: params.topK }),
    ...(params.maxTokens !== undefined && { maxTokens: params.maxTokens }),
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

type MinimalCapabilities = Pick<BackendCapabilities, 'supportsTopK' | 'supportsChatTemplateKwargs'>
type MinimalProfile = Pick<ModelProfile, 'temperature' | 'defaultMaxTokens' | 'topP' | 'topK' | 'supportsVision'>

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

function buildAssistantMessage(msg: LLMMessage, thinkingField?: string): Record<string, unknown> {
  const result: Record<string, unknown> = {
    role: 'assistant',
    content: msg.toolCalls?.length ? msg.content || '' : msg.content || null,
  }
  if (msg.toolCalls?.length) {
    result['tool_calls'] = convertToolCalls(msg.toolCalls)
  }
  if (msg.thinkingContent) {
    result[thinkingField ?? 'reasoning'] = msg.thinkingContent
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
    return [
      { type: 'text', text: `[Image: ${attachment.filename || 'image'} - description: ${attachment.description}]` },
    ]
  }

  return [{ type: 'text', text: `[Image: ${attachment.filename || 'image'}] (vision not supported, cannot describe)` }]
}

export async function convertMessages(
  messages: LLMMessage[],
  modelSupportsVision: boolean,
  thinkingField?: string,
): Promise<ChatCompletionMessageParam[]> {
  const filtered = messages.filter((msg) => {
    return !(msg.role === 'assistant' && !msg.content?.trim() && (!msg.toolCalls || msg.toolCalls.length === 0))
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
      result.push(buildAssistantMessage(msg, thinkingField) as unknown as ChatCompletionMessageParam)
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
  params: ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming
  modelParams: ModelParams
}> {
  const userVisionOverride = request.modelSettings?.supportsVision
  const modelSupportsVision = userVisionOverride ?? profile.supportsVision ?? false
  const convertedMessages = await convertMessages(request.messages, modelSupportsVision, thinkingField)

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
    max_tokens: maxTokens,
    top_p: topP,
    stream: isStreaming,
    ...(isStreaming ? { stream_options: { include_usage: true } } : {}),
  }

  if (topK !== undefined) {
    ;(params as unknown as Record<string, unknown>)['top_k'] = topK
  }

  const resolvedEffort = reasoningEffort ?? request.reasoningEffort

  const queryParams = request.modelSettings?.queryParams as Record<string, unknown> | undefined
  const hasQueryParams = queryParams && Object.keys(queryParams).length > 0
  const hasExplicitModelSettings = hasQueryParams || !!request.modelSettings?.chatTemplateKwargs

  if (hasQueryParams) {
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

    if (resolvedEffort && capabilities.supportsChatTemplateKwargs) {
      ;(params as unknown as Record<string, unknown>)['chat_template_kwargs'] = {
        enable_thinking: true,
      }
    }
  }

  const modelParams = buildModelParams({ temperature, topP, topK, maxTokens })

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
