import { describe, it, expect } from 'vitest'
import {
  extractPdfContent,
  extractPdfText,
  processPdfContent,
  isPasswordError,
  isPdfBuffer,
  encodeImageToDataUrl,
} from './pdf-utils.js'
import { OUTPUT_LIMITS } from './types.js'

function makeTextOnlyPdf(): Buffer {
  const stream = 'BT /F1 12 Tf 100 700 Td (Hello World PDF test) Tj ET'
  const len = Buffer.byteLength(stream, 'latin1')
  return Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n5 0 obj<</Length ${len}>>stream\n${stream}\nendstream\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000061 00000 n \n0000000114 00000 n \n0000000268 00000 n \n0000000342 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n428\n%%EOF`,
    'latin1',
  )
}

function makeImagePdf(): Buffer {
  return Buffer.from(
    '255044462d312e340a312030206f626a0a3c3c2f54797065202f436174616c6f67202f50616765732032203020523e3e0a656e646f626a0a322030206f626a0a3c3c2f54797065202f5061676573202f4b696473205b33203020525d202f436f756e7420313e3e0a656e646f626a0a332030206f626a0a3c3c2f54797065202f50616765202f506172656e74203220302052202f4d65646961426f78205b30203020323030203230305d202f5265736f7572636573203c3c2f584f626a656374203c3c2f496d312035203020523e3e3e3e202f436f6e74656e74732034203020523e3e0a656e646f626a0a342030206f626a0a3c3c2f4c656e6774682033323e3e0a73747265616d0a7120313030203020302031303020353020353020636d202f496d3120446f20510a656e6473747265616d0a656e646f626a0a352030206f626a0a3c3c2f54797065202f584f626a656374202f53756274797065202f496d616765202f57696474682032202f4865696768742032202f436f6c6f725370616365202f446576696365524742202f42697473506572436f6d706f6e656e742038202f4c656e6774682031323e3e0a73747265616d0aff0000ff0000ff0000ff00000a656e6473747265616d0a656e646f626a0a787265660a3020360a303030303030303030302036353533352066200a30303030303030303039203030303030206e200a30303030303030303536203030303030206e200a30303030303030313131203030303030206e200a30303030303030323335203030303030206e200a30303030303030333135203030303030206e200a747261696c65720a3c3c2f53697a652036202f526f6f742031203020523e3e0a7374617274787265660a3436380a2525454f460a',
    'hex',
  )
}

function makeMultiImagePdf(): Buffer {
  return Buffer.from(
    '255044462d312e340a312030206f626a0a3c3c2f547970652f436174616c6f672f50616765732032203020523e3e0a656e646f626a0a322030206f626a0a3c3c2f547970652f50616765732f4b6964735b33203020525d2f436f756e7420313e3e0a656e646f626a0a332030206f626a0a3c3c2f547970652f506167652f506172656e742032203020522f4d65646961426f785b30203020323030203230305d2f5265736f75726365733c3c2f466f6e743c3c2f46312036203020523e3e2f584f626a6563743c3c2f496d312035203020522f496d322037203020522f496d332038203020523e3e3e3e2f436f6e74656e74732034203020523e3e0a656e646f626a0a342030206f626a0a3c3c2f4c656e677468203131353e3e0a73747265616d0a4254202f463120313220546620302030205464202848656c6c6f2920546a204554207120322030203020322030203020636d202f496d3120446f2051207120322030203020322035203020636d202f496d3220446f205120712032203020302032203130203020636d202f496d3320446f20510a656e6473747265616d0a656e646f626a0a352030206f626a0a3c3c2f547970652f584f626a6563742f537562747970652f496d6167652f576964746820322f48656967687420322f436f6c6f7253706163652f4465766963655247422f42697473506572436f6d706f6e656e7420382f4c656e6774682031323e3e0a73747265616d0aff0000ff0000ff0000ff00000a656e6473747265616d0a656e646f626a0a362030206f626a0a3c3c2f547970652f466f6e742f537562747970652f54797065312f42617365466f6e742f48656c7665746963613e3e0a656e646f626a0a372030206f626a0a3c3c2f547970652f584f626a6563742f537562747970652f496d6167652f576964746820322f48656967687420322f436f6c6f7253706163652f4465766963655247422f42697473506572436f6d706f6e656e7420382f4c656e6774682031323e3e0a73747265616d0a00ff0000ff0000ff0000ff000a656e6473747265616d0a656e646f626a0a382030206f626a0a3c3c2f547970652f584f626a6563742f537562747970652f496d6167652f576964746820322f48656967687420322f436f6c6f7253706163652f4465766963655247422f42697473506572436f6d706f6e656e7420382f4c656e6774682031323e3e0a73747265616d0a0000ff0000ff0000ff0000ff0a656e6473747265616d0a656e646f626a0a787265660a3020390a303030303030303030302036353533352066200a30303030303030303039203030303030206e200a30303030303030303534203030303030206e200a30303030303030313035203030303030206e200a30303030303030323539203030303030206e200a30303030303030343233203030303030206e200a30303030303030353637203030303030206e200a30303030303030363330203030303030206e200a30303030303030373734203030303030206e200a747261696c65723c3c2f53697a652039202f526f6f742031203020523e3e0a7374617274787265660a3931380a2525454f460a',
    'hex',
  )
}

function makeImageBeforeTextPdf(): Buffer {
  return Buffer.from(
    '255044462d312e340a312030206f626a0a3c3c2f547970652f436174616c6f672f50616765732032203020523e3e0a656e646f626a0a322030206f626a0a3c3c2f547970652f50616765732f4b6964735b33203020525d2f436f756e7420313e3e0a656e646f626a0a332030206f626a0a3c3c2f547970652f506167652f506172656e742032203020522f4d65646961426f785b30203020323030203230305d2f5265736f75726365733c3c2f466f6e743c3c2f46312035203020523e3e2f584f626a6563743c3c2f496d312034203020523e3e3e3e2f436f6e74656e74732036203020523e3e0a656e646f626a0a342030206f626a0a3c3c2f547970652f584f626a6563742f537562747970652f496d6167652f576964746820322f48656967687420322f436f6c6f7253706163652f4465766963655247422f42697473506572436f6d706f6e656e7420382f4c656e6774682031323e3e0a73747265616d0aff0000ff0000ff0000ff00000a656e6473747265616d0a656e646f626a0a352030206f626a0a3c3c2f547970652f466f6e742f537562747970652f54797065312f42617365466f6e742f48656c7665746963613e3e0a656e646f626a0a362030206f626a0a3c3c2f4c656e6774682036363e3e0a73747265616d0a7120322030203020322030203020636d202f496d3120446f2051204254202f4631203132205466203020302054642028416674657220696d6167652920546a2045540a656e6473747265616d0a656e646f626a0a787265660a3020370a303030303030303030302036353533352066200a30303030303030303039203030303030206e200a30303030303030303534203030303030206e200a30303030303030313035203030303030206e200a30303030303030323339203030303030206e200a30303030303030333833203030303030206e200a30303030303030343436203030303030206e200a747261696c65723c3c2f53697a652037202f526f6f742031203020523e3e0a7374617274787265660a3536300a2525454f460a',
    'hex',
  )
}

describe('pdf-utils', () => {
  describe('isPdfBuffer', () => {
    it('detects PDF header', () => {
      expect(isPdfBuffer(makeTextOnlyPdf())).toBe(true)
      expect(isPdfBuffer(Buffer.from('not a pdf'))).toBe(false)
    })
  })

  describe('isPasswordError', () => {
    it('detects password errors', () => {
      expect(isPasswordError(new Error('Password required'))).toBe(true)
      expect(isPasswordError(new Error('encrypted document'))).toBe(true)
      expect(isPasswordError(new Error('some other error'))).toBe(false)
    })
  })

  describe('processPdfContent', () => {
    it('truncates long content', () => {
      const result = processPdfContent('a'.repeat(200), 100)
      expect(result.truncated).toBe(true)
      expect(result.output).toContain('[Output truncated')
    })

    it('detects scanned PDF (no text)', () => {
      const result = processPdfContent('[Page 1/1]\n', 10000)
      expect(result.isScanned).toBe(true)
    })

    it('does not mark non-scanned as scanned', () => {
      const result = processPdfContent('[Page 1/1]\nSome text here', 10000)
      expect(result.isScanned).toBe(false)
    })
  })

  describe('encodeImageToDataUrl', () => {
    it('encodes RGB 24BPP image data to PNG data URL', () => {
      const data = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0])
      const result = encodeImageToDataUrl({ width: 2, height: 2, data, kind: 2 })
      expect(result).toMatch(/^data:image\/png;base64,/)
    })

    it('encodes RGBA 32BPP image data to PNG data URL', () => {
      const data = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255])
      const result = encodeImageToDataUrl({ width: 2, height: 2, data, kind: 3 })
      expect(result).toMatch(/^data:image\/png;base64,/)
    })

    it('encodes grayscale 1BPP image data to PNG data URL', () => {
      const data = new Uint8Array([0b10100000])
      const result = encodeImageToDataUrl({ width: 2, height: 2, data, kind: 1 })
      expect(result).toMatch(/^data:image\/png;base64,/)
    })

    it('handles unknown image kind by producing black pixel', () => {
      const data = new Uint8Array([0])
      const result = encodeImageToDataUrl({ width: 1, height: 1, data, kind: 99 })
      expect(result).toMatch(/^data:image\/png;base64,/)
    })
  })

  describe('extractPdfContent', () => {
    it('extracts text from a text-only PDF as text blocks', async () => {
      const result = await extractPdfContent(makeTextOnlyPdf())
      expect(result.pageCount).toBe(1)
      expect(result.imageCount).toBe(0)
      expect(result.imageLimitReached).toBe(false)
      const textBlocks = result.blocks.filter((b) => b.type === 'text')
      expect(textBlocks.length).toBeGreaterThan(0)
      const allText = textBlocks.map((b) => b.content).join(' ')
      expect(allText).toContain('Hello World PDF test')
    })

    it('extracts images from a PDF with images', async () => {
      const result = await extractPdfContent(makeImagePdf())
      expect(result.pageCount).toBe(1)
      expect(result.imageCount).toBe(1)
      const imageBlocks = result.blocks.filter((b) => b.type === 'image')
      expect(imageBlocks.length).toBe(1)
      expect(imageBlocks[0]?.dataUrl).toMatch(/^data:image\/png;base64,/)
    })

    it('extracts multiple images from a multi-image PDF', async () => {
      const result = await extractPdfContent(makeMultiImagePdf())
      expect(result.pageCount).toBe(1)
      expect(result.imageCount).toBe(3)
      const imageBlocks = result.blocks.filter((b) => b.type === 'image')
      expect(imageBlocks.length).toBe(3)
      for (const block of imageBlocks) {
        expect(block.dataUrl).toMatch(/^data:image\/png;base64,/)
      }
    })

    it('places text before images in multi-image PDF', async () => {
      const result = await extractPdfContent(makeMultiImagePdf())
      expect(result.blocks.length).toBeGreaterThan(0)
      expect(result.blocks[0]?.type).toBe('text')
      expect(result.blocks[1]?.type).toBe('image')
      expect(result.blocks[2]?.type).toBe('image')
      expect(result.blocks[3]?.type).toBe('image')
    })

    it('places all text before images (approximate ordering)', async () => {
      const result = await extractPdfContent(makeImageBeforeTextPdf())
      expect(result.blocks.length).toBe(2)
      expect(result.blocks[0]?.type).toBe('text')
      expect(result.blocks[1]?.type).toBe('image')
      expect(result.blocks[0]?.content).toContain('After image')
    })

    it('extracts images even from image-only page (scanned)', async () => {
      const result = await extractPdfContent(makeImagePdf())
      const imageBlocks = result.blocks.filter((b) => b.type === 'image')
      expect(imageBlocks.length).toBe(1)
    })

    it('returns imageLimitReached false when under limit', async () => {
      const result = await extractPdfContent(makeTextOnlyPdf())
      expect(result.imageLimitReached).toBe(false)
    })

    it('hits image limit and appends informative message', async () => {
      const originalMax = OUTPUT_LIMITS.read_file.maxPdfImages
      OUTPUT_LIMITS.read_file.maxPdfImages = 2
      try {
        const result = await extractPdfContent(makeMultiImagePdf())
        expect(result.imageCount).toBe(2)
        expect(result.imageLimitReached).toBe(true)
        const limitMsg = result.blocks.find((b) => b.type === 'text' && b.content?.includes('Image limit reached'))
        expect(limitMsg).toBeDefined()
        expect(limitMsg?.content).toContain('showing first 2 images out of more')
      } finally {
        OUTPUT_LIMITS.read_file.maxPdfImages = originalMax
      }
    })
  })

  describe('extractPdfText (backwards compat)', () => {
    it('returns text and metadata from text-only PDF', async () => {
      const result = await extractPdfText(makeTextOnlyPdf())
      expect(result.pageCount).toBe(1)
      expect(result.text).toContain('Hello World PDF test')
      expect(result.title).toBeNull()
      expect(result.author).toBeNull()
    })
  })
})
