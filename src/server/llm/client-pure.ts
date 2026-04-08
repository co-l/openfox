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

type MinimalCapabilities = Pick<BackendCapabilities, 'supportsTopK' | 'supportsChatTemplateKwargs'>
type MinimalProfile = Pick<ModelProfile, 'temperature' | 'defaultMaxTokens' | 'topP' | 'topK' | 'supportsReasoning' | 'supportsVision'>

export interface ConvertMessagesOptions {
  modelSupportsVision: boolean
  visionFallbackEnabled: boolean
  onVisionFallbackStart?: ((attachmentId: string, filename?: string) => void) | undefined
  onVisionFallbackDone?: ((attachmentId: string, description: string) => void) | undefined
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
  const description = await describeImageFromDataUrl(attachment.data, context ? { context } : {})

  logger.debug('[VisionFallback] Delegation complete:', { attachmentId, descriptionLength: description.length })
  options.onVisionFallbackDone?.(attachmentId, description)

  return {
    type: 'text',
    text: `[Image: ${attachment.filename || 'image'}] ${description}`,
  }
}

export function convertMessages(
  messages: LLMMessage[],
  options: ConvertMessagesOptions
): ChatCompletionMessageParam[] {
  const filtered = messages.filter((msg) => {
    return !(msg.role === 'assistant' && !msg.content?.trim() && (!msg.toolCalls || msg.toolCalls.length === 0))
  })

  const removedAssistantToolCallIds = messages
    .filter((msg) => msg.role === 'assistant' && !msg.content?.trim() && msg.toolCalls && msg.toolCalls.length > 0)
    .flatMap((msg) => msg.toolCalls!.map((tc) => tc.id))

  const finalMessages = removedAssistantToolCallIds.length > 0
    ? filtered.filter((msg) => msg.role !== 'tool' || !removedAssistantToolCallIds.includes(msg.toolCallId!))
    : filtered

  return finalMessages.map((msg): ChatCompletionMessageParam => {
    if (msg.role === 'tool') {
      if (msg.attachments && msg.attachments.length > 0) {
        const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = []
        if (msg.content?.trim()) {
          content.push({ type: 'text', text: msg.content })
        }
        for (const attachment of msg.attachments) {
          content.push(convertAttachmentSync(attachment, options.modelSupportsVision))
        }
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
        tool_calls: msg.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: 'function',
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments),
          },
        })),
      }
    }

    if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
      const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = []

      if (msg.content?.trim()) {
        content.push({ type: 'text', text: msg.content })
      }

      for (const attachment of msg.attachments) {
        content.push(convertAttachmentSync(attachment, options.modelSupportsVision))
      }

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

  const removedAssistantToolCallIds = messages
    .filter((msg) => msg.role === 'assistant' && !msg.content?.trim() && msg.toolCalls && msg.toolCalls.length > 0)
    .flatMap((msg) => msg.toolCalls!.map((tc) => tc.id))

  const finalMessages = removedAssistantToolCallIds.length > 0
    ? filtered.filter((msg) => msg.role !== 'tool' || !removedAssistantToolCallIds.includes(msg.toolCallId!))
    : filtered

  const converted: ChatCompletionMessageParam[] = []

  for (const msg of finalMessages) {
    if (msg.role === 'tool') {
      if (msg.attachments && msg.attachments.length > 0) {
        const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = []
        if (msg.content?.trim()) {
          content.push({ type: 'text', text: msg.content })
        }
        for (const attachment of msg.attachments) {
          const convertedContent = await convertAttachmentWithFallback(
            { data: attachment.data, filename: attachment.filename, id: attachment.id },
            options
          )
          content.push(convertedContent)
        }
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
        tool_calls: msg.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: 'function',
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments),
          },
        })),
      })
      continue
    }

    if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
      const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = []

      if (msg.content?.trim()) {
        content.push({ type: 'text', text: msg.content })
      }

      for (const attachment of msg.attachments) {
        const convertedContent = await convertAttachmentWithFallback(
          { data: attachment.data, filename: attachment.filename, id: attachment.id },
          options
        )
        content.push(convertedContent)
      }

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

  const messages = request.messages
  const modelSupportsVision = profile.supportsVision ?? false
  const options: ConvertMessagesOptions = {
    modelSupportsVision,
    visionFallbackEnabled,
    onVisionFallbackStart,
    onVisionFallbackDone,
  }

  const convertedMessages = needsVisionFallback(messages, modelSupportsVision, visionFallbackEnabled)
    ? await convertMessagesWithFallback(messages, options)
    : convertMessages(messages, { modelSupportsVision, visionFallbackEnabled: false })

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
  const messages = request.messages
  const modelSupportsVision = profile.supportsVision ?? false
  const options: ConvertMessagesOptions = { modelSupportsVision, visionFallbackEnabled, onVisionFallbackStart, onVisionFallbackDone }

  const convertedMessages = needsVisionFallback(messages, modelSupportsVision, visionFallbackEnabled)
    ? await convertMessagesWithFallback(messages, options)
    : convertMessages(messages, { modelSupportsVision, visionFallbackEnabled: false })

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
