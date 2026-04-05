import { logger } from '../utils/logger.js'

export interface VisionFallbackConfig {
  enabled: boolean
  url: string
  model: string
  timeout: number
}

const DEFAULT_CONFIG: VisionFallbackConfig = {
  enabled: false,
  url: 'http://localhost:11434',
  model: 'qwen3-vl:2b',
  timeout: 120000,
}

let config: VisionFallbackConfig = { ...DEFAULT_CONFIG }
let configLoaded = false

const descriptionCache = new Map<string, string>()

export function setVisionFallbackConfig(newConfig: Partial<VisionFallbackConfig>): void {
  config = { ...config, ...newConfig }
  configLoaded = true
  logger.debug('Vision fallback config updated', { config })
}

export function getVisionFallbackConfig(): VisionFallbackConfig {
  return { ...config }
}

export function isVisionFallbackEnabled(): boolean {
  return config.enabled
}

export async function ensureVisionFallbackConfigLoaded(): Promise<void> {
  if (configLoaded) return

  try {
    const { loadGlobalConfig, getVisionFallback } = await import('../../cli/config.js')
    const { getRuntimeConfig } = await import('../runtime-config.js')

    const runtimeConfig = getRuntimeConfig()
    const mode = runtimeConfig.mode ?? 'production'
    const globalConfig = await loadGlobalConfig(mode)

    const fallback = getVisionFallback(globalConfig)
    config = {
      enabled: fallback.enabled ?? false,
      url: fallback.url ?? 'http://localhost:11434',
      model: fallback.model ?? 'qwen3-vl:2b',
      timeout: (fallback.timeout ?? 120) * 1000,
    }
    configLoaded = true
    logger.debug('Vision fallback config loaded from global config', { config })
  } catch (error) {
    logger.warn('Failed to load vision fallback config from global config', { error: error instanceof Error ? error.message : String(error) })
  }
}

interface OllamaChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  images?: string[]
}

interface OllamaChatRequest {
  model: string
  messages: OllamaChatMessage[]
  stream: boolean
  think?: boolean
}

interface OllamaChatResponse {
  message: {
    role: 'user' | 'assistant' | 'system'
    content: string
  }
}

const IMAGE_PROMPT = `Describe this image in detail. Focus on:
- What the image shows (UI, diagram, photo, etc.)
- Any text visible in the image
- Layout and visual structure
- Key elements and their relationships

Provide a concise but comprehensive description.`

export async function describeImage(
  base64Data: string,
  options?: { timeout?: number; context?: string }
): Promise<string> {
  await ensureVisionFallbackConfigLoaded()

  if (!config.enabled) {
    return '[Image - vision fallback not enabled]'
  }

  const cacheKey = `${base64Data.slice(0, 100)}:${options?.context ?? ''}`
  const cached = descriptionCache.get(cacheKey)
  if (cached) {
    logger.debug('Using cached image description')
    return cached
  }

  const timeout = options?.timeout ?? config.timeout

  try {
    const url = `${config.url}/api/chat`

    const requestBody: OllamaChatRequest = {
      model: config.model,
      messages: [
        {
          role: 'user',
          content: options?.context
            ? `${IMAGE_PROMPT}\n\nContext: ${options.context}`
            : IMAGE_PROMPT,
          images: [base64Data],
        },
      ],
      stream: false,
      think: false,
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error')
      logger.error('Vision fallback API error', { status: response.status, error: errorText })
      return `[Image description failed: HTTP ${response.status}]`
    }

    const data = (await response.json()) as OllamaChatResponse

    const description = data.message?.content?.trim()
    if (!description) {
      logger.warn('Vision fallback returned empty description')
      return '[Image - could not describe]'
    }

    descriptionCache.set(cacheKey, description)
    logger.debug('Cached image description', { cacheKey: cacheKey.slice(0, 20) })

    return description
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Vision fallback error', { error: message })

    if (message.includes('abort')) {
      return '[Image description timed out]'
    }

    return `[Image description failed: ${message}]`
  }
}

export async function describeImageFromDataUrl(
  dataUrl: string,
  options?: { timeout?: number; context?: string }
): Promise<string> {
  const base64Match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/)
  if (!base64Match || !base64Match[1]) {
    return '[Invalid image data URL]'
  }

  return describeImage(base64Match[1], options)
}