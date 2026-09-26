import TurndownService from 'turndown'
import { createTool, buildSignal } from './tool-helpers.js'
import { OUTPUT_LIMITS } from './types.js'
import { isPdfBuffer, extractPdfText, processPdfContent, formatPdfErrorMessage } from './pdf-utils.js'

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT_MS = 30_000

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'

interface WebFetchArgs {
  url: string
  format?: 'text' | 'markdown' | 'html'
  timeout?: number
}

function buildAcceptHeader(format: string): string {
  switch (format) {
    case 'markdown':
      return 'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1'
    case 'text':
      return 'text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1'
    case 'html':
      return 'text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1'
    default:
      return 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  }
}

function convertHTMLToMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  })
  turndown.remove(['script', 'style', 'meta', 'link'])
  return turndown.turndown(html)
}

function stripHTMLTags(html: string): string {
  const text = html
    .replace(/<(script|style|noscript|iframe|object|embed)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text
}

export const webFetchTool = createTool<WebFetchArgs>(
  'web_fetch',
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description:
        'Fetch content from a URL and return it as text, markdown, or HTML. For PDF URLs, extracts text content page by page. Use this to retrieve and analyze web content such as documentation, API references, or web pages.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to fetch content from (must start with http:// or https://)',
          },
          format: {
            type: 'string',
            enum: ['text', 'markdown', 'html'],
            description: 'Output format. Defaults to markdown.',
          },
          timeout: {
            type: 'number',
            description: 'Optional timeout in seconds. Defaults to 30.',
          },
        },
        required: ['url'],
      },
    },
  },
  async (args, context, helpers) => {
    const url = args.url
    const format = args.format ?? 'markdown'

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return helpers.error('URL must start with http:// or https://')
    }

    const timeoutMs = (args.timeout ?? DEFAULT_TIMEOUT_MS / 1000) * 1000
    const signal = buildSignal(timeoutMs, context.signal)

    const headers = {
      'User-Agent': USER_AGENT,
      Accept: buildAcceptHeader(format),
      'Accept-Language': 'en-US,en;q=0.9',
    }

    const initial = await fetch(url, { signal, headers })

    const response =
      initial.status === 403 && initial.headers.get('cf-mitigated') === 'challenge'
        ? await fetch(url, { signal, headers: { ...headers, 'User-Agent': 'openfox' } })
        : initial

    if (!response.ok) {
      return helpers.error(`Request failed with status code: ${response.status}`)
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
      return helpers.error('Response too large (exceeds 5MB limit)')
    }

    const arrayBuffer = await response.arrayBuffer()
    if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
      return helpers.error('Response too large (exceeds 5MB limit)')
    }

    const contentType = response.headers.get('content-type') || ''
    const mime = contentType.split(';')[0]?.trim().toLowerCase() || ''

    const isImage = mime.startsWith('image/') && mime !== 'image/svg+xml' && mime !== 'image/vnd.fastbidsheet'

    if (isImage) {
      const base64Data = Buffer.from(arrayBuffer).toString('base64')
      return helpers.success('Image fetched successfully', false, {
        metadata: {
          mimeType: mime,
          base64Data,
          url,
          contentType,
        },
      })
    }

    // Detect if this is a PDF
    const rawBuffer = Buffer.from(arrayBuffer)
    const isPdfResponse = mime === 'application/pdf' || isPdfBuffer(rawBuffer)

    if (isPdfResponse) {
      try {
        const { text, pageCount, title, author } = await extractPdfText(rawBuffer)
        const { output, truncated, isScanned } = processPdfContent(text, OUTPUT_LIMITS.web_fetch.maxBytes)

        if (isScanned) {
          return helpers.success(
            '[PDF: This PDF has no text layer (scanned or image-only). Use an external tool with OCR to extract text.]',
            false,
            {
              metadata: {
                format: 'pdf',
                pageCount,
                title,
                author,
                url,
              },
            },
          )
        }

        return helpers.success(output, truncated, {
          metadata: {
            format: 'pdf',
            pageCount,
            title,
            author,
            url,
          },
        })
      } catch (err) {
        return helpers.error(formatPdfErrorMessage(err))
      }
    }

    const rawContent = new TextDecoder().decode(arrayBuffer)
    let output: string

    switch (format) {
      case 'markdown':
        output = contentType.includes('text/html') ? convertHTMLToMarkdown(rawContent) : rawContent
        break
      case 'text':
        output = contentType.includes('text/html') ? stripHTMLTags(rawContent) : rawContent
        break
      case 'html':
        output = rawContent
        break
      default:
        output = rawContent
    }

    const maxBytes = OUTPUT_LIMITS.web_fetch.maxBytes
    let truncated = false
    if (output.length > maxBytes) {
      output = output.slice(0, maxBytes) + '\n\n[Output truncated due to size limit]'
      truncated = true
    }

    return helpers.success(output, truncated, {
      metadata: { url, contentType },
    })
  },
)
