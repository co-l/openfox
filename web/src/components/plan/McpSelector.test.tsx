/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { McpSelector } from './McpSelector'
import { useMcpStore } from '../../stores/mcp'

// State shared between mock and tests
let mockServers: Array<{
  name: string
  status: string
  tools: { name: string; enabled: boolean; description?: string; estimatedTokens: number }[]
  estimatedTokens: number
  config: { disabled?: boolean }
}> = [
  {
    name: 'alpha',
    status: 'connected',
    tools: [{ name: 'tool-a', enabled: true, estimatedTokens: 100 }],
    estimatedTokens: 100,
    config: {},
  },
  {
    name: 'beta',
    status: 'connected',
    tools: [{ name: 'tool-b', enabled: true, estimatedTokens: 200 }],
    estimatedTokens: 200,
    config: {},
  },
]

let sessionDisabledServers: string[] = []

vi.mock('../../lib/api', () => ({
  authFetch: vi.fn(async (url: string, options?: RequestInit) => {
    const urlStr = String(url)
    if (urlStr.includes('/mcp/overrides')) {
      if (options?.method === 'PUT') {
        const body = JSON.parse(options.body as string) as { disabledServers?: string[] }
        sessionDisabledServers = body.disabledServers ?? []
        return { ok: true, json: async () => ({ disabledServers: sessionDisabledServers }) }
      }
      return { ok: true, json: async () => ({ disabledServers: sessionDisabledServers }) }
    }
    if (options?.method === 'PUT') {
      const match = urlStr.match(/\/api\/mcp\/servers\/([^/]+)/)
      if (match) {
        const serverName = decodeURIComponent(match[1]!)
        const body = JSON.parse(options.body as string) as { disabled: boolean }
        const server = mockServers.find((s) => s.name === serverName)
        if (server) {
          server.config = { ...server.config, disabled: body.disabled }
        }
      }
      return { ok: true, json: async () => ({}) }
    }
    return { ok: true, json: async () => ({ servers: [...mockServers] }) }
  }),
}))

vi.mock('../../stores/session', () => ({
  useSessionStore: vi.fn((selector) => {
    const state = { currentSession: { id: 'session-1' } }
    return selector(state)
  }),
  useIsRunning: vi.fn(() => false),
}))

describe('McpSelector server toggle isolation', () => {
  beforeEach(() => {
    mockServers = [
      {
        name: 'alpha',
        status: 'connected',
        tools: [{ name: 'tool-a', enabled: true, estimatedTokens: 100 }],
        estimatedTokens: 100,
        config: {},
      },
      {
        name: 'beta',
        status: 'connected',
        tools: [{ name: 'tool-b', enabled: true, estimatedTokens: 200 }],
        estimatedTokens: 200,
        config: {},
      },
    ]
    sessionDisabledServers = []
    useMcpStore.getState().setServers(mockServers)
  })
  afterEach(() => {
    cleanup()
  })

  it('toggling alpha via session API', async () => {
    const user = userEvent.setup()
    render(<McpSelector />)

    const trigger = screen.getByText(/MCP/)
    await user.click(trigger)

    const toggles = screen.getAllByRole('switch')
    const { authFetch } = await import('../../lib/api')
    const mockFn = authFetch as ReturnType<typeof vi.fn>
    mockFn.mockClear()

    await user.click(toggles[0]!)

    const putCalls = mockFn.mock.calls.filter(
      (call: unknown[]) => (call[1] as Record<string, unknown>)?.method === 'PUT',
    )
    expect(putCalls.length).toBeGreaterThanOrEqual(1)
    const putCall = putCalls.find((c: unknown[]) => String(c[0]).includes('session-1'))
    expect(putCall).toBeDefined()
    expect(JSON.parse((putCall![1] as Record<string, string>).body as string)).toEqual({ disabledServers: ['alpha'] })
  })

  it('toggling beta via session API', async () => {
    const user = userEvent.setup()
    render(<McpSelector />)

    const trigger = screen.getByText(/MCP/)
    await user.click(trigger)
    const toggles = screen.getAllByRole('switch')

    const { authFetch } = await import('../../lib/api')
    const mockFn = authFetch as ReturnType<typeof vi.fn>
    mockFn.mockClear()

    await user.click(toggles[1]!)

    const putCalls = mockFn.mock.calls.filter(
      (call: unknown[]) => (call[1] as Record<string, unknown>)?.method === 'PUT',
    )
    expect(putCalls.length).toBeGreaterThanOrEqual(1)
    const putCall = putCalls.find((c: unknown[]) => String(c[0]).includes('session-1'))
    expect(putCall).toBeDefined()
    expect(JSON.parse((putCall![1] as Record<string, string>).body as string)).toEqual({ disabledServers: ['beta'] })
  })

  it('state isolation: toggling alpha does not affect beta store state', async () => {
    const user = userEvent.setup()
    render(<McpSelector />)

    const trigger = screen.getByText(/MCP/)
    await user.click(trigger)
    const toggles = screen.getAllByRole('switch')

    await user.click(toggles[0]!)

    // After toggling alpha, alpha should be session-disabled
    expect(sessionDisabledServers).toEqual(['alpha'])
  })
})
