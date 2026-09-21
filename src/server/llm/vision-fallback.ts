import { logger } from '../utils/logger.js'

export type VisionBackend = 'ollama' | 'openai'

export interface VisionModelConfig {
  baseUrl: string
  model: string
  timeout: number
  backend: VisionBackend
  apiKey?: string
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

interface OpenAIChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>
}

interface OpenAIChatRequest {
  model: string
  messages: OpenAIChatMessage[]
}

interface OpenAIChatResponse {
  choices: Array<{
    message: {
      content: string | null
    }
  }>
}

const IMAGE_PROMPT = `Describe this image thoroughly and accurately. Include:
- What the image shows (UI, diagram, photo, illustration, etc.)
- All visible text, transcribed verbatim — every label, heading, number, and value
- Spatial layout: where elements are positioned and how they relate
- Colors, visual hierarchy, and any distinctive visual features

Be exhaustive rather than concise. Prioritize precision — if there are numbers, lists, or structured data, capture them completely. If the image contains a table or grid, reproduce it as a markdown table with exact values.`

function buildPrompt(context?: string, question?: string): string {
  if (question) {
    return `Answer the following question about this image. Be precise and concise, and if the answer is not visible in the image, say so explicitly:\n\n${question}`
  }
  return context ? `${IMAGE_PROMPT}\n\nContext: ${context}` : IMAGE_PROMPT
}

function buildOllamaRequest(base64Data: string, model: string, context?: string, question?: string): OllamaChatRequest {
  return {
    model,
    messages: [
      {
        role: 'user',
        content: buildPrompt(context, question),
        images: [base64Data],
      },
    ],
    stream: false,
    think: false,
  }
}

function buildOpenAIRequest(base64Data: string, model: string, context?: string, question?: string): OpenAIChatRequest {
  return {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt(context, question) },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Data}` } },
        ],
      },
    ],
  }
}

function parseOllamaResponse(data: unknown): string | null {
  const resp = data as OllamaChatResponse
  return resp.message?.content?.trim() ?? null
}

function parseOpenAIResponse(data: unknown): string | null {
  const resp = data as OpenAIChatResponse
  const choice = resp.choices?.[0]
  if (!choice) return null
  return choice.message?.content?.trim() ?? null
}

export async function describeImage(
  base64Data: string,
  visionModel: VisionModelConfig,
  options?: { context?: string | undefined; question?: string | undefined; signal?: AbortSignal | undefined },
): Promise<string> {
  const timeout = visionModel.timeout

  try {
    const isOpenAI = visionModel.backend === 'openai'
    const url = isOpenAI
      ? `${visionModel.baseUrl.replace(/\/+$/, '')}/chat/completions`
      : `${visionModel.baseUrl.replace(/\/+$/, '')}/api/chat`

    const requestBody = isOpenAI
      ? buildOpenAIRequest(base64Data, visionModel.model, options?.context, options?.question)
      : buildOllamaRequest(base64Data, visionModel.model, options?.context, options?.question)

    const timeoutController = new AbortController()
    const timeoutId = setTimeout(() => timeoutController.abort(), timeout)

    const signal = options?.signal
      ? AbortSignal.any([timeoutController.signal, options.signal])
      : timeoutController.signal

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (isOpenAI && visionModel.apiKey) {
      headers['Authorization'] = `Bearer ${visionModel.apiKey}`
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error')
      logger.error('Vision fallback API error', { status: response.status, error: errorText })
      return `[Image description failed: HTTP ${response.status}]`
    }

    const data = await response.json()
    const description = isOpenAI ? parseOpenAIResponse(data) : parseOllamaResponse(data)

    if (!description) {
      logger.warn('Vision fallback returned empty description')
      return '[Image - could not describe]'
    }

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
  visionModel: VisionModelConfig,
  options?: { context?: string | undefined; question?: string | undefined; signal?: AbortSignal | undefined },
): Promise<string> {
  const base64Match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/)
  if (!base64Match || !base64Match[1]) {
    return '[Invalid image data URL]'
  }

  return describeImage(base64Match[1], visionModel, options)
}

/**
 * The vision fallback never throws — on HTTP errors, timeouts, empty or
 * invalid inputs it returns a marker string instead. Detect those so callers
 * can surface the failure as an error rather than a successful description.
 */
export function isVisionFallbackFailure(description: string): boolean {
  return (
    description.startsWith('[Image description failed:') ||
    description === '[Image description timed out]' ||
    description === '[Image - could not describe]' ||
    description === '[Invalid image data URL]'
  )
}
