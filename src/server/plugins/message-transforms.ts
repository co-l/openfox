import type { ContextMessage } from '../events/folding.js'
import type {
  PluginMessageTransform,
  PluginMessageTransformContext,
  PluginMessageTransformResult,
} from '../../plugin/index.js'
import { logger } from '../utils/logger.js'

export interface OwnedPluginMessageTransform {
  pluginId: string
  transform: PluginMessageTransform
}

let transforms: OwnedPluginMessageTransform[] = []

export function setPluginMessageTransforms(next: OwnedPluginMessageTransform[]): void {
  transforms = [...next].sort((a, b) => (a.transform.priority ?? 100) - (b.transform.priority ?? 100))
}

export function listPluginMessageTransforms(): OwnedPluginMessageTransform[] {
  return [...transforms]
}

export function clearPluginMessageTransforms(): void {
  transforms = []
}

export interface ApplyMessageTransformsOptions {
  timeoutMs?: number
}

const DEFAULT_TRANSFORM_TIMEOUT_MS = 5000

/**
 * Deep copy of the message list, so no plugin and no caller keeps a reference
 * to state the host owns. `structuredClone` is used rather than a hand-rolled
 * copy so every value a plugin may legitimately put on a message survives:
 * Dates, Maps, typed arrays, class instances, arbitrary nesting and cycles.
 */
function cloneMessages(messages: ContextMessage[]): ContextMessage[] {
  return structuredClone(messages)
}

export async function applyPluginMessageTransforms(
  initialMessages: ContextMessage[],
  context: PluginMessageTransformContext,
  options?: ApplyMessageTransformsOptions,
): Promise<{
  messages: ContextMessage[]
  systemPrompt: string
  metadata: Record<string, unknown>
}> {
  let currentMessages = initialMessages
  let currentSystemPrompt = context.systemPrompt
  const accumulatedMetadata: Record<string, unknown> = {}

  if (transforms.length === 0) {
    return {
      messages: currentMessages,
      systemPrompt: currentSystemPrompt,
      metadata: accumulatedMetadata,
    }
  }

  const defaultTimeout = options?.timeoutMs ?? DEFAULT_TRANSFORM_TIMEOUT_MS

  for (const { pluginId, transform } of transforms) {
    if (context.signal?.aborted) {
      break
    }

    try {
      // Each transform works on a private copy of the pipeline state. On
      // throw/timeout nothing it did is adopted, and a transform abandoned by
      // the timeout cannot mutate host-owned messages afterwards.
      const inputMessages = cloneMessages(currentMessages)
      // The context is a fresh shallow copy, so a plugin overwriting
      // `context.systemPrompt` cannot reach the pipeline state; `signal` is
      // shared by reference because an AbortSignal must keep its identity.
      const transformContext: PluginMessageTransformContext = {
        ...context,
        systemPrompt: currentSystemPrompt,
      }

      let timer: NodeJS.Timeout | undefined
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Transform '${transform.id}' from plugin '${pluginId}' timed out after ${defaultTimeout}ms`))
        }, defaultTimeout)
        timer.unref?.()
      })

      const execPromise = Promise.resolve(
        transform.transform(inputMessages as unknown as import('../llm/types.js').LLMMessage[], transformContext),
      )

      let rawResult: PluginMessageTransformResult | import('../llm/types.js').LLMMessage[]
      try {
        rawResult = await Promise.race([execPromise, timeoutPromise])
      } finally {
        if (timer) clearTimeout(timer)
      }

      // Everything this transform contributes is prepared in temporaries first
      // and committed only once every copy succeeded, so a value that cannot be
      // cloned (e.g. a function in `metadata`) cannot leave a half-applied
      // update behind.
      let nextMessages: ContextMessage[] | undefined
      let nextSystemPrompt: string | undefined
      let nextMetadata: Record<string, unknown> | undefined
      if (Array.isArray(rawResult)) {
        nextMessages = cloneMessages(rawResult as unknown as ContextMessage[])
      } else if (rawResult && typeof rawResult === 'object') {
        const res = rawResult as PluginMessageTransformResult
        if (Array.isArray(res.messages)) {
          nextMessages = cloneMessages(res.messages as unknown as ContextMessage[])
        }
        if (typeof res.systemPrompt === 'string') {
          nextSystemPrompt = res.systemPrompt
        }
        if (res.metadata && typeof res.metadata === 'object') {
          nextMetadata = structuredClone(res.metadata) as Record<string, unknown>
        }
      }
      // Adopted outputs are copied too: the returned state is host-owned and
      // must not alias structures a plugin can still reach and mutate. A
      // transform that returns no messages (e.g. only `{ systemPrompt }`) may
      // still have edited the list it was given; adopting the host-owned copy
      // keeps that working, while a transform that threw or timed out adopts
      // nothing — it never reaches this point.
      currentMessages = nextMessages ?? cloneMessages(inputMessages)
      if (nextSystemPrompt !== undefined) {
        currentSystemPrompt = nextSystemPrompt
      }
      if (nextMetadata) {
        Object.assign(accumulatedMetadata, nextMetadata)
      }
    } catch (error) {
      // Fail-open: a transform that throws or exceeds its timeout contributes
      // nothing, and the messages/systemPrompt/metadata of the last successful
      // transform are returned unchanged. The pipeline continues with the next
      // transform.
      logger.warn(`Message transform '${transform.id}' from plugin '${pluginId}' failed (fail-open fallback applied)`, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    messages: currentMessages,
    systemPrompt: currentSystemPrompt,
    metadata: accumulatedMetadata,
  }
}
