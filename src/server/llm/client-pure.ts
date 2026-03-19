import type OpenAI from 'openai'
import type { ChatCompletionMessageParam, ChatCompletionTool, ChatCompletionToolChoiceOption } from 'openai/resources/chat/completions'
import type { LLMCompletionRequest, LLMCompletionResponse, LLMMessage, LLMToolDefinition } from './types.js'
import type { ModelProfile } from './profiles.js'
import type { BackendCapabilities } from './backend.js'
import { logger } from '../utils/logger.js'

type MinimalCapabilities = Pick<BackendCapabilities, 'supportsTopK' | 'supportsChatTemplateKwargs'>
type MinimalProfile = Pick<ModelProfile, 'temperature' | 'defaultMaxTokens' | 'topP' | 'topK' | 'supportsReasoning'>

export function convertMessages(messages: LLMMessage[]): ChatCompletionMessageParam[] {
  const filtered = messages.filter((msg) => {
    if (msg.role === 'assistant' && !msg.content?.trim() && !msg.toolCalls?.length) {
      logger.warn('Filtering empty assistant message from LLM context')
      return false
    }
    return true
  })

  return filtered.map((msg): ChatCompletionMessageParam => {
    if (msg.role === 'tool') {
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

    // Handle user messages with attachments
    if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
      const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = []
      
      // Add text content if present
      if (msg.content?.trim()) {
        content.push({ type: 'text', text: msg.content })
      }
      
      // Add attachments as image URLs
      for (const attachment of msg.attachments) {
        content.push({
          type: 'image_url',
          image_url: {
            url: attachment.data, // base64 data URL
          },
        })
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

export function buildNonStreamingCreateParams(input: {
  model: string
  request: LLMCompletionRequest
  profile: MinimalProfile
  capabilities: Pick<BackendCapabilities, 'supportsTopK'>
}): OpenAI.ChatCompletionCreateParamsNonStreaming {
  const { model, request, profile, capabilities } = input
  const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
    model,
    messages: convertMessages(request.messages),
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

  return params
}

export function buildStreamingCreateParams(input: {
  model: string
  request: LLMCompletionRequest
  profile: MinimalProfile
  capabilities: MinimalCapabilities
  disableThinking: boolean
}): OpenAI.ChatCompletionCreateParamsStreaming {
  const { model, request, profile, capabilities, disableThinking } = input
  const params: OpenAI.ChatCompletionCreateParamsStreaming = {
    model,
    messages: convertMessages(request.messages),
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

  if (capabilities.supportsChatTemplateKwargs && profile.supportsReasoning && (request.enableThinking === false || disableThinking)) {
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
