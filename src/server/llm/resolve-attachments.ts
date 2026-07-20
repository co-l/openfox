import type { LLMMessage } from './types.js'
import type { Attachment } from '../../shared/types.js'
import { extractPdfContent, extractPdfText } from '../tools/pdf-utils.js'
import { TEXT_MIME_EXACT, TEXT_MIME_PREFIXES } from '../../shared/constants.js'
import { contentHash, cacheSet } from '../utils/cache.js'
import { decodeDataUrl } from '../utils/data-url.js'

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

const pdfBlockCache = new Map<string, ContentPart[]>()

export function clearPdfBlockCache(): void {
  pdfBlockCache.clear()
}

export async function extractPdfFromDataUrl(data: string, filename: string): Promise<string> {
  const base64Match = data.match(/^data:.*?;base64,(.+)$/)
  if (base64Match?.[1]) {
    try {
      const buffer = Buffer.from(base64Match[1], 'base64')
      const result = await extractPdfText(buffer)
      return `[PDF: ${filename}]\n${result.text}`
    } catch {
      return `[PDF: ${filename}] (could not extract text)`
    }
  }
  return `[PDF: ${filename}] (could not extract text)`
}

export async function extractPdfBlocksFromDataUrl(data: string, filename: string): Promise<ContentPart[]> {
  const cacheKey = contentHash(data)
  const cached = pdfBlockCache.get(cacheKey)
  if (cached) {
    const result: ContentPart[] = [{ type: 'text', text: `[PDF: ${filename}]` }]
    result.push(...cached)
    return result
  }

  const base64Match = data.match(/^data:.*?;base64,(.+)$/)
  if (!base64Match?.[1]) {
    cacheSet(pdfBlockCache, cacheKey, [])
    return [{ type: 'text', text: `[PDF: ${filename}] (could not extract content)` }]
  }
  try {
    const buffer = Buffer.from(base64Match[1], 'base64')
    const result = await extractPdfContent(buffer)
    const body: ContentPart[] = []
    for (const block of result.blocks) {
      if (block.type === 'text' && block.content) {
        body.push({ type: 'text', text: block.content })
      } else if (block.type === 'image' && block.dataUrl) {
        body.push({ type: 'image_url', image_url: { url: block.dataUrl } })
      }
    }
    cacheSet(pdfBlockCache, cacheKey, body)
    const parts: ContentPart[] = [{ type: 'text', text: `[PDF: ${filename}]` }]
    parts.push(...body)
    return parts
  } catch {
    cacheSet(pdfBlockCache, cacheKey, [])
    return [{ type: 'text', text: `[PDF: ${filename}] (could not extract content)` }]
  }
}

async function resolveAttachmentToText(attachment: Attachment, supportsVision: boolean): Promise<string> {
  const mimeType = attachment.mimeType

  if (TEXT_MIME_EXACT.includes(mimeType) || TEXT_MIME_PREFIXES.some((p) => mimeType.startsWith(p))) {
    const text = decodeDataUrl(attachment.data)?.toString('utf8') ?? attachment.data
    return `[File: ${attachment.filename || 'file'}]\n${text}`
  }

  if (mimeType === 'application/pdf') {
    if (attachment.pdfContent) {
      return attachment.pdfContent
    }
    return extractPdfFromDataUrl(attachment.data, attachment.filename || 'document.pdf')
  }

  if (supportsVision) {
    return `[File: ${attachment.filename || 'file'} (unsupported type: ${mimeType})]`
  }

  if (attachment.description) {
    return `[Image: ${attachment.filename || 'image'} - description: ${attachment.description}]`
  }

  return `[Image: ${attachment.filename || 'image'}] (vision not supported, cannot describe)`
}

const isVisionAttachment = (attachment: Attachment): boolean =>
  attachment.mimeType.startsWith('image/') || attachment.mimeType === 'application/pdf'

export async function resolveAttachmentsInMessages(
  messages: LLMMessage[],
  supportsVision: boolean,
): Promise<LLMMessage[]> {
  const result: LLMMessage[] = []
  for (const msg of messages) {
    if (!msg.attachments || msg.attachments.length === 0) {
      result.push(msg)
      continue
    }

    if (supportsVision && msg.attachments.every(isVisionAttachment)) {
      result.push(msg)
      continue
    }

    const parts: string[] = []
    if (msg.content?.trim()) parts.push(msg.content)
    const remainingImageAttachments: Attachment[] = []

    for (const attachment of msg.attachments) {
      if (supportsVision && isVisionAttachment(attachment)) {
        remainingImageAttachments.push(attachment)
        continue
      }
      const text = await resolveAttachmentToText(attachment, supportsVision)
      if (text) parts.push(text)
    }

    result.push({
      ...msg,
      content: parts.join('\n\n'),
      attachments: remainingImageAttachments,
    })
  }
  return result
}
