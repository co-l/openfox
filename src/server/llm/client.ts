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
import {
  buildNonStreamingCreateParams,
  buildStreamingCreateParams,
  mapFinishReason,
  getThinking,
  parseToolArguments,
} from './client-pure.js'
import { OpenAIHttpClient } from './http-client.js'

export interface LLMClientWithModel extends LLMClient {
  getModel(): string
  setModel(model: string): void
  getProfile(): ModelProfile
  getBackend(): Backend
  setBackend(backend: Backend): void
}

export function createLLMClient(config: Config, initialBackend: Backend = 'unknown'): LLMClientWithModel {
  const baseURL = ensureVersionPrefix(config.llm.baseUrl)

  const httpClient = new OpenAIHttpClient({
    baseURL,
    apiKey: config.llm.apiKey ?? 'not-needed',
  })

  let model = config.llm.model
  let profile = getModelProfile(model)
  let backend = initialBackend
  let capabilities = getBackendCapabilities(backend)
  const reasoningEffort = config.llm.reasoningEffort
  const thinkingField = config.llm.thinkingField
  const idleTimeout = config.llm.idleTimeout ?? 120_000

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
        const resolvedEffort = request.skipClientReasoningEffort
          ? undefined
          : ((request.reasoningEffort ?? reasoningEffort) as ReasoningEffort | undefined)

        const { params: createParams } = await buildNonStreamingCreateParams({
          model,
          request,
          profile,
          capabilities,
          ...(resolvedEffort ? { reasoningEffort: resolvedEffort } : {}),
          ...(thinkingField ? { thinkingField } : {}),
        })
        const httpResponse = await httpClient.createChatCompletion(
          createParams,
          {
            signal: request.signal,
          },
          request.returnRaw,
        )

        const choice = httpResponse.choices[0]
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
        const thinkingContent = getThinking(message as Record<string, string | null>, thinkingField) ?? ''

        const toolCalls = message.tool_calls?.map((tc) => {
          const { arguments: args, parseError } = parseToolArguments(tc.function.arguments, { id: tc.id, name: tc.function.name })
          return { id: tc.id, name: tc.function.name, arguments: args, ...(parseError ? { parseError } : {}) }
        })

        return {
          id: httpResponse.id,
          content,
          ...(thinkingContent ? { thinkingContent } : {}),
          ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
          finishReason: mapFinishReason(choice.finish_reason),
          usage: {
            promptTokens: httpResponse.usage?.prompt_tokens ?? 0,
            completionTokens: httpResponse.usage?.completion_tokens ?? 0,
            totalTokens: httpResponse.usage?.total_tokens ?? 0,
          },
          ...(httpResponse.raw ? { raw: httpResponse.raw } : {}),
        }
      } catch (error: unknown) {
        logger.error('LLM complete error', { error: String(error) })
        throw new LLMError(error instanceof Error ? error.message : 'Unknown LLM error', {
          originalError: error instanceof Error ? error : undefined,
        })
      }
    },

    async *stream(request: LLMCompletionRequest): AsyncIterable<LLMStreamEvent> {
      const resolvedEffort = request.skipClientReasoningEffort
        ? undefined
        : ((request.reasoningEffort ?? reasoningEffort) as ReasoningEffort | undefined)

      logger.debug('LLM stream request', {
        messageCount: request.messages.length,
        hasTools: !!request.tools?.length,
        profile: profile.name,
        reasoningEffort: resolvedEffort,
        idleTimeout,
      })

      try {
        const createParams = await buildStreamingCreateParams({
          model,
          request,
          profile,
          capabilities,
          ...(resolvedEffort ? { reasoningEffort: resolvedEffort } : {}),
          ...(thinkingField ? { thinkingField } : {}),
        })

        const { params: streamingParams } = createParams
        const stream = httpClient.createChatCompletionStream(streamingParams, {
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

            if (!Array.isArray(chunk?.choices)) {
              const streamError = (chunk as unknown as { error?: unknown })?.error
              const errorMessage =
                typeof streamError === 'string'
                  ? streamError
                  : streamError &&
                      typeof streamError === 'object' &&
                      'message' in streamError &&
                      typeof streamError.message === 'string'
                    ? streamError.message
                    : 'Invalid LLM stream chunk: missing choices'
              throw new LLMError(errorMessage)
            }

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

            const delta = choice.delta as Record<string, unknown> & {
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
            const reasoning = getThinking(delta as Record<string, string | null | undefined>, thinkingField)
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
          const { arguments: args, parseError } = parseToolArguments(tc.arguments, { id: tc.id, name: tc.name })
          if (parseError) {
            logger.warn('Failed to parse tool call arguments', { name: tc.name, arguments: tc.arguments, parseError })
            parsedToolCalls.push({
              id: tc.id,
              name: tc.name,
              arguments: args,
              parseError,
              rawArguments: tc.arguments,
            })
          } else {
            parsedToolCalls.push({
              id: tc.id,
              name: tc.name,
              arguments: args,
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
