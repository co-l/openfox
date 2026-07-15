import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { ToolContext, Tool } from './types.js'

let mockDbSettings: Record<string, string | null> = {}

vi.mock('../db/settings.js', () => ({
  getSetting: vi.fn((key: string) => mockDbSettings[key] ?? null),
  SETTINGS_KEYS: {
    SEARCH_ENGINE: 'search.engine',
    SEARCH_TAVILY_API_KEY: 'search.tavilyApiKey',
    SEARCH_SEARXNG_URL: 'search.searxngUrl',
    SEARCH_SEARXNG_API_KEY: 'search.searxngApiKey',
  },
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const baseContext: ToolContext = {
  workdir: '/test',
  sessionId: 'test-session',
  sessionManager: null as any,
}

function resetEnv() {
  delete process.env['TAVILY_API_KEY']
  delete process.env['SEARXNG_URL']
  delete process.env['SEARXNG_API_KEY']
}

describe('web_search', () => {
  let webSearchTool: Tool

  beforeEach(async () => {
    resetEnv()
    mockDbSettings = {}
    mockFetch.mockReset()
    vi.clearAllMocks()
    const mod = await import('./web-search.js')
    webSearchTool = mod.webSearchTool
  })

  afterEach(() => {
    resetEnv()
  })

  describe('tool definition', () => {
    it('has name web_search', () => {
      expect(webSearchTool.name).toBe('web_search')
    })

    it('has query as required parameter', () => {
      const params = webSearchTool.definition.function.parameters
      expect(params['required']).toContain('query')
      expect(params['properties']).toBeDefined()
      const props = params['properties'] as Record<string, { type: string }>
      expect(props['query']?.type).toBe('string')
    })

    it('has max_results as optional parameter with default 5', () => {
      const params = webSearchTool.definition.function.parameters
      const props = params['properties'] as Record<string, { type: string }>
      expect(props['max_results']?.type).toBe('number')
      expect(params['required']).not.toContain('max_results')
    })
  })

  describe('no engine configured', () => {
    it('returns error when no engine configured', async () => {
      const result = await webSearchTool.execute({ query: 'test' }, baseContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('web_search requires at least one search engine configured')
    })

    it('returns error when None is selected even if env vars are set', async () => {
      process.env['TAVILY_API_KEY'] = 'tvly-key'
      process.env['SEARXNG_URL'] = 'http://searxng:4000'
      mockDbSettings['search.engine'] = ''

      const result = await webSearchTool.execute({ query: 'test' }, baseContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('web_search requires at least one search engine configured')
    })
  })

  describe('engine preference via SEARCH_ENGINE setting', () => {
    it('uses Tavily when SEARCH_ENGINE=tavily even if both configured', async () => {
      process.env['TAVILY_API_KEY'] = 'tvly-key'
      process.env['SEARXNG_URL'] = 'http://searxng:4000'
      mockDbSettings['search.engine'] = 'tavily'

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [{ title: 'Tavily Result', url: 'https://tavily.com', content: 'From Tavily' }],
          }),
      })

      const result = await webSearchTool.execute({ query: 'test' }, baseContext)

      expect(result.success).toBe(true)
      expect(result.output).toContain('Tavily Result')
      expect(mockFetch.mock.calls[0]![0]).toBe('https://api.tavily.com/search')
    })

    it('uses SearXNG when SEARCH_ENGINE=searxng even if Tavily also configured', async () => {
      process.env['TAVILY_API_KEY'] = 'tvly-key'
      process.env['SEARXNG_URL'] = 'http://searxng:4000'
      mockDbSettings['search.engine'] = 'searxng'

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [{ title: 'SearXNG Result', url: 'https://sx.com', content: 'From SearXNG' }],
          }),
      })

      const result = await webSearchTool.execute({ query: 'test' }, baseContext)

      expect(result.success).toBe(true)
      expect(result.output).toContain('SearXNG Result')
      expect(mockFetch.mock.calls[0]![0]).toContain('searxng:4000/search')
    })

    it('favors Tavily over SearXNG when no preference set (backward compat)', async () => {
      process.env['TAVILY_API_KEY'] = 'tvly-key'
      process.env['SEARXNG_URL'] = 'http://searxng:4000'

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [{ title: 'Auto Tavily', url: 'https://tavily.com', content: 'Auto' }],
          }),
      })

      const result = await webSearchTool.execute({ query: 'test' }, baseContext)

      expect(result.success).toBe(true)
      expect(result.output).toContain('Auto Tavily')
      expect(mockFetch.mock.calls[0]![0]).toBe('https://api.tavily.com/search')
    })

    it('returns no engine when Tavily preferred but no key', async () => {
      mockDbSettings['search.engine'] = 'tavily'
      process.env['SEARXNG_URL'] = 'http://searxng:4000'

      const result = await webSearchTool.execute({ query: 'test' }, baseContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('web_search requires at least one search engine configured')
    })

    it('returns no engine when SearXNG preferred but no URL', async () => {
      mockDbSettings['search.engine'] = 'searxng'
      process.env['TAVILY_API_KEY'] = 'tvly-key'

      const result = await webSearchTool.execute({ query: 'test' }, baseContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('web_search requires at least one search engine configured')
    })

    it('env var TAVILY_API_KEY overrides empty DB setting', async () => {
      process.env['TAVILY_API_KEY'] = 'tvly-from-env'
      mockDbSettings['search.tavilyApiKey'] = ''

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [{ title: 'Env Var Tavily', url: 'https://env.com', content: 'From env var' }],
          }),
      })

      const result = await webSearchTool.execute({ query: 'test' }, baseContext)

      expect(result.success).toBe(true)
      expect(result.output).toContain('Env Var Tavily')
    })
  })

  describe('Tavily backend', () => {
    beforeEach(() => {
      process.env['TAVILY_API_KEY'] = 'tvly-test-key'
    })

    it('returns formatted results on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [
              { title: 'Test Result', url: 'https://example.com', content: 'This is a test result' },
              { title: 'Second Result', url: 'https://example.org', content: 'Another result' },
            ],
          }),
      })

      const result = await webSearchTool.execute({ query: 'hello world' }, baseContext)

      expect(result.success).toBe(true)
      expect(result.output).toContain('[1] Test Result')
      expect(result.output).toContain('https://example.com')
      expect(result.output).toContain('This is a test result')
      expect(result.output).toContain('[2] Second Result')

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const callArgs = mockFetch.mock.calls[0]!
      expect(callArgs[0]).toBe('https://api.tavily.com/search')
      expect(callArgs[1]!.method).toBe('POST')
      const body = JSON.parse(callArgs[1]!.body)
      expect(body.api_key).toBe('tvly-test-key')
      expect(body.query).toBe('hello world')
      expect(body.max_results).toBe(5)
    })

    it('respects max_results parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [
              { title: 'R1', url: 'https://a.com', content: 'A' },
              { title: 'R2', url: 'https://b.com', content: 'B' },
            ],
          }),
      })

      await webSearchTool.execute({ query: 'test', max_results: 2 }, baseContext)

      const body2 = JSON.parse(mockFetch.mock.calls[0]![1]!.body)
      expect(body2.max_results).toBe(2)
    })

    it('uses default max_results when not provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      })

      await webSearchTool.execute({ query: 'test' }, baseContext)

      const body2 = JSON.parse(mockFetch.mock.calls[0]![1]!.body)
      expect(body2.max_results).toBe(5)
    })

    it('clamps max_results=0 to default (5)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      })

      await webSearchTool.execute({ query: 'test', max_results: 0 }, baseContext)

      const body2 = JSON.parse(mockFetch.mock.calls[0]![1]!.body)
      expect(body2.max_results).toBe(5)
    })

    it('clamps negative max_results to default (5)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      })

      await webSearchTool.execute({ query: 'test', max_results: -1 }, baseContext)

      const body2 = JSON.parse(mockFetch.mock.calls[0]![1]!.body)
      expect(body2.max_results).toBe(5)
    })

    it('returns no results message when empty', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      })

      const result = await webSearchTool.execute({ query: 'nothing' }, baseContext)

      expect(result.success).toBe(true)
      expect(result.output).toBe('No search results found.')
    })

    it('handles HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      })

      const result = await webSearchTool.execute({ query: 'test' }, baseContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Tavily search failed (401)')
    })

    it('handles 403 Forbidden', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden'),
      })

      const result = await webSearchTool.execute({ query: 'test' }, baseContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Tavily search failed (403)')
    })

    it('handles timeout', async () => {
      mockFetch.mockRejectedValueOnce(new DOMException('The operation was aborted', 'AbortError'))

      const result = await webSearchTool.execute({ query: 'test' }, baseContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('timed out')
    })

    it('handles network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'))

      const result = await webSearchTool.execute({ query: 'test' }, baseContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Connection refused')
    })

    it('handles empty query string', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [{ title: 'Empty Q', url: 'https://a.com', content: 'C' }],
          }),
      })

      const result = await webSearchTool.execute({ query: '' }, baseContext)

      expect(result.success).toBe(true)
      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body)
      expect(body.query).toBe('')
    })

    it('handles query with special characters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [{ title: 'Special', url: 'https://a.com', content: 'C++ & .NET <3' }],
          }),
      })

      const result = await webSearchTool.execute({ query: 'C++ & .NET <3' }, baseContext)

      expect(result.success).toBe(true)
      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body)
      expect(body.query).toBe('C++ & .NET <3')
    })

    it('does not leak API key in output', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [{ title: 'Result', url: 'https://a.com', content: 'Content' }],
          }),
      })

      const result = await webSearchTool.execute({ query: 'test' }, baseContext)

      expect(result.output).not.toContain('tvly-test-key')
    })

    it('does not leak API key in error messages', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      })

      const result = await webSearchTool.execute({ query: 'test' }, baseContext)

      expect(result.error).not.toContain('tvly-test-key')
    })
  })

  describe('SearXNG backend', () => {
    beforeEach(() => {
      process.env['SEARXNG_URL'] = 'http://searxng:4000'
    })

    it('returns formatted results on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [{ title: 'SX Result', url: 'https://sx.com', content: 'SearXNG result' }],
          }),
      })

      const result = await webSearchTool.execute({ query: 'search term' }, baseContext)

      expect(result.success).toBe(true)
      expect(result.output).toContain('SX Result')
      const url1 = mockFetch.mock.calls[0]![0] as string
      expect(url1).toContain('http://searxng:4000/search')
      expect(url1).toContain('format=json')
      expect(url1).toContain('q=search+term')
    })

    it('sends Authorization header when API key is set', async () => {
      process.env['SEARXNG_API_KEY'] = 'sx-secret-key'
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      })

      await webSearchTool.execute({ query: 'test' }, baseContext)

      expect(mockFetch.mock.calls[0]![1]!.headers['Authorization']).toBe('Bearer sx-secret-key')
    })

    it('does not send Authorization header when no API key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      })

      await webSearchTool.execute({ query: 'test' }, baseContext)

      expect(mockFetch.mock.calls[0]![1]!.headers?.['Authorization']).toBeUndefined()
    })

    it('limits results to max_results', async () => {
      const manyResults = Array.from({ length: 10 }, (_, i) => ({
        title: `R${i}`,
        url: `https://r${i}.com`,
        content: `Result ${i}`,
      }))

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ results: manyResults }),
      })

      const result = await webSearchTool.execute({ query: 'test', max_results: 3 }, baseContext)

      const matches = result.output!.match(/\[\d+\]/g)
      expect(matches).toHaveLength(3)
    })

    it('returns all results when max_results larger than available', async () => {
      const manyResults = Array.from({ length: 3 }, (_, i) => ({
        title: `R${i}`,
        url: `https://r${i}.com`,
        content: `Result ${i}`,
      }))

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ results: manyResults }),
      })

      const result = await webSearchTool.execute({ query: 'test', max_results: 10 }, baseContext)

      const matches = result.output!.match(/\[\d+\]/g)
      expect(matches).toHaveLength(3)
    })

    it('handles HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal error'),
      })

      const result = await webSearchTool.execute({ query: 'test' }, baseContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('SearXNG search failed (500)')
    })

    it('handles 404 from SearXNG', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not Found'),
      })

      const result = await webSearchTool.execute({ query: 'test' }, baseContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('SearXNG search failed (404)')
    })

    it('works with trailing slash in URL', async () => {
      process.env['SEARXNG_URL'] = 'http://searxng:4000/'

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [{ title: 'Trailing', url: 'https://a.com', content: 'Slash works' }],
          }),
      })

      const result = await webSearchTool.execute({ query: 'test' }, baseContext)

      expect(result.success).toBe(true)
      const url1 = mockFetch.mock.calls[0]![0] as string
      expect(url1).toBe('http://searxng:4000/search?format=json&q=test')
    })

    it('handles query with special characters (URL encoded)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [{ title: 'Special', url: 'https://a.com', content: 'Special chars' }],
          }),
      })

      const result = await webSearchTool.execute({ query: 'hello world & foo' }, baseContext)

      expect(result.success).toBe(true)
      const url1 = mockFetch.mock.calls[0]![0] as string
      // URLSearchParams encodes spaces as +, not %20
      expect(url1).toContain('q=hello+world+%26+foo')
    })

    it('does not leak API key in output', async () => {
      process.env['SEARXNG_API_KEY'] = 'sx-super-secret'
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [{ title: 'R', url: 'https://a.com', content: 'C' }],
          }),
      })

      const result = await webSearchTool.execute({ query: 'test' }, baseContext)

      expect(result.output).not.toContain('sx-super-secret')
    })

    it('does not leak API key in error messages', async () => {
      process.env['SEARXNG_API_KEY'] = 'sx-super-secret'
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Error'),
      })

      const result = await webSearchTool.execute({ query: 'test' }, baseContext)

      expect(result.error).not.toContain('sx-super-secret')
    })
  })

  describe('abort signal', () => {
    beforeEach(() => {
      process.env['TAVILY_API_KEY'] = 'tvly-test-key'
    })

    it('respects context abort signal for Tavily', async () => {
      const abortController = new AbortController()
      abortController.abort()

      const result = await webSearchTool.execute({ query: 'test' }, { ...baseContext, signal: abortController.signal })

      // Aborted signal should cause a fetch abort
      expect(result.success).toBe(false)
    })

    it('uses tool timeout when no context signal', async () => {
      // No signal provided, should use default AbortSignal.timeout(15000)
      mockFetch.mockImplementationOnce(async (_url: string, opts: RequestInit) => {
        expect(opts.signal).toBeDefined()
        return {
          ok: true,
          json: () => Promise.resolve({ results: [] }),
        }
      })

      await webSearchTool.execute({ query: 'test' }, baseContext)

      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('timing metadata', () => {
    it('reports durationMs on success', async () => {
      process.env['TAVILY_API_KEY'] = 'tvly-test-key'
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      })

      const result = await webSearchTool.execute({ query: 'test' }, baseContext)

      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('reports durationMs on error', async () => {
      const result = await webSearchTool.execute({ query: 'test' }, baseContext)

      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })
  })
})
