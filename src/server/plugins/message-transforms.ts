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
        transform.transform(currentMessages as unknown as import('../llm/types.js').LLMMessage[], transformContext),
      )

      let rawResult: PluginMessageTransformResult | import('../llm/types.js').LLMMessage[]
      try {
        rawResult = await Promise.race([execPromise, timeoutPromise])
      } finally {
        if (timer) clearTimeout(timer)
      }

      if (Array.isArray(rawResult)) {
        currentMessages = rawResult as unknown as ContextMessage[]
      } else if (rawResult && typeof rawResult === 'object') {
        const res = rawResult as PluginMessageTransformResult
        if (Array.isArray(res.messages)) {
          currentMessages = res.messages as unknown as ContextMessage[]
        }
        if (typeof res.systemPrompt === 'string') {
          currentSystemPrompt = res.systemPrompt
        }
        if (res.metadata && typeof res.metadata === 'object') {
          Object.assign(accumulatedMetadata, res.metadata)
        }
      }
    } catch (error) {
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
