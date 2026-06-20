import OpenAI from 'openai'
import type { Config } from '../config.js'
import type {
  LLMClient,
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMStreamEvent,
  ReasoningEffort,
} from './types.js'
import type { ToolCall } from '../../shared/types.js'
import { logger } from '../utils/logger.js'
import { LLMError } from '../utils/errors.js'
import { getModelProfile, type ModelProfile } from './profiles.js'
import { type Backend, getBackendCapabilities } from './backend.js'
import { ensureVersionPrefix } from './url-utils.js'
import { buildNonStreamingCreateParams, buildStreamingCreateParams, mapFinishReason } from './client-pure.js'

export interface LLMClientWithModel extends LLMClient {
  getModel(): string
  setModel(model: string): void
  getProfile(): ModelProfile
  getBackend(): Backend
  setBackend(backend: Backend): void
}

export function createLLMClient(config: Config, initialBackend: Backend = 'unknown'): LLMClientWithModel {
  const baseURL = ensureVersionPrefix(config.llm.baseUrl)

  const openai = new OpenAI({
    baseURL,
    apiKey: config.llm.apiKey ?? 'not-needed',
  })

  let model = config.llm.model
  let profile = getModelProfile(model)
  let backend = initialBackend
  let capabilities = getBackendCapabilities(backend)
  const reasoningEffort = config.llm.reasoningEffort
  const idleTimeout = config.llm.idleTimeout ?? 30_000

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
      })
      model = newModel
      profile = newProfile
    },

    async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
      logger.debug('LLM complete request', {
        messageCount: request.messages.length,
        hasTools: !!request.tools?.length,
        profile: profile.name,
        reasoningEffort: request.reasoningEffort ?? reasoningEffort,
      })

      try {
        const resolvedEffort = (request.reasoningEffort ?? reasoningEffort) as ReasoningEffort | undefined

        const { params: createParams } = await buildNonStreamingCreateParams({
          model,
          request,
          profile,
          capabilities,
          ...(resolvedEffort ? { reasoningEffort: resolvedEffort } : {}),
        })
        const response = await openai.chat.completions.create(createParams, {
          signal: request.signal,
        })

        const choice = response.choices[0]
        if (!choice) {
          throw new LLMError('No completion choice returned')
        }

        const message = choice.message as {
          content?: string | null
          reasoning_content?: string | null
          reasoning?: string | null
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
        }

        const content = message.content ?? ''
        const thinkingContent = message.reasoning_content ?? message.reasoning ?? ''

        const toolCalls = message.tool_calls?.map((tc) => ({
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
      } catch (error: unknown) {
        logger.error('LLM complete error', { error: String(error) })
        throw new LLMError(error instanceof Error ? error.message : 'Unknown LLM error', {
          originalError: error instanceof Error ? error : undefined,
        })
      }
    },

    async *stream(request: LLMCompletionRequest): AsyncIterable<LLMStreamEvent> {
      logger.debug('LLM stream request', {
        messageCount: request.messages.length,
        hasTools: !!request.tools?.length,
        profile: profile.name,
        reasoningEffort: request.reasoningEffort ?? reasoningEffort,
        idleTimeout,
      })

      try {
        const resolvedEffort = (request.reasoningEffort ?? reasoningEffort) as ReasoningEffort | undefined
        const createParams = await buildStreamingCreateParams({
          model,
          request,
          profile,
          capabilities,
          ...(resolvedEffort ? { reasoningEffort: resolvedEffort } : {}),
        })

        const { params: streamingParams } = createParams
        const stream = await openai.chat.completions.create(streamingParams, {
          signal: request.signal,
        })

        let fullContent = ''
        let fullThinking = ''
        const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map()
        let finishReason: LLMCompletionResponse['finishReason'] = 'stop'
        let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
        let responseId = ''

        // Idle timeout tracking
        let lastChunkTime = Date.now()
        const idleTimeoutController = new AbortController()

        // Start idle timeout timer
        const idleTimer = setInterval(() => {
          const idleDuration = Date.now() - lastChunkTime
          if (idleDuration > idleTimeout) {
            logger.warn('LLM stream idle timeout triggered', { idleDuration, idleTimeout })
            idleTimeoutController.abort()
          }
        }, 100) // Check every 100ms

        // Clear timer immediately if external abort fires (e.g. pattern match)
        const onAbort = () => clearInterval(idleTimer)
        request.signal?.addEventListener('abort', onAbort, { once: true })

        try {
          for await (const chunk of stream) {
            // Check if idle timeout was triggered
            if (idleTimeoutController.signal.aborted) {
              throw new Error(`LLM stream idle timeout: no chunks received for ${idleTimeout}ms`)
            }

            // Reset idle timer on each chunk
            lastChunkTime = Date.now()

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
            const reasoning = delta.reasoning_content ?? delta.reasoning
            if (reasoning) {
              fullThinking += reasoning
              yield { type: 'thinking_delta', content: reasoning }
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
        } finally {
          clearInterval(idleTimer)
          request.signal?.removeEventListener('abort', onAbort)
        }

        const finalContent = fullContent.trim()
        const finalThinking = fullThinking.trim()

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
