import { OUTPUT_LIMITS } from './types.js'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const PDF_HEADER = Buffer.from('%PDF')

export function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer.subarray(0, 4).equals(PDF_HEADER)
}

export interface PdfResult {
  text: string
  pageCount: number
  title: string | null
  author: string | null
}

export interface ProcessedPdf {
  output: string
  truncated: boolean
  isScanned: boolean
}

// NOTE: This relies on pdfjs-dist error message text which is not a stable API.
// A more robust approach would inspect the PDF's /Encrypt dictionary entry
// directly before attempting extraction. If upgrading pdfjs-dist breaks this,
// switch to checking `doc.catalog.get('Encrypt')` or similar.
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

export async function extractPdfText(buffer: Buffer): Promise<PdfResult> {
  const doc = await getDocument({ data: Uint8Array.from(buffer) }).promise
  const pageCount = doc.numPages

  const rawMeta = await doc.getMetadata()
  const info = rawMeta.info as Record<string, unknown> | undefined
  const title = (info?.['Title'] as string) || null
  const author = (info?.['Author'] as string) || null

  const pages: string[] = []
  const limitedPageCount = Math.min(pageCount, OUTPUT_LIMITS.read_file.maxPdfPages)

  try {
    for (let i = 1; i <= limitedPageCount; i++) {
      const page = await doc.getPage(i)
      try {
        const content = await page.getTextContent()
        const pageText = content.items.map((item) => ('str' in item ? item.str : '')).join(' ')
        pages.push(`[Page ${i}/${pageCount}]\n${pageText}`)
      } finally {
        page.cleanup()
      }
    }
  } finally {
    doc.cleanup()
  }

  let text = pages.join('\n\n')
  if (pageCount > limitedPageCount) {
    text += `\n\n[PDF has ${pageCount} pages, showing first ${limitedPageCount}. Use a shell command to process more.]`
  }

  return { text, pageCount, title, author }
}
