import type { StoredEvent, TurnEvent, SessionSnapshot } from '../events/types.js'
import type { Attachment } from '../../shared/types.js'
import { describeImageFromDataUrl } from '../llm/vision-fallback.js'
import type { VisionBackend } from '../llm/vision-fallback.js'
import { getRuntimeConfig } from '../runtime-config.js'
import { extractPdfContent } from '../tools/pdf-utils.js'
import type { PdfBlock } from '../tools/pdf-utils.js'
import { contentHash, cacheSet } from '../utils/cache.js'

export async function loadVisionModelFromGlobalConfig(): Promise<
  { baseUrl: string; model: string; timeout: number; backend: VisionBackend } | undefined
> {
  try {
    const { loadGlobalConfig, getVisionFallback } = await import('../../cli/config.js')
    const runtimeConfig = getRuntimeConfig()
    const mode = runtimeConfig.mode ?? 'production'
    const globalConfig = await loadGlobalConfig(mode)
    const fallback = getVisionFallback(globalConfig)
    if (fallback?.enabled && fallback.model) {
      return {
        baseUrl: fallback.url,
        model: fallback.model,
        timeout: fallback.timeout * 1000,
        backend: fallback.backend ?? 'ollama',
      }
    }
  } catch {
    // Global config not available
  }
  return undefined
}

export interface ImageProcessorOptions {
  modelSupportsVision: boolean
  visionModel?: {
    baseUrl: string
    model: string
    timeout: number
    backend: VisionBackend
  }
  signal?: AbortSignal
  onEvent?: (event: TurnEvent) => void
  /** Called to persist enriched event data (e.g., attachment descriptions) back to the event store */
  persistEvent?: (sessionId: string, seq: number, data: unknown) => void
}

export interface ProcessContextResult {
  events: StoredEvent[]
  descriptions: Map<string, string>
}

const descriptionCache = new Map<string, string>()

export function clearImageDescriptionCache(): void {
  descriptionCache.clear()
}

function isImageAttachment(att: Attachment): boolean {
  return att.mimeType.startsWith('image/')
}

function isPdfAttachment(att: Attachment): boolean {
  return att.mimeType === 'application/pdf'
}

function decodePdfDataUrl(data: string): Buffer | null {
  const match = data.match(/^data:.*?;base64,(.+)$/)
  if (!match?.[1]) return null
  try {
    return Buffer.from(match[1], 'base64')
  } catch {
    return null
  }
}

function hasImageMetadata(result: { metadata?: Record<string, unknown> }): boolean {
  const meta = result.metadata
  if (!meta) return false
  const dataUrl = meta['dataUrl']
  const mimeType = meta['mimeType']
  return typeof dataUrl === 'string' && typeof mimeType === 'string' && (mimeType as string).startsWith('image/')
}

async function describeImageDataUrl(
  dataUrl: string,
  attachmentId: string,
  messageId: string,
  options: ImageProcessorOptions,
  descriptions: Map<string, string>,
  filename?: string,
): Promise<string> {
  const cacheKey = contentHash(dataUrl)
  if (descriptionCache.has(cacheKey)) {
    const cached = descriptionCache.get(cacheKey)!
    descriptions.set(attachmentId, cached)
    return cached
  }

  if (options.visionModel) {
    const startData: { messageId: string; attachmentId: string; filename?: string } = {
      messageId,
      attachmentId,
    }
    if (filename !== undefined) {
      startData.filename = filename
    }
    options.onEvent?.({ type: 'vision_fallback.start', data: startData })

    const description = await describeImageFromDataUrl(dataUrl, options.visionModel, {
      context: filename ? `File: ${filename}` : undefined,
      signal: options.signal,
    })

    cacheSet(descriptionCache, cacheKey, description)
    descriptions.set(attachmentId, description)

    options.onEvent?.({ type: 'vision_fallback.done', data: { messageId, attachmentId, description } })

    return description
  }

  const placeholder = filename ? `[Image: ${filename}]` : '[Image]'
  descriptions.set(attachmentId, placeholder)
  return placeholder
}

async function describeAttachment(
  att: Attachment,
  messageId: string,
  options: ImageProcessorOptions,
  descriptions: Map<string, string>,
): Promise<string> {
  return describeImageDataUrl(att.data, att.id, messageId, options, descriptions, att.filename)
}

async function describePdfAttachment(
  att: Attachment,
  messageId: string,
  options: ImageProcessorOptions,
  descriptions: Map<string, string>,
): Promise<string> {
  const hasVision = !!options.visionModel
  const cacheKey = `pdf:${hasVision}:${contentHash(att.data)}`
  const filenameLabel = att.filename || 'document.pdf'
  if (descriptionCache.has(cacheKey)) {
    const cached = descriptionCache.get(cacheKey)!
    const output = `[PDF: ${filenameLabel}]${cached}`
    descriptions.set(att.id, output)
    return output
  }

  const buffer = decodePdfDataUrl(att.data)
  if (!buffer) {
    const fallback = `[PDF: ${filenameLabel}] (could not decode)`
    cacheSet(descriptionCache, cacheKey, fallback)
    descriptions.set(att.id, fallback)
    return fallback
  }

  let blocks: PdfBlock[]
  try {
    const result = await extractPdfContent(buffer)
    blocks = result.blocks
  } catch {
    const errorText = `[PDF: ${filenameLabel}] (could not extract content)`
    descriptions.set(att.id, errorText)
    return errorText
  }

  let body = ''

  let imageIndex = 0
  for (const block of blocks) {
    if (block.type === 'text' && block.content) {
      body += '\n\n' + block.content
    } else if (block.type === 'image' && block.dataUrl) {
      if (options.visionModel) {
        const imgAttachmentId = `${att.id}/image-${imageIndex}`
        const description = await describeImageDataUrl(block.dataUrl, imgAttachmentId, messageId, options, descriptions)
        body += '\n\n[Image: ' + description + ']'
      } else {
        body += '\n\n[Image: ' + (att.filename || 'image') + ']'
      }
      imageIndex++
    }
  }

  const output = `[PDF: ${filenameLabel}]${body}`
  cacheSet(descriptionCache, cacheKey, body)
  descriptions.set(att.id, output)
  return output
}

/**
 * Enrich image attachments with vision fallback descriptions.
 *
 * Unlike the old approach (which replaced content and deleted attachments on clones),
 * this enriches attachments with a `description` field and persists the enriched data
 * back to the event store. The original image data and attachments array are kept intact
 * so the UI continues to display images.
 *
 * For non-vision models, the LLM context builder uses `attachment.description` instead
 * of the raw image data. For vision models, the description is ignored.
 */
export async function processContextImages(
  events: StoredEvent[],
  options: ImageProcessorOptions,
): Promise<ProcessContextResult> {
  if (options.modelSupportsVision) {
    return { events, descriptions: new Map() }
  }

  const descriptions = new Map<string, string>()
  const modifiedEvents: StoredEvent[] = events.map((event) => structuredClone(event))

  for (const event of modifiedEvents) {
    if (event.type === 'message.start') {
      const data = event.data as Extract<TurnEvent, { type: 'message.start' }>['data']
      if (!data.attachments || data.attachments.length === 0) continue

      let enriched = false

      const imageAtts = data.attachments.filter(isImageAttachment)
      for (const att of imageAtts) {
        if (att.description) {
          descriptions.set(att.id, att.description)
          continue
        }
        const description = await describeAttachment(att, data.messageId, options, descriptions)
        att.description = description
        enriched = true
      }

      const pdfAtts = data.attachments.filter(isPdfAttachment)
      for (const att of pdfAtts) {
        if (att.pdfContent) {
          descriptions.set(att.id, att.pdfContent)
          continue
        }
        const pdfContent = await describePdfAttachment(att, data.messageId, options, descriptions)
        att.pdfContent = pdfContent
        enriched = true
      }

      if (enriched && options.persistEvent) {
        options.persistEvent(event.sessionId, event.seq, data)
      }
    }

    if (event.type === 'tool.result') {
      const data = event.data as Extract<TurnEvent, { type: 'tool.result' }>['data']
      if (!data.result.metadata || !hasImageMetadata(data.result)) continue

      const meta = data.result.metadata
      // Skip if already has a description
      if (meta['description']) {
        descriptions.set(data.toolCallId, meta['description'] as string)
        continue
      }

      const dataUrl = meta['dataUrl'] as string
      const path = meta['path'] as string | undefined

      const description = await describeImageDataUrl(
        dataUrl,
        data.toolCallId,
        data.messageId,
        options,
        descriptions,
        path,
      )

      meta['description'] = description

      // Persist enriched metadata back to the store
      if (options.persistEvent) {
        options.persistEvent(event.sessionId, event.seq, data)
      }
    }

    if (event.type === 'turn.snapshot') {
      const snapshot = event.data as SessionSnapshot
      let enriched = false

      for (const message of snapshot.messages) {
        if (message.role === 'user' && message.attachments && message.attachments.length > 0) {
          for (const att of message.attachments) {
            if (isImageAttachment(att)) {
              if (att.description) {
                descriptions.set(att.id, att.description)
                continue
              }
              const description = await describeAttachment(att, message.id, options, descriptions)
              att.description = description
              enriched = true
            } else if (isPdfAttachment(att)) {
              if (att.pdfContent) {
                descriptions.set(att.id, att.pdfContent)
                continue
              }
              const pdfContent = await describePdfAttachment(att, message.id, options, descriptions)
              att.pdfContent = pdfContent
              enriched = true
            }
          }
        }

        if (message.role === 'assistant' && message.toolCalls) {
          for (const toolCall of message.toolCalls) {
            if (!toolCall.result || !toolCall.result.metadata || !hasImageMetadata(toolCall.result)) continue

            const meta = toolCall.result.metadata
            if (meta['description']) {
              descriptions.set(toolCall.id, meta['description'] as string)
              continue
            }

            const dataUrl = meta['dataUrl'] as string
            const path = meta['path'] as string | undefined

            const description = await describeImageDataUrl(
              dataUrl,
              toolCall.id,
              message.id,
              options,
              descriptions,
              path,
            )

            meta['description'] = description
            enriched = true
          }
        }
      }

      // Persist enriched snapshot back to the store
      if (enriched && options.persistEvent) {
        options.persistEvent(event.sessionId, event.seq, snapshot)
      }
    }
  }

  return { events: modifiedEvents, descriptions }
}
