import OpenAI from 'openai'
import type { ChatCompletionMessageParam, ChatCompletionTool, ChatCompletionToolChoiceOption } from 'openai/resources/chat/completions'
import type { Config } from '../config.js'
import type {
  LLMClient,
  LLMMessage,
  LLMToolDefinition,
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMStreamEvent,
} from './types.js'
import type { ToolCall } from '@openfox/shared'
import { logger } from '../utils/logger.js'
import { LLMError } from '../utils/errors.js'
import { getModelProfile, type ModelProfile } from './profiles.js'

export interface LLMClientWithModel extends LLMClient {
  getModel(): string
  setModel(model: string): void
  getProfile(): ModelProfile
}

export function createLLMClient(config: Config): LLMClientWithModel {
  const openai = new OpenAI({
    baseURL: config.vllm.baseUrl,
    apiKey: 'not-needed', // vLLM doesn't require API key
    timeout: config.vllm.timeout,
  })
  
  let model = config.vllm.model
  let profile = getModelProfile(model)
  const disableThinking = config.vllm.disableThinking ?? false
  
  return {
    getModel() {
      return model
    },
    
    getProfile() {
      return profile
    },
    
    setModel(newModel: string) {
      const newProfile = getModelProfile(newModel)
      logger.info('Switching model', { 
        from: model, 
        to: newModel,
        profile: newProfile.name,
        temperature: newProfile.temperature,
        supportsReasoning: newProfile.supportsReasoning,
      })
      model = newModel
      profile = newProfile
    },
    async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
      logger.debug('LLM complete request', { 
        messageCount: request.messages.length,
        hasTools: !!request.tools?.length,
        profile: profile.name,
      })
      
      try {
        // Build request with profile defaults
        const createParams: OpenAI.ChatCompletionCreateParamsNonStreaming = {
          model,
          messages: convertMessages(request.messages),
          ...(request.tools ? { tools: convertTools(request.tools) } : {}),
          ...(request.toolChoice ? { tool_choice: request.toolChoice as ChatCompletionToolChoiceOption } : {}),
          temperature: request.temperature ?? profile.temperature,
          max_tokens: request.maxTokens ?? profile.defaultMaxTokens,
          top_p: profile.topP,
          stream: false,
        }
        
        // Add top_k if supported (vLLM extension)
        if (profile.topK !== undefined) {
          (createParams as unknown as Record<string, unknown>)['top_k'] = profile.topK
        }
        
        const response = await openai.chat.completions.create(createParams, {
          signal: request.signal,
        })
        
        const choice = response.choices[0]
        if (!choice) {
          throw new LLMError('No completion choice returned')
        }
        
        // Handle vLLM reasoning parser output
        const message = choice.message as {
          content?: string | null
          reasoning_content?: string | null
          reasoning?: string | null
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
        }
        
        let content = message.content ?? ''
        let thinkingContent = ''
        
        // Only process reasoning if model supports it
        if (profile.supportsReasoning) {
          thinkingContent = message.reasoning_content ?? message.reasoning ?? ''
          
          // If model outputs reasoning as content (broken config), handle it
          if (profile.reasoningAsContent && thinkingContent.trim()) {
            content = thinkingContent
            thinkingContent = ''
          }
        }
        
        // Fallback: if content is empty but reasoning has content, use reasoning as content
        if (!content.trim() && thinkingContent.trim()) {
          content = thinkingContent
          thinkingContent = ''
        }
        
        const toolCalls = message.tool_calls?.map(tc => ({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
        }))
        
        return {
          id: response.id,
          content,
          ...(thinkingContent ? { thinkingContent } : {}),
          ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
          finishReason: mapFinishReason(choice.finish_reason),
          usage: {
            promptTokens: response.usage?.prompt_tokens ?? 0,
            completionTokens: response.usage?.completion_tokens ?? 0,
            totalTokens: response.usage?.total_tokens ?? 0,
          },
        }
      } catch (error) {
        logger.error('LLM complete error', { error })
        throw new LLMError(
          error instanceof Error ? error.message : 'Unknown LLM error',
          { originalError: error }
        )
      }
    },
    
    async *stream(request: LLMCompletionRequest): AsyncIterable<LLMStreamEvent> {
      logger.debug('LLM stream request', {
        messageCount: request.messages.length,
        hasTools: !!request.tools?.length,
        profile: profile.name,
      })
      
      try {
        // Build request with profile defaults
        const createParams: OpenAI.ChatCompletionCreateParamsStreaming = {
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
        
        // Add top_k if supported (vLLM extension)
        if (profile.topK !== undefined) {
          (createParams as unknown as Record<string, unknown>)['top_k'] = profile.topK
        }
        
        // Disable thinking if requested or globally disabled via config (vLLM extension)
        if (request.enableThinking === false || disableThinking) {
          (createParams as unknown as Record<string, unknown>)['chat_template_kwargs'] = { enable_thinking: false }
        }
        
        const stream = await openai.chat.completions.create(createParams, {
          signal: request.signal,
        })
        
        let fullContent = ''
        let fullThinking = ''
        let inThinking = false
        const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map()
        let finishReason: LLMCompletionResponse['finishReason'] = 'stop'
        let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
        let responseId = ''
        
        for await (const chunk of stream) {
          responseId = chunk.id
          
          if (chunk.usage) {
            usage = {
              promptTokens: chunk.usage.prompt_tokens,
              completionTokens: chunk.usage.completion_tokens,
              totalTokens: chunk.usage.total_tokens,
            }
          }
          
          const choice = chunk.choices[0]
          if (!choice) continue
          
          if (choice.finish_reason) {
            finishReason = mapFinishReason(choice.finish_reason)
          }
          
          const delta = choice.delta as {
            content?: string | null
            reasoning_content?: string | null
            reasoning?: string | null
            tool_calls?: Array<{
              index: number
              id?: string
              function?: { name?: string; arguments?: string }
            }>
          }
          
          // Handle reasoning/thinking delta (vLLM reasoning parser output)
          const reasoning = delta.reasoning_content ?? delta.reasoning
          if (reasoning) {
            // Only emit thinking if model supports reasoning
            if (profile.supportsReasoning && !profile.reasoningAsContent) {
              fullThinking += reasoning
              yield { type: 'thinking_delta', content: reasoning }
            } else {
              // Model doesn't support reasoning or outputs it as content
              fullContent += reasoning
              yield { type: 'text_delta', content: reasoning }
            }
          }
          
          // Handle content delta
          if (delta.content) {
            fullContent += delta.content
            yield { type: 'text_delta', content: delta.content }
          }
          
          // Handle tool call deltas
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const existing = toolCalls.get(tc.index)
              
              if (!existing) {
                toolCalls.set(tc.index, {
                  id: tc.id ?? '',
                  name: tc.function?.name ?? '',
                  arguments: tc.function?.arguments ?? '',
                })
              } else {
                if (tc.id) existing.id = tc.id
                if (tc.function?.name) existing.name += tc.function.name
                if (tc.function?.arguments) existing.arguments += tc.function.arguments
              }
              
              yield {
                type: 'tool_call_delta' as const,
                index: tc.index,
                ...(tc.id ? { id: tc.id } : {}),
                ...(tc.function?.name ? { name: tc.function.name } : {}),
                ...(tc.function?.arguments ? { arguments: tc.function.arguments } : {}),
              }
            }
          }
        }
        
        // If content is empty but we have thinking, use thinking as content
        // (some models output everything as reasoning)
        let finalContent = fullContent.trim()
        let finalThinking = fullThinking.trim()
        
        if (!finalContent && finalThinking) {
          finalContent = finalThinking
          finalThinking = ''
        }
        
        // Parse tool calls
        const parsedToolCalls: ToolCall[] = []
        for (const [, tc] of toolCalls) {
          try {
            parsedToolCalls.push({
              id: tc.id,
              name: tc.name,
              arguments: JSON.parse(tc.arguments) as Record<string, unknown>,
            })
          } catch {
            logger.warn('Failed to parse tool call arguments', { name: tc.name, arguments: tc.arguments })
          }
        }
        
        yield {
          type: 'done',
          response: {
            id: responseId,
            content: finalContent,
            ...(finalThinking ? { thinkingContent: finalThinking } : {}),
            ...(parsedToolCalls.length > 0 ? { toolCalls: parsedToolCalls } : {}),
            finishReason,
            usage,
          },
        }
      } catch (error) {
        logger.error('LLM stream error', { error })
        yield {
          type: 'error',
          error: error instanceof Error ? error.message : 'Unknown LLM error',
        }
      }
    },
  }
}

// ============================================================================
// Helpers
// ============================================================================

function convertMessages(messages: LLMMessage[]): ChatCompletionMessageParam[] {
  return messages.map((msg): ChatCompletionMessageParam => {
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
        tool_calls: msg.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        })),
      }
    }
    
    return {
      role: msg.role as 'system' | 'user' | 'assistant',
      content: msg.content,
    }
  })
}

function convertTools(tools: LLMToolDefinition[]): ChatCompletionTool[] {
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    },
  }))
}

function mapFinishReason(reason: string | null): LLMCompletionResponse['finishReason'] {
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

function extractThinking(content: string): { content: string; thinkingContent: string | null } {
  const thinkRegex = /<think>([\s\S]*?)<\/think>/g
  let thinkingContent = ''
  let cleanContent = content
  
  let match
  while ((match = thinkRegex.exec(content)) !== null) {
    thinkingContent += match[1]
    cleanContent = cleanContent.replace(match[0], '')
  }
  
  return {
    content: cleanContent.trim(),
    thinkingContent: thinkingContent.trim() || null,
  }
}
