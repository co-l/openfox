// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDevServer } from './useDevServer'
import { useDevServerStore } from '../stores/dev-server'
import { clearCache } from '../lib/resourceCache'
import type { DevServerConfig, DevServerStatus } from '@shared/dev-server.js'

vi.mock('../lib/api', () => ({ authFetch: vi.fn() }))

const { authFetch } = vi.mocked(await import('../lib/api'))

const WORKDIR = '/projects/a'

const CONFIG: DevServerConfig = {
  command: 'npm run dev',
  url: 'http://localhost:3000',
  hotReload: false,
  disableInspect: false,
}

const STATUS_OFF: DevServerStatus = {
  state: 'off',
  url: null,
  hotReload: false,
  config: null,
  errorMessage: undefined,
  inspectProxyPort: null,
}

const STATUS_RUNNING: DevServerStatus = {
  state: 'running',
  url: 'http://localhost:3000',
  hotReload: false,
  config: CONFIG,
  errorMessage: undefined,
  inspectProxyPort: null,
}

const jsonResponse = (body: unknown) => ({ ok: true, json: async () => body }) as Response

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  clearCache()
  useDevServerStore.setState({ logsByWorkdir: {} })
  vi.mocked(authFetch).mockReset()
})

describe('useDevServer', () => {
  it('loads status and config on mount for the workdir', async () => {
    vi.mocked(authFetch).mockImplementation(async (url: string) => {
      if (url.includes('/config')) return jsonResponse({ config: CONFIG })
      if (url.includes('/logs')) return jsonResponse({ logs: [] })
      return jsonResponse(STATUS_OFF)
    })

    const { result } = renderHook(() => useDevServer(WORKDIR))
    expect(result.current.status).toBeNull()

    await flush()

    expect(result.current.status).toEqual(STATUS_OFF)
    expect(result.current.config).toEqual(CONFIG)
    expect(authFetch).toHaveBeenCalledWith(expect.stringContaining(`/api/dev-server?workdir=`))
    expect(authFetch).toHaveBeenCalledWith(expect.stringContaining(`/api/dev-server/config?workdir=`))
  })

  it('does not fetch anything without a workdir', async () => {
    const { result } = renderHook(() => useDevServer(null))
    await flush()
    expect(authFetch).not.toHaveBeenCalled()
    expect(result.current.status).toBeNull()
    expect(result.current.config).toBeNull()
    expect(result.current.logs).toEqual([])
  })

  it('hydrates the full log buffer once when the server is alive', async () => {
    const logs = [{ stream: 'stdout', content: 'hello' }]
    vi.mocked(authFetch).mockImplementation(async (url: string) => {
      if (url.includes('/config')) return jsonResponse({ config: CONFIG })
      if (url.includes('/logs')) return jsonResponse({ logs })
      return jsonResponse(STATUS_RUNNING)
    })

    const { result } = renderHook(() => useDevServer(WORKDIR))
    await flush()

    expect(result.current.logs).toEqual(logs)
    const logCalls = () => vi.mocked(authFetch).mock.calls.filter(([url]) => String(url).includes('/logs'))
    expect(logCalls()).toHaveLength(1)

    await flush()
    expect(logCalls()).toHaveLength(1)
  })

  it('hydrates the full buffer even when WS output landed before the status fetch', async () => {
    const history = [{ stream: 'stdout', content: 'pre-mount history' }]
    vi.mocked(authFetch).mockImplementation(async (url: string) => {
      if (url.includes('/config')) return jsonResponse({ config: CONFIG })
      if (url.includes('/logs')) return jsonResponse({ logs: history })
      return jsonResponse(STATUS_RUNNING)
    })

    useDevServerStore.setState({ logsByWorkdir: { [WORKDIR]: [{ stream: 'stdout', content: 'live' }] } })

    const { result } = renderHook(() => useDevServer(WORKDIR))
    await flush()

    expect(result.current.logs).toEqual(history)
  })

  it('re-hydrates logs when the workdir changes', async () => {
    const logsB = [{ stream: 'stdout', content: 'logs B' }]
    vi.mocked(authFetch).mockImplementation(async (url: string) => {
      if (url.includes('/config')) return jsonResponse({ config: CONFIG })
      if (url.includes('/logs')) return jsonResponse({ logs: logsB })
      return jsonResponse(STATUS_RUNNING)
    })

    const { rerender, result } = renderHook(({ wd }: { wd: string }) => useDevServer(wd), {
      initialProps: { wd: WORKDIR },
    })
    await flush()

    rerender({ wd: `${WORKDIR}-b` })
    await flush()

    expect(result.current.logs).toEqual(logsB)
    const logCalls = vi.mocked(authFetch).mock.calls.filter(([url]) => String(url).includes('/logs'))
    expect(logCalls).toHaveLength(2)
  })

  it('does not fetch logs when the server is off', async () => {
    vi.mocked(authFetch).mockImplementation(async (url: string) => {
      if (url.includes('/config')) return jsonResponse({ config: CONFIG })
      if (url.includes('/logs')) return jsonResponse({ logs: [] })
      return jsonResponse(STATUS_OFF)
    })

    renderHook(() => useDevServer(WORKDIR))
    await flush()

    const logCalls = vi.mocked(authFetch).mock.calls.filter(([url]) => String(url).includes('/logs'))
    expect(logCalls).toHaveLength(0)
  })

  it('reflects WS devServer.state write-through', async () => {
    vi.mocked(authFetch).mockImplementation(async (url: string) => {
      if (url.includes('/config')) return jsonResponse({ config: CONFIG })
      if (url.includes('/logs')) return jsonResponse({ logs: [] })
      return jsonResponse(STATUS_OFF)
    })

    const { result } = renderHook(() => useDevServer(WORKDIR))
    await flush()
    expect(result.current.status?.state).toBe('off')

    act(() => {
      useDevServerStore.getState().handleMessage({
        type: 'devServer.state',
        payload: { workdir: WORKDIR, state: 'running', errorMessage: undefined },
      })
    })

    expect(result.current.status?.state).toBe('running')
  })
})
