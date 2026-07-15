import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ToolContext } from './types.js'
import { webFetchTool } from './web-fetch.js'

function makeSimplePdf(): Buffer {
  const stream = 'BT /F1 12 Tf 100 700 Td (Hello World PDF test) Tj ET'
  const len = Buffer.byteLength(stream, 'latin1')
  return Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n5 0 obj<</Length ${len}>>stream\n${stream}\nendstream\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000061 00000 n \n0000000114 00000 n \n0000000268 00000 n \n0000000342 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n428\n%%EOF`,
    'latin1',
  )
}

function makeEmptyPdf(): Buffer {
  const stream = 'BT /F1 12 Tf 100 700 Td () Tj ET'
  const len = Buffer.byteLength(stream, 'latin1')
  return Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n5 0 obj<</Length ${len}>>stream\n${stream}\nendstream\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000061 00000 n \n0000000114 00000 n \n0000000268 00000 n \n0000000342 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n426\n%%EOF`,
    'latin1',
  )
}

function makeEncryptedPdf(): Buffer {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n3 0 obj<</Filter/Standard/V 2/Length 128/O<${'00'.repeat(16)}>/U<${'00'.repeat(16)}>/P 0>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000061 00000 n \n0000000114 00000 n \ntrailer<</Size 4/Root 1 0 R/Encrypt 3 0 R>>\nstartxref\n206\n%%EOF`,
    'latin1',
  )
}

describe('web_fetch tool', () => {
  const mockContext: ToolContext = {
    workdir: '/test/workdir',
    sessionId: 'test-session',
    sessionManager: {
      recordFileRead: vi.fn(),
      getReadFiles: vi.fn().mockReturnValue({}),
    } as any,
  }

  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  function mockResponse(body: string, init?: ResponseInit & { headers?: Record<string, string> }) {
    const headers = new Headers(init?.headers)
    return new Response(body, { ...init, headers })
  }

  it('rejects non-http URLs', async () => {
    const result = await webFetchTool.execute({ url: 'ftp://example.com' }, mockContext)
    expect(result.success).toBe(false)
    expect(result.error).toContain('http:// or https://')
  })

  it('fetches plain text and passes through', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockResponse('Hello world', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    )

    const result = await webFetchTool.execute({ url: 'https://example.com/file.txt', format: 'text' }, mockContext)
    expect(result.success).toBe(true)
    expect(result.output).toBe('Hello world')
  })

  it('converts HTML to markdown', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockResponse('<h1>Title</h1><p>Paragraph</p>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    )

    const result = await webFetchTool.execute({ url: 'https://example.com', format: 'markdown' }, mockContext)
    expect(result.success).toBe(true)
    expect(result.output).toContain('# Title')
    expect(result.output).toContain('Paragraph')
  })

  it('strips HTML tags for text format', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockResponse('<html><script>evil()</script><body><h1>Hello</h1><p>World</p></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    )

    const result = await webFetchTool.execute({ url: 'https://example.com', format: 'text' }, mockContext)
    expect(result.success).toBe(true)
    expect(result.output).not.toContain('<')
    expect(result.output).not.toContain('evil')
    expect(result.output).toContain('Hello')
    expect(result.output).toContain('World')
  })

  it('returns raw HTML for html format', async () => {
    const html = '<h1>Title</h1>'
    fetchSpy.mockResolvedValueOnce(
      mockResponse(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    )

    const result = await webFetchTool.execute({ url: 'https://example.com', format: 'html' }, mockContext)
    expect(result.success).toBe(true)
    expect(result.output).toBe(html)
  })

  it('returns image as base64 in metadata', async () => {
    const imageData = Buffer.from([0x89, 0x50, 0x4e, 0x47]) // PNG header bytes
    fetchSpy.mockResolvedValueOnce(
      new Response(imageData, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    )

    const result = await webFetchTool.execute({ url: 'https://example.com/img.png' }, mockContext)
    expect(result.success).toBe(true)
    expect(result.output).toBe('Image fetched successfully')
    expect(result.metadata).toBeDefined()
    expect(result.metadata!['mimeType']).toBe('image/png')
    expect(result.metadata!['base64Data']).toBe(imageData.toString('base64'))
  })

  it('treats SVG as text, not image', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>'
    fetchSpy.mockResolvedValueOnce(
      mockResponse(svg, {
        status: 200,
        headers: { 'content-type': 'image/svg+xml' },
      }),
    )

    const result = await webFetchTool.execute({ url: 'https://example.com/icon.svg', format: 'html' }, mockContext)
    expect(result.success).toBe(true)
    expect(result.output).toContain('<svg')
  })

  it('retries with honest UA on Cloudflare 403 challenge', async () => {
    const cfHeaders = new Headers({
      'cf-mitigated': 'challenge',
    })
    fetchSpy
      .mockResolvedValueOnce(new Response('blocked', { status: 403, headers: cfHeaders }))
      .mockResolvedValueOnce(mockResponse('Success', { status: 200, headers: { 'content-type': 'text/plain' } }))

    const result = await webFetchTool.execute({ url: 'https://example.com', format: 'text' }, mockContext)
    expect(result.success).toBe(true)
    expect(result.output).toBe('Success')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    // Second call should use honest UA
    const secondCallHeaders = fetchSpy.mock.calls[1]![1]!.headers as Record<string, string>
    expect(secondCallHeaders['User-Agent']).toBe('openfox')
  })

  it('returns error on non-403 Cloudflare blocks (no retry)', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Server Error', { status: 500 }))

    const result = await webFetchTool.execute({ url: 'https://example.com', format: 'text' }, mockContext)
    expect(result.success).toBe(false)
    expect(result.error).toContain('500')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('rejects responses exceeding content-length limit', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockResponse('x', {
        status: 200,
        headers: { 'content-length': '10000000', 'content-type': 'text/plain' },
      }),
    )

    const result = await webFetchTool.execute({ url: 'https://example.com/huge', format: 'text' }, mockContext)
    expect(result.success).toBe(false)
    expect(result.error).toContain('5MB')
  })

  it('defaults format to markdown', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockResponse('<h1>Title</h1>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    )

    const result = await webFetchTool.execute({ url: 'https://example.com' }, mockContext)
    expect(result.success).toBe(true)
    expect(result.output).toContain('# Title')
  })

  it('truncates output exceeding maxBytes', async () => {
    const largeContent = 'x'.repeat(200_000)
    fetchSpy.mockResolvedValueOnce(
      mockResponse(largeContent, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    )

    const result = await webFetchTool.execute({ url: 'https://example.com/large', format: 'text' }, mockContext)
    expect(result.success).toBe(true)
    expect(result.truncated).toBe(true)
    expect(result.output).toContain('[Output truncated')
  })

  it('has correct tool definition', () => {
    expect(webFetchTool.name).toBe('web_fetch')
    expect(webFetchTool.definition.function.name).toBe('web_fetch')
    expect((webFetchTool.definition.function.parameters as any).required).toEqual(['url'])
  })

  describe('web_fetch - PDF Support', () => {
    it('should extract text from a PDF URL', async () => {
      const pdfBuffer = makeSimplePdf()
      fetchSpy.mockResolvedValueOnce(
        new Response(pdfBuffer, {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        }),
      )

      const result = await webFetchTool.execute({ url: 'https://example.com/doc.pdf' }, mockContext)
      expect(result.success).toBe(true)
      expect(result.output).toContain('[Page 1/1]')
      expect(result.output).toContain('Hello World PDF test')
      expect(result.metadata).toBeDefined()
      expect(result.metadata!['format']).toBe('pdf')
      expect(result.metadata!['pageCount']).toBe(1)
    })

    it('should detect PDF by content even without content-type', async () => {
      const pdfBuffer = makeSimplePdf()
      fetchSpy.mockResolvedValueOnce(
        new Response(pdfBuffer, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        }),
      )

      const result = await webFetchTool.execute({ url: 'https://example.com/doc.pdf' }, mockContext)
      expect(result.success).toBe(true)
      expect(result.output).toContain('[Page 1/1]')
      expect(result.output).toContain('Hello World PDF test')
    })

    it('should return scanned PDF message when no text layer', async () => {
      const pdfBuffer = makeEmptyPdf()
      fetchSpy.mockResolvedValueOnce(
        new Response(pdfBuffer, {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        }),
      )

      const result = await webFetchTool.execute({ url: 'https://example.com/scanned.pdf' }, mockContext)
      expect(result.success).toBe(true)
      expect(result.output).toContain('has no text layer')
      expect(result.output).toContain('OCR')
      expect(result.metadata!['format']).toBe('pdf')
      expect(result.metadata!['pageCount']).toBe(1)
    })

    it('should return error for password-protected PDF', async () => {
      const pdfBuffer = makeEncryptedPdf()
      fetchSpy.mockResolvedValueOnce(
        new Response(pdfBuffer, {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        }),
      )

      const result = await webFetchTool.execute({ url: 'https://example.com/protected.pdf' }, mockContext)
      expect(result.success).toBe(false)
      expect(result.error).toContain('password-protected')
    })
  })
})
