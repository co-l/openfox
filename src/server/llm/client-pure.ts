import type OpenAI from 'openai'
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
} from 'openai/resources/chat/completions'
import type { LLMCompletionRequest, LLMCompletionResponse, LLMMessage, LLMToolDefinition } from './types.js'
import type { ModelProfile } from './profiles.js'
import type { BackendCapabilities } from './backend.js'
import { describeImageFromDataUrl } from './vision-fallback.js'
import { logger } from '../utils/logger.js'

type AttachmentContent = Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>

function buildAttachmentContent(
  msgContent: string | null | undefined,
  attachments: { data: string; filename?: string }[],
  modelSupportsVision: boolean
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
type MinimalProfile = Pick<ModelProfile, 'temperature' | 'defaultMaxTokens' | 'topP' | 'topK' | 'supportsReasoning' | 'supportsVision'>

async function convertMessagesWithOptions(
  messages: LLMMessage[],
  profile: MinimalProfile,
  visionFallbackEnabled: boolean,
  signal?: AbortSignal | undefined,
  onVisionFallbackStart?: ((attachmentId: string, filename?: string) => void) | undefined,
  onVisionFallbackDone?: ((attachmentId: string, description: string) => void) | undefined
): Promise<ChatCompletionMessageParam[]> {
  const modelSupportsVision = profile.supportsVision ?? false
  const options: ConvertMessagesOptions = {
    modelSupportsVision,
    visionFallbackEnabled,
    signal,
    onVisionFallbackStart,
    onVisionFallbackDone,
  }
  return needsVisionFallback(messages, modelSupportsVision, visionFallbackEnabled)
    ? await convertMessagesWithFallback(messages, options)
    : convertMessages(messages, { modelSupportsVision, visionFallbackEnabled: false })
}

export interface ConvertMessagesOptions {
  modelSupportsVision: boolean
  visionFallbackEnabled: boolean
  signal?: AbortSignal | undefined
  onVisionFallbackStart?: ((attachmentId: string, filename?: string) => void) | undefined
  onVisionFallbackDone?: ((attachmentId: string, description: string) => void) | undefined
}

function convertToolCalls(
  toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[]
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

function convertAttachmentSync(
  attachment: { data: string; filename?: string },
  modelSupportsVision: boolean
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

function createAttachmentForConversion(
  data: string,
  filename?: string,
  id?: string
): { data: string; filename?: string; id?: string } {
  return {
    data,
    ...(filename !== undefined && { filename }),
    ...(id !== undefined && { id }),
  }
}

async function convertAttachmentWithFallback(
  attachment: { data: string; filename?: string; id?: string },
  options: ConvertMessagesOptions
): Promise<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> {
  logger.debug('[VisionFallback] convertAttachmentWithFallback called', { filename: attachment.filename, id: attachment.id, hasCallbacks: !!options.onVisionFallbackStart })

  if (options.modelSupportsVision) {
    logger.debug('[VisionFallback] Model supports vision - passing image directly')
    return {
      type: 'image_url',
      image_url: { url: attachment.data },
    }
  }

  if (!options.visionFallbackEnabled) {
    logger.debug('[VisionFallback] Fallback disabled - returning placeholder')
    return {
      type: 'text',
      text: `[Image: ${attachment.filename || 'image'}] (vision not supported)`,
    }
  }

  const attachmentId = attachment.id ?? crypto.randomUUID()
  const filename = attachment.filename

  logger.debug('[VisionFallback] Starting delegation for:', { attachmentId, filename })
  options.onVisionFallbackStart?.(attachmentId, filename)

  const context = filename ? `File: ${filename}` : undefined
  const description = await describeImageFromDataUrl(attachment.data, { context, signal: options.signal })

  logger.debug('[VisionFallback] Delegation complete:', { attachmentId, descriptionLength: description.length })
  options.onVisionFallbackDone?.(attachmentId, description)

  return {
    type: 'text',
    text: `[Image: ${attachment.filename || 'image'}] ${description}`,
  }
}

type AttachmentContentWithFallback = Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>

async function buildAttachmentContentWithFallback(
  msgContent: string | null | undefined,
  attachments: { data: string; filename?: string; id?: string }[],
  options: ConvertMessagesOptions
): Promise<AttachmentContentWithFallback> {
  const content: AttachmentContentWithFallback = []
  if (msgContent?.trim()) {
    content.push({ type: 'text', text: msgContent })
  }
  for (const attachment of attachments) {
    const convertedContent = await convertAttachmentWithFallback(
      createAttachmentForConversion(attachment.data, attachment.filename, attachment.id),
      options
    )
    content.push(convertedContent)
  }
  return content
}

export function convertMessages(
  messages: LLMMessage[],
  options: ConvertMessagesOptions
): ChatCompletionMessageParam[] {
  const filtered = messages.filter((msg) => {
    return !(msg.role === 'assistant' && !msg.content?.trim() && (!msg.toolCalls || msg.toolCalls.length === 0))
  })

  return filtered.map((msg): ChatCompletionMessageParam => {
    if (msg.role === 'tool') {
      if (msg.attachments && msg.attachments.length > 0) {
        const content = buildAttachmentContent(msg.content, msg.attachments, options.modelSupportsVision)
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

    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      return {
        role: 'assistant',
        content: msg.content || null,
        tool_calls: convertToolCalls(msg.toolCalls),
      }
    }

    if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
      const content = buildAttachmentContent(msg.content, msg.attachments, options.modelSupportsVision)
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

export async function convertMessagesWithFallback(
  messages: LLMMessage[],
  options: ConvertMessagesOptions
): Promise<ChatCompletionMessageParam[]> {
  logger.debug('[VisionFallback] convertMessagesWithFallback called', { messageCount: messages.length })
  const filtered = messages.filter((msg) => {
    return !(msg.role === 'assistant' && !msg.content?.trim() && (!msg.toolCalls || msg.toolCalls.length === 0))
  })

  const converted: ChatCompletionMessageParam[] = []

  for (const msg of filtered) {
    if (msg.role === 'tool') {
      if (msg.attachments && msg.attachments.length > 0) {
        const content = await buildAttachmentContentWithFallback(msg.content, msg.attachments, options)
        converted.push({
          role: 'tool',
          content,
          tool_call_id: msg.toolCallId!,
        } as ChatCompletionMessageParam)
      } else {
        converted.push({
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.toolCallId!,
        })
      }
      continue
    }

    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      converted.push({
        role: 'assistant',
        content: msg.content || null,
        tool_calls: convertToolCalls(msg.toolCalls),
      })
      continue
    }

    if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
      const content = await buildAttachmentContentWithFallback(msg.content, msg.attachments, options)
      converted.push({
        role: 'user',
        content,
      })
      continue
    }

    converted.push({
      role: msg.role as 'system' | 'user' | 'assistant',
      content: msg.content,
    })
  }

  return converted
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

function needsVisionFallback(messages: LLMMessage[], modelSupportsVision: boolean, visionFallbackEnabled: boolean): boolean {
  const hasAttachments = messages.some(
    msg => (msg.attachments && msg.attachments.length > 0) ||
           (msg.role === 'tool' && msg.attachments && msg.attachments.length > 0)
  )
  const result = hasAttachments && !modelSupportsVision && visionFallbackEnabled
  logger.debug('[VisionFallback] needsVisionFallback check', {
    hasAttachments,
    modelSupportsVision,
    visionFallbackEnabled,
    result
  })
  return result
}

export async function buildNonStreamingCreateParams(input: {
  model: string
  request: LLMCompletionRequest
  profile: MinimalProfile
  capabilities: MinimalCapabilities
  disableThinking?: boolean
  visionFallbackEnabled?: boolean
  onVisionFallbackStart?: ((attachmentId: string, filename?: string) => void) | undefined
  onVisionFallbackDone?: ((attachmentId: string, description: string) => void) | undefined
}): Promise<OpenAI.ChatCompletionCreateParamsNonStreaming> {
  const { model, request, profile, capabilities, disableThinking, visionFallbackEnabled = false, onVisionFallbackStart, onVisionFallbackDone } = input

  const convertedMessages = await convertMessagesWithOptions(
    request.messages,
    profile,
    visionFallbackEnabled,
    request.signal,
    onVisionFallbackStart,
    onVisionFallbackDone
  )

  const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
    model,
    messages: convertedMessages,
    ...(request.tools ? { tools: convertTools(request.tools) } : {}),
    ...(request.toolChoice ? { tool_choice: request.toolChoice as ChatCompletionToolChoiceOption } : {}),
    temperature: request.temperature ?? profile.temperature,
    max_tokens: request.maxTokens ?? profile.defaultMaxTokens,
    top_p: profile.topP,
    stream: false,
  }

  if (capabilities.supportsTopK && profile.topK !== undefined) {
    ;(params as unknown as Record<string, unknown>)['top_k'] = profile.topK
  }

  if (capabilities.supportsChatTemplateKwargs && profile.supportsReasoning && disableThinking) {
    ;(params as unknown as Record<string, unknown>)['chat_template_kwargs'] = { enable_thinking: false }
  }

  return params
}

export async function buildStreamingCreateParams(input: {
  model: string
  request: LLMCompletionRequest
  profile: MinimalProfile
  capabilities: MinimalCapabilities
  disableThinking: boolean
  visionFallbackEnabled?: boolean
  onVisionFallbackStart?: ((attachmentId: string, filename?: string) => void) | undefined
  onVisionFallbackDone?: ((attachmentId: string, description: string) => void) | undefined
}): Promise<OpenAI.ChatCompletionCreateParamsStreaming> {
  const { model, request, profile, capabilities, disableThinking, visionFallbackEnabled = false, onVisionFallbackStart, onVisionFallbackDone } = input

  const convertedMessages = await convertMessagesWithOptions(
    request.messages,
    profile,
    visionFallbackEnabled,
    request.signal,
    onVisionFallbackStart,
    onVisionFallbackDone
  )

  const params: OpenAI.ChatCompletionCreateParamsStreaming = {
    model,
    messages: convertedMessages,
    ...(request.tools ? { tools: convertTools(request.tools) } : {}),
    ...(request.toolChoice ? { tool_choice: request.toolChoice as ChatCompletionToolChoiceOption } : {}),
    temperature: request.temperature ?? profile.temperature,
    max_tokens: request.maxTokens ?? profile.defaultMaxTokens,
    top_p: profile.topP,
    stream: true,
    stream_options: { include_usage: true },
  }

  if (capabilities.supportsTopK && profile.topK !== undefined) {
    ;(params as unknown as Record<string, unknown>)['top_k'] = profile.topK
  }

  if (capabilities.supportsChatTemplateKwargs && profile.supportsReasoning && (disableThinking || request.disableThinking)) {
    ;(params as unknown as Record<string, unknown>)['chat_template_kwargs'] = { enable_thinking: false }
  }

  return params
}

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

export function extractThinking(content: string): { content: string; thinkingContent: string | null } {
  const thinkRegex = /<think>([\s\S]*?)<\/think>/g
  let thinkingContent = ''
  let cleanContent = content

  let match: RegExpExecArray | null
  while ((match = thinkRegex.exec(content)) !== null) {
    thinkingContent += match[1]
    cleanContent = cleanContent.replace(match[0], '')
  }

  return {
    content: cleanContent.trim(),
    thinkingContent: thinkingContent.trim() || null,
  }
}
