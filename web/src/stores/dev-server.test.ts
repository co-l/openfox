// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useDevServerStore } from './dev-server'
import { clearCache, snapshot } from '../lib/resourceCache'
import { devServerStatusResource, devServerConfigResource } from '../lib/resources'
import type { DevServerConfig, DevServerStatus } from '@shared/dev-server.js'

vi.mock('../lib/api', () => ({
  authFetch: vi.fn(),
}))

const { authFetch } = vi.mocked(await import('../lib/api'))

const WORKDIR_A = '/projects/a'
const WORKDIR_B = '/projects/b'

const CONFIG: DevServerConfig = {
  command: 'npm run dev',
  url: 'http://localhost:3000',
  hotReload: false,
  disableInspect: false,
}

const STATUS_RUNNING: DevServerStatus = {
  state: 'running',
  url: 'http://localhost:3000',
  hotReload: false,
  config: CONFIG,
  errorMessage: undefined,
  inspectProxyPort: 9333,
}

const STATUS_STOPPED: DevServerStatus = {
  state: 'off',
  url: null,
  hotReload: false,
  config: null,
  errorMessage: undefined,
  inspectProxyPort: null,
}

const logsOf = (workdir: string) => useDevServerStore.getState().logsByWorkdir[workdir] ?? []

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

beforeEach(() => {
  useDevServerStore.setState({ logsByWorkdir: {} })
  clearCache()
  vi.mocked(authFetch).mockReset()
})

describe('useDevServerStore logs + write-through', () => {
  it('routes devServer.output chunks to the matching workdir logs only', async () => {
    useDevServerStore.getState().handleMessage({
      type: 'devServer.output',
      payload: { workdir: WORKDIR_A, stream: 'stdout', content: 'hello A' },
    })
    useDevServerStore.getState().handleMessage({
      type: 'devServer.output',
      payload: { workdir: WORKDIR_B, stream: 'stderr', content: 'hello B' },
    })
    await nextFrame()

    expect(logsOf(WORKDIR_A)).toEqual([{ stream: 'stdout', content: 'hello A' }])
    expect(logsOf(WORKDIR_B)).toEqual([{ stream: 'stderr', content: 'hello B' }])
  })

  it('caps per-workdir logs to a bounded buffer so memory stays finite', async () => {
    for (let i = 0; i < 2500; i++) {
      useDevServerStore.getState().handleMessage({
        type: 'devServer.output',
        payload: { workdir: WORKDIR_A, stream: 'stdout', content: `line-${i}` },
      })
    }
    await nextFrame()

    const logs = logsOf(WORKDIR_A)
    expect(logs).toHaveLength(2000)
    expect(logs[0]?.content).toBe('line-500')
    expect(logs.at(-1)?.content).toBe('line-2499')
  })

  it('writes devServer.state through to the status resource, preserving prior fields', () => {
    devServerStatusResource.write(STATUS_RUNNING, WORKDIR_A)

    useDevServerStore.getState().handleMessage({
      type: 'devServer.state',
      payload: { workdir: WORKDIR_A, state: 'warning', errorMessage: 'boom' },
    })

    const status = snapshot<DevServerStatus>(devServerStatusResource.keyOf(WORKDIR_A)).data
    expect(status?.state).toBe('warning')
    expect(status?.errorMessage).toBe('boom')
    expect(status?.url).toBe('http://localhost:3000')
    expect(status?.hotReload).toBe(false)
    expect(status?.config).toEqual(CONFIG)
  })

  it('start writes status through and clears logs for that workdir', async () => {
    useDevServerStore.getState().handleMessage({
      type: 'devServer.output',
      payload: { workdir: WORKDIR_A, stream: 'stdout', content: 'old' },
    })
    await nextFrame()

    vi.mocked(authFetch).mockImplementation(async (url: string) => {
      const running = url.startsWith('/api/dev-server/start?workdir=' + encodeURIComponent(WORKDIR_A))
      return { ok: true, json: async () => (running ? STATUS_RUNNING : STATUS_STOPPED) } as Response
    })

    await useDevServerStore.getState().start(WORKDIR_A)

    expect(snapshot(devServerStatusResource.keyOf(WORKDIR_A)).data).toEqual(STATUS_RUNNING)
    expect(snapshot(devServerStatusResource.keyOf(WORKDIR_B)).data).toBeUndefined()
    expect(logsOf(WORKDIR_A)).toEqual([])
  })

  it('does not clear logs when start fails', async () => {
    useDevServerStore.getState().handleMessage({
      type: 'devServer.output',
      payload: { workdir: WORKDIR_A, stream: 'stdout', content: 'keep me' },
    })
    await nextFrame()

    vi.mocked(authFetch).mockRejectedValue(new Error('boom'))
    await useDevServerStore.getState().start(WORKDIR_A)

    expect(logsOf(WORKDIR_A)).toEqual([{ stream: 'stdout', content: 'keep me' }])
  })

  it('saveConfig writes config through and refreshes status for the targeted workdir only', async () => {
    vi.mocked(authFetch).mockImplementation(async (url: string) => {
      if (url.includes('/config')) return { ok: true, json: async () => ({ config: CONFIG }) } as Response
      if (url.startsWith('/api/dev-server?workdir=')) return { ok: true, json: async () => STATUS_RUNNING } as Response
      return { ok: true, json: async () => ({}) } as Response
    })

    await useDevServerStore.getState().saveConfig(WORKDIR_A, CONFIG)

    expect(snapshot(devServerConfigResource.keyOf(WORKDIR_A)).data).toEqual(CONFIG)
    expect(snapshot(devServerConfigResource.keyOf(WORKDIR_B)).data).toBeUndefined()
    expect(snapshot<DevServerStatus>(devServerStatusResource.keyOf(WORKDIR_A)).data?.state).toBe('running')
  })

  it('clearLogs empties the workdir logs', async () => {
    useDevServerStore.getState().handleMessage({
      type: 'devServer.output',
      payload: { workdir: WORKDIR_A, stream: 'stdout', content: 'x' },
    })
    await nextFrame()
    expect(logsOf(WORKDIR_A)).toHaveLength(1)

    vi.mocked(authFetch).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) } as Response)
    await useDevServerStore.getState().clearLogs(WORKDIR_A)

    expect(logsOf(WORKDIR_A)).toEqual([])
  })

  it('insertMarker posts then refetches the log buffer', async () => {
    const marker = { stream: 'stdout', content: '─'.repeat(56), type: 'marker' }
    vi.mocked(authFetch).mockImplementation(async (url: string) => {
      if (url.includes('insert-marker')) return { ok: true, json: async () => ({ ok: true }) } as Response
      if (url.includes('/logs')) return { ok: true, json: async () => ({ logs: [marker] }) } as Response
      return { ok: true, json: async () => ({}) } as Response
    })

    await useDevServerStore.getState().insertMarker(WORKDIR_A)

    expect(logsOf(WORKDIR_A)).toEqual([marker])
  })

  it('actions are no-ops without a workdir', async () => {
    await useDevServerStore.getState().start(undefined as unknown as string)
    await useDevServerStore.getState().stop(undefined as unknown as string)
    await useDevServerStore.getState().restart(undefined as unknown as string)
    await useDevServerStore.getState().saveConfig(undefined as unknown as string, CONFIG)

    expect(authFetch).not.toHaveBeenCalled()
    expect(useDevServerStore.getState().logsByWorkdir).toEqual({})
  })
})
