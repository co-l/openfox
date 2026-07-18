import type { LLMMessage } from './types.js'
import type { Attachment } from '../../shared/types.js'
import { extractPdfText } from '../tools/pdf-utils.js'
import { TEXT_MIME_EXACT, TEXT_MIME_PREFIXES } from '../../shared/constants.js'

function decodeDataUrlToText(data: string): string {
  const match = data.match(/^data:.*?;base64,(.+)$/)
  if (match?.[1]) {
    return Buffer.from(match[1], 'base64').toString('utf8')
  }
  return data
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

async function resolveAttachmentToText(attachment: Attachment, supportsVision: boolean): Promise<string> {
  const mimeType = attachment.mimeType

  if (TEXT_MIME_EXACT.includes(mimeType) || TEXT_MIME_PREFIXES.some((p) => mimeType.startsWith(p))) {
    const text = decodeDataUrlToText(attachment.data)
    return `[File: ${attachment.filename || 'file'}]\n${text}`
  }

  if (mimeType === 'application/pdf') {
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

    if (supportsVision && msg.attachments.every((a) => a.mimeType.startsWith('image/'))) {
      result.push(msg)
      continue
    }

    const parts: string[] = []
    if (msg.content?.trim()) parts.push(msg.content)
    const remainingImageAttachments: Attachment[] = []

    for (const attachment of msg.attachments) {
      if (supportsVision && attachment.mimeType.startsWith('image/')) {
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
