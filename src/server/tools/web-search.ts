import { createTool, buildSignal } from './tool-helpers.js'
import { getSetting } from '../db/settings.js'
import { SETTINGS_KEYS } from '../db/settings.js'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_RESULTS = 5

interface WebSearchArgs {
  query: string
  max_results?: number
}

interface SearchResult {
  title: string
  url: string
  content: string
}

type EngineConfig = { engine: 'tavily'; apiKey: string } | { engine: 'searxng'; url: string; apiKey?: string }

function getTavilyApiKey(): string | null {
  return process.env['TAVILY_API_KEY'] ?? getSetting(SETTINGS_KEYS.SEARCH_TAVILY_API_KEY)
}

function getSearxngUrl(): string | null {
  return process.env['SEARXNG_URL'] ?? getSetting(SETTINGS_KEYS.SEARCH_SEARXNG_URL)
}

function getSearxngApiKey(): string | null {
  return process.env['SEARXNG_API_KEY'] ?? getSetting(SETTINGS_KEYS.SEARCH_SEARXNG_API_KEY)
}

function getActiveEngine(): EngineConfig | null {
  const preferredEngine = getSetting(SETTINGS_KEYS.SEARCH_ENGINE)

  if (preferredEngine === '') {
    return null
  }

  if (preferredEngine === 'tavily') {
    const apiKey = getTavilyApiKey()
    if (!apiKey) return null
    return { engine: 'tavily', apiKey }
  }

  if (preferredEngine === 'searxng') {
    const url = getSearxngUrl()
    if (!url) return null
    const searxngApiKey = getSearxngApiKey()
    return searxngApiKey ? { engine: 'searxng', url, apiKey: searxngApiKey } : { engine: 'searxng', url }
  }

  const tavilyKey = getTavilyApiKey()
  if (tavilyKey) return { engine: 'tavily', apiKey: tavilyKey }

  const searxngUrl = getSearxngUrl()
  if (searxngUrl) {
    const searxngApiKey = getSearxngApiKey()
    return searxngApiKey
      ? { engine: 'searxng', url: searxngUrl, apiKey: searxngApiKey }
      : { engine: 'searxng', url: searxngUrl }
  }

  return null
}

async function searchTavily(
  query: string,
  maxResults: number,
  apiKey: string,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults }),
    signal,
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Tavily search failed (${response.status}): ${body}`)
  }

  const data = (await response.json()) as { results?: SearchResult[] }
  return (data.results ?? []).map((r) => ({ title: r.title, url: r.url, content: r.content }))
}

async function searchSearxng(
  query: string,
  maxResults: number,
  config: { url: string; apiKey?: string },
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const baseUrl = config.url.replace(/\/+$/, '')
  const url = new URL(`${baseUrl}/search`)
  url.searchParams.set('format', 'json')
  url.searchParams.set('q', query)

  const headers: Record<string, string> = {}
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`
  }

  const response = await fetch(url.toString(), { headers, signal })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`SearXNG search failed (${response.status}): ${body}`)
  }

  const data = (await response.json()) as { results?: SearchResult[] }
  return (data.results ?? []).slice(0, maxResults).map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content,
  }))
}

function formatResults(results: SearchResult[]): string {
  return results.map((r, i) => `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.content}`).join('\n\n')
}

function clampMaxResults(maxResults: number): number {
  return maxResults > 0 ? maxResults : DEFAULT_MAX_RESULTS
}

export const webSearchTool = createTool<WebSearchArgs>(
  'web_search',
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the web using a configured search engine (Tavily or SearXNG). Returns a list of results with title, URL, and content snippet for each. Use this to find relevant web pages, then use web_fetch to retrieve full content.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query',
          },
          max_results: {
            type: 'number',
            description: 'Maximum number of search results to return (default: 5)',
          },
        },
        required: ['query'],
      },
    },
  },
  async (args, context, helpers) => {
    const query = args.query
    const maxResults = clampMaxResults(args.max_results ?? DEFAULT_MAX_RESULTS)

    const active = getActiveEngine()
    if (!active) {
      return helpers.error(
        'web_search requires at least one search engine configured. ' +
          'Set the TAVILY_API_KEY environment variable, or configure SearXNG via SEARXNG_URL (and optionally SEARXNG_API_KEY). ' +
          'You can also configure these in Settings > Advanced > Search Engine.',
      )
    }

    const signal = buildSignal(DEFAULT_TIMEOUT_MS, context.signal)

    try {
      let results: SearchResult[]

      if (active.engine === 'tavily') {
        results = await searchTavily(query, maxResults, active.apiKey, signal)
      } else {
        const searxngConfig: { url: string; apiKey?: string } = { url: active.url }
        if (active.apiKey) searxngConfig.apiKey = active.apiKey
        results = await searchSearxng(query, maxResults, searxngConfig, signal)
      }

      if (results.length === 0) {
        return helpers.success('No search results found.', false)
      }

      return helpers.success(formatResults(results), false)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return helpers.error('Search request timed out (15s). Try a more specific query.')
      }
      return helpers.error(error instanceof Error ? error.message : 'Search request failed')
    }
  },
)
