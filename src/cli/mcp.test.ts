import { describe, expect, it, vi, afterEach } from 'vitest'
import { renderMcpClientConfig, portCandidates, findLivePort } from './mcp.js'

describe('cli/mcp', () => {
  describe('renderMcpClientConfig', () => {
    it('renders a paste-ready client config with auth headers', () => {
      const output = renderMcpClientConfig({
        name: 'openfox',
        transport: 'http',
        url: 'http://127.0.0.1:10469/mcp',
        headers: { Authorization: 'Bearer tok-abc' },
      })
      expect(JSON.parse(output)).toEqual({
        mcpServers: {
          openfox: { url: 'http://127.0.0.1:10469/mcp', headers: { Authorization: 'Bearer tok-abc' } },
        },
      })
    })

    it('omits headers in local mode', () => {
      const output = renderMcpClientConfig({
        name: 'openfox',
        transport: 'http',
        url: 'http://127.0.0.1:10469/mcp',
      })
      expect(JSON.parse(output)).toEqual({
        mcpServers: { openfox: { url: 'http://127.0.0.1:10469/mcp' } },
      })
    })
  })

  describe('portCandidates', () => {
    it('deduplicates when the configured port equals the mode default', () => {
      const candidates = portCandidates(10469, 10469)
      expect(candidates[0]).toBe(10469)
      expect(candidates.filter((p: number) => p === 10469)).toHaveLength(1)
    })

    it('spreads both the preferred port and the fallback upward', () => {
      const candidates = portCandidates(10469, 10369)
      expect(candidates[0]).toBe(10469)
      expect(candidates).toContain(10369)
      expect(candidates).toContain(10480)
      expect(candidates).toContain(10380)
    })
  })

  describe('findLivePort', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('returns the first port whose health endpoint responds', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          const port = new URL(url).port
          return { ok: port === '10469' }
        }),
      )
      expect(await findLivePort('127.0.0.1', [10468, 10469, 10470])).toBe(10469)
    })

    it('skips unreachable ports and returns null when none respond', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('connection refused')
        }),
      )
      expect(await findLivePort('127.0.0.1', [10468, 10469])).toBeNull()
    })
  })
})
