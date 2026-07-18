/**
 * Unit tests for LLM message conversion with attachments
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { convertMessages } from './client-pure.js'
import { clearPdfBlockCache } from './resolve-attachments.js'
import type { LLMMessage } from './types.js'

function makeSimplePdfBuffer(): Buffer {
  const stream = 'BT /F1 12 Tf 100 700 Td (Hello World PDF test) Tj ET'
  const len = Buffer.byteLength(stream, 'latin1')
  return Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n5 0 obj<</Length ${len}>>stream\n${stream}\nendstream\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000061 00000 n \n0000000114 00000 n \n0000000268 00000 n \n0000000342 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n428\n%%EOF`,
    'latin1',
  )
}

describe('LLM Message Conversion with Attachments', () => {
  beforeEach(() => {
    clearPdfBlockCache()
  })

  describe('convertMessages', () => {
    it('should handle user messages with image attachments', async () => {
      const messages: LLMMessage[] = [
        {
          role: 'user',
          content: 'What is in this image?',
          attachments: [
            {
              id: 'test-1',
              filename: 'test.png',
              mimeType: 'image/png',
              size: 1000,
              data: 'data:image/png;base64,test',
            },
          ],
        },
      ]

      const result = await convertMessages(messages, true)

      expect(result).toHaveLength(1)
      const msg = result[0]
      expect(msg?.role).toBe('user')
      expect(msg?.content).toBeInstanceOf(Array)

      const content = msg?.content as Array<{ type: string; text?: string; image_url?: { url: string } }>
      expect(content).toHaveLength(2)
      expect(content[0]).toEqual({ type: 'text', text: 'What is in this image?' })
      expect(content[1]).toEqual({
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,test' },
      })
    })

    it('should handle user messages with multiple image attachments', async () => {
      const messages: LLMMessage[] = [
        {
          role: 'user',
          content: 'Compare these images',
          attachments: [
            {
              id: 'test-1',
              filename: 'img1.png',
              mimeType: 'image/png',
              size: 1000,
              data: 'data:image/png;base64,test1',
            },
            {
              id: 'test-2',
              filename: 'img2.jpg',
              mimeType: 'image/jpeg',
              size: 2000,
              data: 'data:image/jpeg;base64,test2',
            },
          ],
        },
      ]

      const result = await convertMessages(messages, true)

      expect(result).toHaveLength(1)
      const msg2 = result[0]
      const content = msg2?.content as Array<{ type: string; text?: string; image_url?: { url: string } }>
      expect(content).toHaveLength(3) // 1 text + 2 images
      expect(content[0]).toEqual({ type: 'text', text: 'Compare these images' })
      expect(content[1]).toEqual({
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,test1' },
      })
      expect(content[2]).toEqual({
        type: 'image_url',
        image_url: { url: 'data:image/jpeg;base64,test2' },
      })
    })

    it('should handle user messages with only image attachments (no text)', async () => {
      const messages: LLMMessage[] = [
        {
          role: 'user',
          content: '',
          attachments: [
            {
              id: 'test-1',
              filename: 'test.png',
              mimeType: 'image/png',
              size: 1000,
              data: 'data:image/png;base64,test',
            },
          ],
        },
      ]

      const result = await convertMessages(messages, true)

      expect(result).toHaveLength(1)
      const msg3 = result[0]
      const content = msg3?.content as Array<{ type: string; text?: string; image_url?: { url: string } }>
      expect(content).toHaveLength(1) // Only image, no text
      expect(content[0]).toEqual({
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,test' },
      })
    })

    it('should handle regular messages without attachments', async () => {
      const messages: LLMMessage[] = [
        {
          role: 'user',
          content: 'Hello, how are you?',
        },
      ]

      const result = await convertMessages(messages, true)

      expect(result).toHaveLength(1)
      const msg4 = result[0]
      expect(msg4?.role).toBe('user')
      expect(msg4?.content).toBe('Hello, how are you?')
    })

    it('should handle assistant messages with tool calls', async () => {
      const messages: LLMMessage[] = [
        {
          role: 'assistant',
          content: 'Let me check that for you',
          toolCalls: [
            {
              id: 'tool-1',
              name: 'search',
              arguments: { query: 'test' },
            },
          ],
        },
      ]

      const result = await convertMessages(messages, true)

      expect(result).toHaveLength(1)
      const msg5 = result[0]
      expect(msg5?.role).toBe('assistant')
      expect(msg5).toHaveProperty('tool_calls')
    })

    it('should handle tool messages', async () => {
      const messages: LLMMessage[] = [
        {
          role: 'tool',
          content: 'Search results: ...',
          toolCallId: 'tool-1',
        },
      ]

      const result = await convertMessages(messages, true)

      expect(result).toHaveLength(1)
      const msg6 = result[0]
      expect(msg6?.role).toBe('tool')
      expect((msg6 as any).tool_call_id).toBe('tool-1')
    })

    it('should filter out empty assistant messages', async () => {
      const messages: LLMMessage[] = [
        {
          role: 'assistant',
          content: '',
          toolCalls: [],
        },
        {
          role: 'user',
          content: 'Hello',
        },
      ]

      const result = await convertMessages(messages, true)

      expect(result).toHaveLength(1)
      const msg7 = result[0]
      expect(msg7?.role).toBe('user')
    })

    it('should handle text file attachments as text content', async () => {
      const messages: LLMMessage[] = [
        {
          role: 'user',
          content: 'Read this file',
          attachments: [
            {
              id: 'test-2',
              filename: 'data.json',
              mimeType: 'application/json',
              size: 50,
              data: '{"name":"test","value":42}',
            },
          ],
        },
      ]

      const result = await convertMessages(messages, true)

      expect(result).toHaveLength(1)
      const msg = result[0]
      const content = msg?.content as Array<{ type: string; text?: string }>
      expect(content).toHaveLength(2)
      expect(content[0]).toEqual({ type: 'text', text: 'Read this file' })
      expect(content[1]?.type).toBe('text')
      expect((content[1] as { text: string }).text).toContain('[File: data.json]')
      expect((content[1] as { text: string }).text).toContain('{"name":"test","value":42}')
    })

    it('should handle text/plain file attachments', async () => {
      const messages: LLMMessage[] = [
        {
          role: 'user',
          content: '',
          attachments: [
            {
              id: 'test-3',
              filename: 'notes.txt',
              mimeType: 'text/plain',
              size: 100,
              data: 'Hello, this is a text file.',
            },
          ],
        },
      ]

      const result = await convertMessages(messages, true)

      expect(result).toHaveLength(1)
      const msg = result[0]
      const content = msg?.content as Array<{ type: string; text?: string }>
      expect(content).toHaveLength(1)
      expect(content[0]?.type).toBe('text')
      expect((content[0] as { text: string }).text).toContain('[File: notes.txt]')
      expect((content[0] as { text: string }).text).toContain('Hello, this is a text file.')
    })

    it('should handle mixed image and text attachments', async () => {
      const messages: LLMMessage[] = [
        {
          role: 'user',
          content: 'Analyze this data and image',
          attachments: [
            {
              id: 'test-4',
              filename: 'data.csv',
              mimeType: 'text/csv',
              size: 50,
              data: 'name,value\ntest,42',
            },
            {
              id: 'test-5',
              filename: 'chart.png',
              mimeType: 'image/png',
              size: 2000,
              data: 'data:image/png;base64,chartdata',
            },
          ],
        },
      ]

      const result = await convertMessages(messages, true)

      expect(result).toHaveLength(1)
      const msg = result[0]
      const content = msg?.content as Array<{ type: string; text?: string; image_url?: { url: string } }>
      expect(content).toHaveLength(3)
      expect(content[0]).toEqual({ type: 'text', text: 'Analyze this data and image' })
      expect(content[1]?.type).toBe('text')
      expect((content[1] as { text: string }).text).toContain('[File: data.csv]')
      expect((content[1] as { text: string }).text).toContain('name,value')
      expect(content[2]).toEqual({
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,chartdata' },
      })
    })

    it('should handle XML attachments as text', async () => {
      const messages: LLMMessage[] = [
        {
          role: 'user',
          content: '',
          attachments: [
            {
              id: 'test-6',
              filename: 'config.xml',
              mimeType: 'application/xml',
              size: 100,
              data: '<root><item>value</item></root>',
            },
          ],
        },
      ]

      const result = await convertMessages(messages, true)

      expect(result).toHaveLength(1)
      const msg = result[0]
      const content = msg?.content as Array<{ type: string; text?: string }>
      expect(content).toHaveLength(1)
      expect(content[0]?.type).toBe('text')
      expect((content[0] as { text: string }).text).toContain('[File: config.xml]')
      expect((content[0] as { text: string }).text).toContain('<root>')
    })

    it('should handle PDF attachments by extracting text', async () => {
      const pdfBuffer = makeSimplePdfBuffer()
      const base64 = pdfBuffer.toString('base64')
      const dataUrl = `data:application/pdf;base64,${base64}`

      const messages: LLMMessage[] = [
        {
          role: 'user',
          content: 'What is in this PDF?',
          attachments: [
            {
              id: 'test-7',
              filename: 'doc.pdf',
              mimeType: 'application/pdf',
              size: pdfBuffer.length,
              data: dataUrl,
            },
          ],
        },
      ]

      const result = await convertMessages(messages, true)

      expect(result).toHaveLength(1)
      const msg = result[0]
      const content = msg?.content as Array<{ type: string; text?: string }>
      expect(content.length).toBeGreaterThanOrEqual(2)
      expect(content[0]).toEqual({ type: 'text', text: 'What is in this PDF?' })
      const allText = content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join(' ')
      expect(allText).toContain('[PDF: doc.pdf]')
      expect(allText).toContain('Hello World PDF test')
    })

    it('should handle PDF attachments as text when model lacks vision', async () => {
      const pdfBuffer = makeSimplePdfBuffer()
      const base64 = pdfBuffer.toString('base64')
      const dataUrl = `data:application/pdf;base64,${base64}`

      const messages: LLMMessage[] = [
        {
          role: 'user',
          content: '',
          attachments: [
            {
              id: 'test-8',
              filename: 'report.pdf',
              mimeType: 'application/pdf',
              size: pdfBuffer.length,
              data: dataUrl,
            },
          ],
        },
      ]

      const result = await convertMessages(messages, false)

      expect(result).toHaveLength(1)
      const msg = result[0]
      const content = msg?.content as Array<{ type: string; text?: string }>
      expect(content).toHaveLength(1)
      expect(content[0]?.type).toBe('text')
      const pdfText = (content[0] as { text: string }).text
      expect(pdfText).toContain('[PDF: report.pdf]')
      expect(pdfText).toContain('Hello World PDF test')
    })

    it('should produce interleaved image_url parts for PDF with images when vision enabled', async () => {
      const imagePdfBuffer = Buffer.from(
        '255044462d312e340a312030206f626a0a3c3c2f54797065202f436174616c6f67202f50616765732032203020523e3e0a656e646f626a0a322030206f626a0a3c3c2f54797065202f5061676573202f4b696473205b33203020525d202f436f756e7420313e3e0a656e646f626a0a332030206f626a0a3c3c2f54797065202f50616765202f506172656e74203220302052202f4d65646961426f78205b30203020323030203230305d202f5265736f7572636573203c3c2f584f626a656374203c3c2f496d312035203020523e3e3e3e202f436f6e74656e74732034203020523e3e0a656e646f626a0a342030206f626a0a3c3c2f4c656e6774682033323e3e0a73747265616d0a7120313030203020302031303020353020353020636d202f496d3120446f20510a656e6473747265616d0a656e646f626a0a352030206f626a0a3c3c2f54797065202f584f626a656374202f53756274797065202f496d616765202f57696474682032202f4865696768742032202f436f6c6f725370616365202f446576696365524742202f42697473506572436f6d706f6e656e742038202f4c656e6774682031323e3e0a73747265616d0aff0000ff0000ff0000ff00000a656e6473747265616d0a656e646f626a0a787265660a3020360a303030303030303030302036353533352066200a30303030303030303039203030303030206e200a30303030303030303536203030303030206e200a30303030303030313131203030303030206e200a30303030303030323335203030303030206e200a30303030303030333135203030303030206e200a747261696c65720a3c3c2f53697a652036202f526f6f742031203020523e3e0a7374617274787265660a3436380a2525454f460a',
        'hex',
      )
      const base64 = imagePdfBuffer.toString('base64')
      const dataUrl = `data:application/pdf;base64,${base64}`

      const messages: LLMMessage[] = [
        {
          role: 'user',
          content: 'Describe this PDF',
          attachments: [
            {
              id: 'test-img-pdf',
              filename: 'image.pdf',
              mimeType: 'application/pdf',
              size: imagePdfBuffer.length,
              data: dataUrl,
            },
          ],
        },
      ]

      const result = await convertMessages(messages, true)

      expect(result).toHaveLength(1)
      const msg = result[0]
      const content = msg?.content as Array<{ type: string; text?: string; image_url?: { url: string } }>
      expect(content.length).toBeGreaterThanOrEqual(2)
      expect(content[0]).toEqual({ type: 'text', text: 'Describe this PDF' })
      const imageParts = content.filter((c) => c.type === 'image_url')
      expect(imageParts.length).toBe(1)
      expect(imageParts[0]?.image_url?.url).toMatch(/^data:image\/png;base64,/)
    })

    it('should not produce image parts for PDF with images when vision disabled', async () => {
      const imagePdfBuffer = Buffer.from(
        '255044462d312e340a312030206f626a0a3c3c2f54797065202f436174616c6f67202f50616765732032203020523e3e0a656e646f626a0a322030206f626a0a3c3c2f54797065202f5061676573202f4b696473205b33203020525d202f436f756e7420313e3e0a656e646f626a0a332030206f626a0a3c3c2f54797065202f50616765202f506172656e74203220302052202f4d65646961426f78205b30203020323030203230305d202f5265736f7572636573203c3c2f584f626a656374203c3c2f496d312035203020523e3e3e3e202f436f6e74656e74732034203020523e3e0a656e646f626a0a342030206f626a0a3c3c2f4c656e6774682033323e3e0a73747265616d0a7120313030203020302031303020353020353020636d202f496d3120446f20510a656e6473747265616d0a656e646f626a0a352030206f626a0a3c3c2f54797065202f584f626a656374202f53756274797065202f496d616765202f57696474682032202f4865696768742032202f436f6c6f725370616365202f446576696365524742202f42697473506572436f6d706f6e656e742038202f4c656e6774682031323e3e0a73747265616d0aff0000ff0000ff0000ff00000a656e6473747265616d0a656e646f626a0a787265660a3020360a303030303030303030302036353533352066200a30303030303030303039203030303030206e200a30303030303030303536203030303030206e200a30303030303030313131203030303030206e200a30303030303030323335203030303030206e200a30303030303030333135203030303030206e200a747261696c65720a3c3c2f53697a652036202f526f6f742031203020523e3e0a7374617274787265660a3436380a2525454f460a',
        'hex',
      )
      const base64 = imagePdfBuffer.toString('base64')
      const dataUrl = `data:application/pdf;base64,${base64}`

      const messages: LLMMessage[] = [
        {
          role: 'user',
          content: '',
          attachments: [
            {
              id: 'test-img-pdf-novision',
              filename: 'image.pdf',
              mimeType: 'application/pdf',
              size: imagePdfBuffer.length,
              data: dataUrl,
            },
          ],
        },
      ]

      const result = await convertMessages(messages, false)

      expect(result).toHaveLength(1)
      const msg = result[0]
      const content = msg?.content as Array<{ type: string }>
      const imageParts = content.filter((c) => c.type === 'image_url')
      expect(imageParts.length).toBe(0)
      const textParts = content.filter((c) => c.type === 'text')
      expect(textParts.length).toBeGreaterThan(0)
    })
  })
})
