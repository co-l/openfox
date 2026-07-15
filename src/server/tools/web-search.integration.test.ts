import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ToolContext } from './types.js'

const context: ToolContext = {
  workdir: '/tmp',
  sessionId: 'integration-test',
  sessionManager: null as any,
}

const TEST_TIMEOUT = 20000

const hasTavily = !!process.env['TAVILY_API_KEY']
const hasSearxng = !!process.env['SEARXNG_URL']

const describeIfTavily = hasTavily ? describe : describe.skip
const describeIfSearxng = hasSearxng ? describe : describe.skip
const describeIfAny = hasTavily || hasSearxng ? describe : describe.skip

describeIfAny('web_search integration', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describeIfTavily('Tavily backend', () => {
    it(
      'returns real results for a French query',
      async () => {
        vi.stubEnv('SEARXNG_URL', '')
        vi.stubEnv('SEARXNG_API_KEY', '')

        const { webSearchTool } = await import('./web-search.js')
        const result = await webSearchTool.execute(
          { query: 'actualités intelligence artificielle 2026', max_results: 3 },
          context,
        )

        expect(result.success).toBe(true)
        expect(result.output).toContain('[1]')
        expect(result.output).toContain('http')
        expect(result.durationMs).toBeLessThan(10000)
      },
      TEST_TIMEOUT,
    )

    it(
      'rejects too-short queries',
      async () => {
        vi.stubEnv('SEARXNG_URL', '')

        const { webSearchTool } = await import('./web-search.js')
        const result = await webSearchTool.execute({ query: 'a' }, context)

        expect(result.success).toBe(false)
        expect(result.error).toContain('Tavily search failed (400)')
        expect(result.error).toContain('Query is too short')
      },
      TEST_TIMEOUT,
    )

    it(
      'returns error with invalid API key',
      async () => {
        vi.stubEnv('TAVILY_API_KEY', 'tvly-invalid-key')
        vi.stubEnv('SEARXNG_URL', '')

        const { webSearchTool } = await import('./web-search.js')
        const result = await webSearchTool.execute({ query: 'test' }, context)

        expect(result.success).toBe(false)
        expect(result.error).toContain('Tavily search failed')
      },
      TEST_TIMEOUT,
    )
  })

  describeIfSearxng('SearXNG backend', () => {
    it(
      'returns real results',
      async () => {
        vi.stubEnv('TAVILY_API_KEY', '')
        vi.stubEnv('SEARXNG_API_KEY', '')

        const { webSearchTool } = await import('./web-search.js')
        const result = await webSearchTool.execute({ query: 'intelligence artificielle', max_results: 3 }, context)

        expect(result.success).toBe(true)
        expect(result.output).toContain('[1]')
        expect(result.output).toContain('http')
      },
      TEST_TIMEOUT,
    )

    it(
      'returns error with unreachable URL',
      async () => {
        vi.stubEnv('TAVILY_API_KEY', '')
        vi.stubEnv('SEARXNG_URL', 'http://localhost:1')
        vi.stubEnv('SEARXNG_API_KEY', '')

        const { webSearchTool } = await import('./web-search.js')
        const result = await webSearchTool.execute({ query: 'test' }, context)

        expect(result.success).toBe(false)
        expect(result.error).toMatch(/SearXNG search failed|fetch failed|ECONNREFUSED|Invalid URL/)
      },
      TEST_TIMEOUT,
    )

    it(
      'returns formatted output matching spec (title+URL+content per result)',
      async () => {
        const { webSearchTool } = await import('./web-search.js')
        const result = await webSearchTool.execute({ query: 'open source', max_results: 2 }, context)

        expect(result.success).toBe(true)
        const lines = result.output!.split('\n')
        expect(lines[0]).toMatch(/^\[1\] .+/)
        expect(lines[1]).toContain('URL:')
        expect(lines[2]?.trim().length).toBeGreaterThan(0)
      },
      TEST_TIMEOUT,
    )
  })

  describeIfAny('engine preference', () => {
    it(
      'default favors Tavily when both configured',
      async () => {
        vi.stubEnv('TAVILY_API_KEY', process.env['TAVILY_API_KEY'] ?? '')
        vi.stubEnv('SEARXNG_URL', process.env['SEARXNG_URL'] ?? '')

        const { webSearchTool } = await import('./web-search.js')
        const result = await webSearchTool.execute({ query: 'test integration', max_results: 1 }, context)

        expect(result.success).toBe(true)
      },
      TEST_TIMEOUT,
    )
  })
})
