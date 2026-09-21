import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authFetch } from './api'
import { clearCache, snapshot } from './resourceCache'
import { mcpServersResource } from './resources'

vi.mock('./api', () => ({
  authFetch: vi.fn(),
}))

function jsonResponse(data: unknown): Response {
  return { ok: true, json: () => Promise.resolve(data) } as unknown as Response
}

describe('mcpServersResource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCache()
  })

  it('uses a single global key (no scope — the endpoint is global)', () => {
    expect(mcpServersResource.keyOf()).toBe('mcp:servers')
  })

  it('fetches servers from the global endpoint and sorts them by name', async () => {
    vi.mocked(authFetch).mockResolvedValue(
      jsonResponse({
        servers: [
          { name: 'zeta', status: 'connected', tools: [], estimatedTokens: 0, config: {} },
          { name: 'alpha', status: 'disconnected', tools: [], estimatedTokens: 0, config: {} },
        ],
      }),
    )
    const data = await mcpServersResource.refresh()
    expect(authFetch).toHaveBeenCalledWith('/api/mcp/servers')
    expect(data?.map((s) => s.name)).toEqual(['alpha', 'zeta'])
  })

  it('normalizes a missing servers field to an empty list', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({}))
    const data = await mcpServersResource.refresh()
    expect(data).toEqual([])
  })

  it('WS write-through replaces the cached payload without issuing a fetch', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({ servers: [{ name: 'a', tools: [] }] }))
    await mcpServersResource.refresh()
    expect(authFetch).toHaveBeenCalledTimes(1)

    const pushed = [{ name: 'b', status: 'connected', tools: [], estimatedTokens: 0, config: {} }]
    mcpServersResource.write(pushed)
    expect(snapshot('mcp:servers').data).toEqual(pushed)
    expect(authFetch).toHaveBeenCalledTimes(1)
  })
})
