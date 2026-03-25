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
import type { ToolCall } from '../../shared/types.js'
import { logger } from '../utils/logger.js'
import { LLMError } from '../utils/errors.js'
import { getModelProfile, type ModelProfile } from './profiles.js'
import { type Backend, type BackendCapabilities, getBackendCapabilities } from './backend.js'
import {
  buildNonStreamingCreateParams,
  buildStreamingCreateParams,
  extractThinking,
  mapFinishReason,
} from './client-pure.js'

export interface LLMClientWithModel extends LLMClient {
  getModel(): string
  setModel(model: string): void
  getProfile(): ModelProfile
  getBackend(): Backend
  setBackend(backend: Backend): void
}

export function createLLMClient(config: Config, initialBackend: Backend = 'unknown'): LLMClientWithModel {
  // Ensure baseURL includes /v1 for OpenAI-compatible endpoint
  const baseURL = config.llm.baseUrl.includes('/v1') 
    ? config.llm.baseUrl 
    : `${config.llm.baseUrl}/v1`
  
  const openai = new OpenAI({
    baseURL,
    apiKey: 'not-needed', // Most local backends don't require API key
    timeout: config.llm.timeout,
  })
  
  let model = config.llm.model
  let profile = getModelProfile(model)
  let backend = initialBackend
  let capabilities = getBackendCapabilities(backend)
  const disableThinking = config.llm.disableThinking ?? false
  
  return {
    getModel() {
      return model
    },
    
    getProfile() {
      return profile
    },
    
    getBackend() {
      return backend
    },
    
    setBackend(newBackend: Backend) {
      logger.debug('Setting LLM backend', { from: backend, to: newBackend })
      backend = newBackend
      capabilities = getBackendCapabilities(newBackend)
    },
    
    setModel(newModel: string) {
      const newProfile = getModelProfile(newModel)
      logger.debug('Switching model', { 
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
        disableThinking,
      })
      
      try {
        const shouldDisableThinking = disableThinking || request.disableThinking === true
        const createParams = buildNonStreamingCreateParams({
          model, 
          request, 
          profile, 
          capabilities, 
          disableThinking: shouldDisableThinking,
        })
        const response = await openai.chat.completions.create(createParams, {
          signal: request.signal,
        })
        
        const choice = response.choices[0]
        if (!choice) {
          throw new LLMError('No completion choice returned')
        }
        
        // Handle reasoning output - different backends return it differently
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
          if (capabilities.supportsReasoningField) {
            // vLLM/SGLang: use reasoning_content field
            thinkingContent = message.reasoning_content ?? message.reasoning ?? ''
          } else {
            // Ollama/llama.cpp: extract <think> tags from content
            const extracted = extractThinking(content)
            content = extracted.content
            thinkingContent = extracted.thinkingContent ?? ''
          }
          
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
      } catch (error: any) {
        logger.error('LLM complete error', { error: error.toString() })
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
        disableThinking,
      })
      
      try {
        // Disable thinking if configured globally or requested per-call
        const shouldDisableThinking = disableThinking || request.disableThinking === true
        
        const createParams = buildStreamingCreateParams({ model, request, profile, capabilities, disableThinking: shouldDisableThinking })
        
        const stream = await openai.chat.completions.create(createParams, {
          signal: request.signal,
        })
        
        let fullContent = ''
        let fullThinking = ''
        let inThinking = false
        let tagBuffer = '' // Buffer for parsing <think> tags across chunk boundaries
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
          
          // Handle reasoning/thinking delta
          // vLLM/SGLang: reasoning comes as separate field
          // Ollama/llama.cpp: reasoning is embedded as <think> tags in content
          if (capabilities.supportsReasoningField) {
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
          }
          
          // Handle content delta
          if (delta.content) {
            fullContent += delta.content

            // For backends without reasoning field (ollama/llama.cpp), parse <think> tags in real-time
            if (!capabilities.supportsReasoningField && profile.supportsReasoning && !profile.reasoningAsContent) {
              // Feed content through the think tag parser
              tagBuffer += delta.content

              while (tagBuffer.length > 0) {
                if (inThinking) {
                  // Look for </think>
                  const closeIdx = tagBuffer.indexOf('</think>')
                  if (closeIdx !== -1) {
                    // Emit thinking content before the close tag
                    const thinkText = tagBuffer.slice(0, closeIdx)
                    if (thinkText) {
                      fullThinking += thinkText
                      yield { type: 'thinking_delta', content: thinkText }
                    }
                    tagBuffer = tagBuffer.slice(closeIdx + '</think>'.length)
                    inThinking = false
                  } else if (tagBuffer.includes('</')) {
                    // Might be a partial </think> tag - emit everything before it
                    const partialIdx = tagBuffer.lastIndexOf('</')
                    const before = tagBuffer.slice(0, partialIdx)
                    if (before) {
                      fullThinking += before
                      yield { type: 'thinking_delta', content: before }
                    }
                    tagBuffer = tagBuffer.slice(partialIdx)
                    break // wait for more data
                  } else {
                    // No close tag at all, emit all as thinking
                    fullThinking += tagBuffer
                    yield { type: 'thinking_delta', content: tagBuffer }
                    tagBuffer = ''
                  }
                } else {
                  // Look for <think>
                  const openIdx = tagBuffer.indexOf('<think>')
                  if (openIdx !== -1) {
                    // Emit text content before the open tag
                    const textBefore = tagBuffer.slice(0, openIdx)
                    if (textBefore) {
                      yield { type: 'text_delta', content: textBefore }
                    }
                    tagBuffer = tagBuffer.slice(openIdx + '<think>'.length)
                    inThinking = true
                  } else if (tagBuffer.includes('<')) {
                    // Might be a partial <think> tag - emit everything before it
                    const partialIdx = tagBuffer.lastIndexOf('<')
                    const before = tagBuffer.slice(0, partialIdx)
                    if (before) {
                      yield { type: 'text_delta', content: before }
                    }
                    tagBuffer = tagBuffer.slice(partialIdx)
                    break // wait for more data
                  } else {
                    // No open tag at all, emit all as text
                    yield { type: 'text_delta', content: tagBuffer }
                    tagBuffer = ''
                  }
                }
              }
            } else {
              yield { type: 'text_delta', content: delta.content }
            }
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
        
        // Flush any remaining tag buffer content
        if (tagBuffer) {
          if (inThinking) {
            fullThinking += tagBuffer
          }
          tagBuffer = ''
        }

        // For backends without reasoning field, extract <think> tags from accumulated content
        let finalContent = fullContent.trim()
        let finalThinking = fullThinking.trim()
        
        if (!capabilities.supportsReasoningField && profile.supportsReasoning) {
          const extracted = extractThinking(finalContent)
          finalContent = extracted.content
          finalThinking = extracted.thinkingContent ?? ''
        }
        
        // If content is empty but we have thinking, use thinking as content
        // (some models output everything as reasoning)
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
          } catch (error) {
            logger.warn('Failed to parse tool call arguments', { name: tc.name, arguments: tc.arguments })
            // Include the failed tool call with error metadata so the LLM can retry
            parsedToolCalls.push({
              id: tc.id,
              name: tc.name,
              arguments: {},
              parseError: error instanceof Error ? error.message : 'Unknown JSON parse error',
              rawArguments: tc.arguments,
            })
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
