import { OUTPUT_LIMITS } from './types.js'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PNG } from 'pngjs'

const PDF_HEADER = Buffer.from('%PDF')

export function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer.subarray(0, 4).equals(PDF_HEADER)
}

export interface PdfBlock {
  type: 'text' | 'image'
  content?: string
  dataUrl?: string
}

export interface PdfResult {
  blocks: PdfBlock[]
  pageCount: number
  title: string | null
  author: string | null
  imageCount: number
  imageLimitReached: boolean
}

export interface ProcessedPdf {
  output: string
  truncated: boolean
  isScanned: boolean
}

export function isPasswordError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message.toLowerCase().includes('password') || message.toLowerCase().includes('encrypt')
}

export function formatPdfErrorMessage(err: unknown): string {
  if (isPasswordError(err)) {
    return 'This PDF is password-protected. Unlock it with an external tool first.'
  }
  return `Failed to read PDF: ${err instanceof Error ? err.message : String(err)}`
}

export function processPdfContent(text: string, maxBytes: number): ProcessedPdf {
  let output = text
  let truncated = false

  if (output.length > maxBytes) {
    output = output.slice(0, maxBytes) + '\n\n[Output truncated due to size limit]'
    truncated = true
  }

  const isScanned = output.replace(/\[Page \d+\/\d+\]\n/g, '').trim().length === 0

  return { output, truncated, isScanned }
}

export interface RawImageData {
  width: number
  height: number
  data: Uint8Array | Uint8ClampedArray
  kind: number
}

const IMAGE_KIND_GRAYSCALE_1BPP = 1
const IMAGE_KIND_RGB_24BPP = 2
const IMAGE_KIND_RGBA_32BPP = 3

export function encodeImageToDataUrl(imgData: RawImageData, maxDimension = 1024): string | null {
  try {
    let { width, height, data, kind } = imgData

    if (maxDimension > 0 && (width > maxDimension || height > maxDimension)) {
      const scale = maxDimension / Math.max(width, height)
      const newWidth = Math.round(width * scale)
      const newHeight = Math.round(height * scale)
      const scaled = new Uint8Array(newWidth * newHeight * 4)

      for (let y = 0; y < newHeight; y++) {
        for (let x = 0; x < newWidth; x++) {
          const srcX = Math.floor(x / scale)
          const srcY = Math.floor(y / scale)
          const srcIdx = (srcY * width + srcX) * 4
          const dstIdx = (y * newWidth + x) * 4
          scaled[dstIdx] = data[srcIdx] ?? 0
          scaled[dstIdx + 1] = data[srcIdx + 1] ?? 0
          scaled[dstIdx + 2] = data[srcIdx + 2] ?? 0
          scaled[dstIdx + 3] = data[srcIdx + 3] ?? 255
        }
      }

      width = newWidth
      height = newHeight
      data = scaled
      kind = IMAGE_KIND_RGBA_32BPP
    }

    const png = new PNG({ width, height })
    const pixels = png.data

    if (kind === IMAGE_KIND_RGBA_32BPP) {
      Buffer.from(data.buffer, data.byteOffset, data.byteLength).copy(pixels)
    } else if (kind === IMAGE_KIND_RGB_24BPP) {
      for (let i = 0, j = 0; i < width * height; i++, j += 3) {
        pixels[i * 4] = data[j] ?? 0
        pixels[i * 4 + 1] = data[j + 1] ?? 0
        pixels[i * 4 + 2] = data[j + 2] ?? 0
        pixels[i * 4 + 3] = 255
      }
    } else if (kind === IMAGE_KIND_GRAYSCALE_1BPP) {
      const bytesPerRow = Math.ceil(width / 8)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const byteIdx = y * bytesPerRow + Math.floor(x / 8)
          const bitIdx = 7 - (x % 8)
          const val = ((data[byteIdx] ?? 0) >> bitIdx) & 1 ? 255 : 0
          const dst = (y * width + x) * 4
          pixels[dst] = val
          pixels[dst + 1] = val
          pixels[dst + 2] = val
          pixels[dst + 3] = 255
        }
      }
    } else {
      return null
    }

    const pngBuffer = PNG.sync.write(png)
    return `data:image/png;base64,${pngBuffer.toString('base64')}`
  } catch {
    return null
  }
}

async function extractPageBlocks(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof getDocument>['promise']>['getPage']>>,
  pageIndex: number,
  pageCount: number,
  imageCounter: { count: number; limitReached: boolean },
  maxImages: number,
): Promise<PdfBlock[]> {
  const [textContent, opList] = await Promise.all([page.getTextContent(), page.getOperatorList()])

  const textItems = textContent.items.filter(
    (item): item is Extract<(typeof textContent.items)[number], { str: string }> => 'str' in item,
  )

  const textStr = textItems
    .map((t) => t.str)
    .join(' ')
    .trim()

  const imageOpIndices: number[] = []
  for (let i = 0; i < opList.fnArray.length; i++) {
    const op = opList.fnArray[i]
    if (op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject) {
      imageOpIndices.push(i)
    }
  }

  const blocks: PdfBlock[] = []

  if (textStr) {
    blocks.push({ type: 'text', content: `[Page ${pageIndex}/${pageCount}]\n${textStr}` })
  }

  for (let imageOpIdx = 0; imageOpIdx < imageOpIndices.length; imageOpIdx++) {
    if (imageCounter.count >= maxImages) {
      imageCounter.limitReached = true
      break
    }
    const opIdx = imageOpIndices[imageOpIdx]!
    const imgBlock = await extractImageBlock(page, opList, opIdx)
    if (imgBlock) {
      blocks.push(imgBlock)
      imageCounter.count++
    }
  }

  return blocks
}

interface PdfObjects {
  get(objId: string): unknown
}
interface ExtractImagePage {
  objs: PdfObjects
  commonObjs: PdfObjects
}

async function extractImageBlock(
  page: ExtractImagePage,
  opList: { argsArray: unknown[] },
  opIdx: number,
): Promise<PdfBlock | null> {
  const args = opList.argsArray[opIdx]
  const objId = Array.isArray(args) ? (args[0] as string | undefined) : undefined

  let imgData: RawImageData | null = null

  if (objId && typeof objId === 'string') {
    try {
      const raw = objId.startsWith('g_') ? page.commonObjs.get(objId) : page.objs.get(objId)
      if (raw && typeof raw === 'object' && 'width' in raw && 'height' in raw && 'data' in raw) {
        imgData = raw as RawImageData
      }
    } catch {
      // ignore
    }
  } else if (Array.isArray(args) && args[0] && typeof args[0] === 'object' && 'width' in (args[0] as object)) {
    imgData = args[0] as RawImageData
  }

  if (imgData) {
    const dataUrl = encodeImageToDataUrl(imgData)
    if (dataUrl) {
      return { type: 'image', dataUrl }
    }
  }

  return null
}

export async function extractPdfContent(buffer: Buffer): Promise<PdfResult> {
  const doc = await getDocument({ data: Uint8Array.from(buffer) }).promise
  const pageCount = doc.numPages

  const rawMeta = await doc.getMetadata()
  const info = rawMeta.info as Record<string, unknown> | undefined
  const title = (info?.['Title'] as string) || null
  const author = (info?.['Author'] as string) || null

  const allBlocks: PdfBlock[] = []
  const limitedPageCount = Math.min(pageCount, OUTPUT_LIMITS.read_file.maxPdfPages)
  const maxImages = OUTPUT_LIMITS.read_file.maxPdfImages
  const imageCounter = { count: 0, limitReached: false }

  try {
    for (let i = 1; i <= limitedPageCount; i++) {
      const page = await doc.getPage(i)
      try {
        const blocks = await extractPageBlocks(page, i, pageCount, imageCounter, maxImages)
        allBlocks.push(...blocks)
      } finally {
        page.cleanup()
      }
    }
  } finally {
    doc.cleanup()
  }

  if (pageCount > limitedPageCount) {
    allBlocks.push({
      type: 'text',
      content: `[PDF has ${pageCount} pages, showing first ${limitedPageCount}. Use a shell command to process more.]`,
    })
  }

  if (imageCounter.limitReached) {
    allBlocks.push({
      type: 'text',
      content: `[Image limit reached: showing first ${maxImages} images out of more in this document.]`,
    })
  }

  return {
    blocks: allBlocks,
    pageCount,
    title,
    author,
    imageCount: imageCounter.count,
    imageLimitReached: imageCounter.limitReached,
  }
}

export async function extractPdfText(
  buffer: Buffer,
): Promise<{ text: string; pageCount: number; title: string | null; author: string | null }> {
  const result = await extractPdfContent(buffer)
  const text = result.blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.content ?? '')
    .join('\n\n')
  return { text, pageCount: result.pageCount, title: result.title, author: result.author }
}
