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
  bitmap?: unknown
}

const IMAGE_KIND_GRAYSCALE_1BPP = 1
const IMAGE_KIND_RGB_24BPP = 2
const IMAGE_KIND_RGBA_32BPP = 3

function getRgbaPixel(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  kind: number,
): [number, number, number, number] {
  if (kind === IMAGE_KIND_RGBA_32BPP) {
    const i = (y * width + x) * 4
    return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 255]
  }
  if (kind === IMAGE_KIND_RGB_24BPP) {
    const i = (y * width + x) * 3
    return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, 255]
  }
  if (kind === IMAGE_KIND_GRAYSCALE_1BPP) {
    const bytesPerRow = Math.ceil(width / 8)
    const byteIdx = y * bytesPerRow + Math.floor(x / 8)
    const bitIdx = 7 - (x % 8)
    const val = ((data[byteIdx] ?? 0) >> bitIdx) & 1 ? 255 : 0
    return [val, val, val, 255]
  }
  return [0, 0, 0, 255]
}

function toRgbaBuffer(data: Uint8Array | Uint8ClampedArray, width: number, height: number, kind: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getRgbaPixel(data, width, x, y, kind)
      const i = (y * width + x) * 4
      rgba[i] = r
      rgba[i + 1] = g
      rgba[i + 2] = b
      rgba[i + 3] = a
    }
  }
  return rgba
}

// OffscreenCanvas and ImageBitmap are available in Node.js 20+ without DOM lib.
/* eslint-disable @typescript-eslint/no-explicit-any */
function extractBitmapToRawImageData(bitmap: any): RawImageData {
  const canvas = new (globalThis as any).OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  return {
    width: bitmap.width,
    height: bitmap.height,
    data: new Uint8Array(imageData.data.buffer),
    kind: IMAGE_KIND_RGBA_32BPP,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function encodeImageToDataUrl(imgData: RawImageData, maxDimension = 1024): string | null {
  try {
    let { width, height } = imgData
    let { data, kind } = imgData

    if (imgData.bitmap && !data) {
      const converted = extractBitmapToRawImageData(imgData.bitmap)
      data = converted.data
      kind = converted.kind
    }

    if (!data) return null
    if (width * height * 4 > 20_971_520) return null

    if (maxDimension > 0 && (width > maxDimension || height > maxDimension)) {
      const scale = maxDimension / Math.max(width, height)
      const newWidth = Math.round(width * scale)
      const newHeight = Math.round(height * scale)
      const scaled = new Uint8Array(newWidth * newHeight * 4)

      for (let y = 0; y < newHeight; y++) {
        for (let x = 0; x < newWidth; x++) {
          const srcX = Math.floor(x / scale)
          const srcY = Math.floor(y / scale)
          const dstI = (y * newWidth + x) * 4
          const [r, g, b, a] = getRgbaPixel(data, width, srcX, srcY, kind)
          scaled[dstI] = r
          scaled[dstI + 1] = g
          scaled[dstI + 2] = b
          scaled[dstI + 3] = a
        }
      }

      width = newWidth
      height = newHeight

      const png = new PNG({ width, height })
      Buffer.from(scaled.buffer, scaled.byteOffset, scaled.byteLength).copy(png.data)
      const pngBuffer = PNG.sync.write(png)
      return `data:image/png;base64,${pngBuffer.toString('base64')}`
    }

    let rgba: Uint8Array
    if (kind === IMAGE_KIND_RGBA_32BPP) {
      rgba = Uint8Array.from(
        data instanceof Uint8ClampedArray ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : data,
      )
    } else {
      rgba = toRgbaBuffer(data, width, height, kind)
    }

    const png = new PNG({ width, height })
    Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength).copy(png.data)
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
    if (
      op === OPS.paintImageXObject ||
      op === OPS.paintInlineImageXObject ||
      op === OPS.paintImageMaskXObject ||
      op === OPS.paintImageMaskXObjectGroup ||
      op === OPS.paintImageXObjectRepeat ||
      op === OPS.paintImageMaskXObjectRepeat ||
      op === OPS.paintInlineImageXObjectGroup ||
      op === OPS.paintSolidColorImageMask
    ) {
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
    const opIdx = imageOpIndices[imageOpIdx]
    if (opIdx === undefined) break
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
interface PdfObjectsAsync {
  get(objId: string, callback: (data: unknown) => void): null
}
interface ExtractImagePage {
  objs: PdfObjects & Partial<PdfObjectsAsync>
  commonObjs: PdfObjects & Partial<PdfObjectsAsync>
}

function isValidPixelData(data: unknown): data is Uint8Array | Uint8ClampedArray {
  return data instanceof Uint8Array || data instanceof Uint8ClampedArray
}

const IMAGE_RESOLVE_TIMEOUT_MS = 5000

async function getObjectWithFallback(objs: PdfObjects & Partial<PdfObjectsAsync>, objId: string): Promise<unknown> {
  try {
    return (objs as PdfObjects).get(objId)
  } catch {
    // Object not resolved yet — wait for it asynchronously
  }
  return new Promise<unknown>((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error('timeout')), IMAGE_RESOLVE_TIMEOUT_MS)
    try {
      ;(objs as PdfObjectsAsync).get(objId, (data) => {
        clearTimeout(timeoutId)
        resolve(data)
      })
    } catch (e) {
      clearTimeout(timeoutId)
      reject(e)
    }
  })
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
      const store = objId.startsWith('g_') ? page.commonObjs : page.objs
      const raw = await getObjectWithFallback(store, objId)
      if (raw && typeof raw === 'object' && 'width' in raw && 'height' in raw) {
        const r = raw as Record<string, unknown>
        if (isValidPixelData(r['data'])) {
          imgData = raw as RawImageData
        } else if (r['bitmap'] && !r['data']) {
          imgData = raw as RawImageData
        }
      }
    } catch {
      /* ignore extraction errors */
    }
  } else if (Array.isArray(args) && args[0] && typeof args[0] === 'object' && 'width' in (args[0] as object)) {
    const inline = args[0] as Record<string, unknown>
    if (isValidPixelData(inline['data'])) {
      imgData = args[0] as RawImageData
    } else if (inline['bitmap'] && !inline['data']) {
      imgData = args[0] as RawImageData
    }
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

  const allBlocks: PdfBlock[] = []
  const limitedPageCount = Math.min(pageCount, OUTPUT_LIMITS.read_file.maxPdfPages)
  const maxImages = OUTPUT_LIMITS.read_file.maxPdfImages
  const imageCounter = { count: 0, limitReached: false }

  let title: string | null = null
  let author: string | null = null

  try {
    const rawMeta = await doc.getMetadata()
    const info = rawMeta.info as Record<string, unknown> | undefined
    title = (info?.['Title'] as string) || null
    author = (info?.['Author'] as string) || null
  } catch {
    // metadata is optional, continue with null values
  }

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
  } catch {
    // page extraction failed, keep whatever blocks were collected
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
