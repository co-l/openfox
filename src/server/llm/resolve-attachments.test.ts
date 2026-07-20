import { describe, it, expect } from 'vitest'
import { resolveAttachmentsInMessages } from './client-pure.js'
import type { LLMMessage } from './types.js'

function makeSimplePdfBuffer(): Buffer {
  const stream = 'BT /F1 12 Tf 100 700 Td (Hello PDF) Tj ET'
  const len = Buffer.byteLength(stream, 'latin1')
  return Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n5 0 obj<</Length ${len}>>stream\n${stream}\nendstream\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000061 00000 n \n0000000114 00000 n \n0000000268 00000 n \n0000000342 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n428\n%%EOF`,
    'latin1',
  )
}

describe('resolveAttachmentsInMessages', () => {
  it('returns messages without attachments unchanged', async () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ]
    const result = await resolveAttachmentsInMessages(messages, false)
    expect(result).toHaveLength(2)
    expect(result[0]?.content).toBe('hello')
    expect(result[0]?.attachments).toBeUndefined()
  })

  it('injects text file content into message content', async () => {
    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: 'check this file',
        attachments: [
          {
            id: 'a1',
            filename: 'hello.ts',
            mimeType: 'text/plain',
            size: 20,
            data: 'const x = 1',
          },
        ],
      },
    ]
    const result = await resolveAttachmentsInMessages(messages, false)
    expect(result[0]?.content).toContain('hello.ts')
    expect(result[0]?.content).toContain('const x = 1')
    expect(result[0]?.attachments).toEqual([])
  })

  it('injects PDF text content into message content', async () => {
    const pdfBuffer = makeSimplePdfBuffer()
    const base64 = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`
    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: 'read this pdf',
        attachments: [
          {
            id: 'p1',
            filename: 'doc.pdf',
            mimeType: 'application/pdf',
            size: pdfBuffer.length,
            data: base64,
          },
        ],
      },
    ]
    const result = await resolveAttachmentsInMessages(messages, false)
    expect(result[0]?.content).toContain('doc.pdf')
    expect(result[0]?.attachments).toEqual([])
  })

  it('converts image to placeholder text when vision not supported', async () => {
    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: 'look at this',
        attachments: [
          {
            id: 'i1',
            filename: 'photo.png',
            mimeType: 'image/png',
            size: 500,
            data: 'data:image/png;base64,abc',
          },
        ],
      },
    ]
    const result = await resolveAttachmentsInMessages(messages, false)
    expect(result[0]?.content).toContain('photo.png')
    expect(result[0]?.attachments).toEqual([])
  })

  it('keeps PDF attachments intact when vision is supported', async () => {
    const pdfBuffer = makeSimplePdfBuffer()
    const data = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`
    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: 'look at this pdf',
        attachments: [
          {
            id: 'p2',
            filename: 'vision.pdf',
            mimeType: 'application/pdf',
            size: pdfBuffer.length,
            data,
          },
        ],
      },
    ]
    const result = await resolveAttachmentsInMessages(messages, true)
    expect(result[0]?.content).toBe('look at this pdf')
    expect(result[0]?.attachments).toHaveLength(1)
    expect(result[0]?.attachments?.[0]?.filename).toBe('vision.pdf')
  })

  it('keeps PDF and image attachments intact in a mixed vision message', async () => {
    const pdfBuffer = makeSimplePdfBuffer()
    const data = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`
    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: 'compare these',
        attachments: [
          {
            id: 'p3',
            filename: 'vision.pdf',
            mimeType: 'application/pdf',
            size: pdfBuffer.length,
            data,
          },
          {
            id: 'i3',
            filename: 'photo.png',
            mimeType: 'image/png',
            size: 500,
            data: 'data:image/png;base64,abc',
          },
        ],
      },
    ]
    const result = await resolveAttachmentsInMessages(messages, true)
    expect(result[0]?.content).toBe('compare these')
    expect(result[0]?.attachments?.map((attachment) => attachment.filename)).toEqual(['vision.pdf', 'photo.png'])
  })

  it('keeps image attachments intact when vision is supported', async () => {
    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: 'look at this',
        attachments: [
          {
            id: 'i2',
            filename: 'photo.png',
            mimeType: 'image/png',
            size: 500,
            data: 'data:image/png;base64,abc',
          },
        ],
      },
    ]
    const result = await resolveAttachmentsInMessages(messages, true)
    expect(result[0]?.content).toBe('look at this')
    expect(result[0]?.attachments).toHaveLength(1)
    expect(result[0]?.attachments?.[0]?.filename).toBe('photo.png')
  })

  it('decodes base64 data URL for text files', async () => {
    const content = 'const hello = "world"'
    const base64 = `data:text/plain;base64,${Buffer.from(content).toString('base64')}`
    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: 'check this',
        attachments: [
          {
            id: 'b1',
            filename: 'hello.ts',
            mimeType: 'text/plain',
            size: content.length,
            data: base64,
          },
        ],
      },
    ]
    const result = await resolveAttachmentsInMessages(messages, false)
    expect(result[0]?.content).toContain('hello.ts')
    expect(result[0]?.content).toContain('const hello = "world"')
    expect(result[0]?.content).not.toContain('base64')
  })

  it('produces placeholder for unknown mime type when vision is supported', async () => {
    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: 'check this',
        attachments: [
          {
            id: 'u1',
            filename: 'audio.mp3',
            mimeType: 'audio/mpeg',
            size: 100,
            data: 'data:audio/mpeg;base64,abc',
          },
        ],
      },
    ]
    const result = await resolveAttachmentsInMessages(messages, true)
    expect(result[0]?.content).toContain('audio.mp3')
    expect(result[0]?.content).toContain('audio/mpeg')
    expect(result[0]?.attachments).toEqual([])
  })

  it('preserves image attachments and produces placeholder for unknown type in mixed message', async () => {
    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: 'mixed',
        attachments: [
          {
            id: 'img1',
            filename: 'photo.png',
            mimeType: 'image/png',
            size: 500,
            data: 'data:image/png;base64,abc',
          },
          {
            id: 'aud1',
            filename: 'clip.mp3',
            mimeType: 'audio/mpeg',
            size: 100,
            data: 'data:audio/mpeg;base64,abc',
          },
        ],
      },
    ]
    const result = await resolveAttachmentsInMessages(messages, true)
    expect(result[0]?.attachments).toHaveLength(1)
    expect(result[0]?.attachments?.[0]?.filename).toBe('photo.png')
    expect(result[0]?.content).toContain('clip.mp3')
    expect(result[0]?.content).toContain('audio/mpeg')
  })

  it('handles tool messages with attachments', async () => {
    const messages: LLMMessage[] = [
      {
        role: 'tool',
        content: 'result',
        toolCallId: 'tc1',
        attachments: [
          {
            id: 't1',
            filename: 'output.txt',
            mimeType: 'text/plain',
            size: 10,
            data: 'some output',
          },
        ],
      },
    ]
    const result = await resolveAttachmentsInMessages(messages, false)
    expect(result[0]?.content).toContain('output.txt')
    expect(result[0]?.content).toContain('some output')
    expect(result[0]?.attachments).toEqual([])
  })
})
