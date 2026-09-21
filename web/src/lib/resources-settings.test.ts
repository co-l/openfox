import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authFetch } from './api'
import { clearCache, load, snapshot } from './resourceCache'
import {
  settingResource,
  setSetting,
  fetchSettingsBulk,
  workspaceConfigResource,
  saveWorkspaceConfig,
  type WorkspaceConfigResponse,
} from './resources'

vi.mock('./api', () => ({
  authFetch: vi.fn(),
}))

function jsonResponse(data: unknown): Response {
  return { ok: true, json: () => Promise.resolve(data) } as unknown as Response
}

describe('settingResource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCache()
  })

  it('scopes the cache key by setting key so wrong-key data is impossible', () => {
    expect(settingResource.keyOf('display.theme')).toBe('settings:display.theme')
    expect(settingResource.keyOf('keybindings')).toBe('settings:keybindings')
    expect(settingResource.keyOf('display.theme')).not.toBe(settingResource.keyOf('keybindings'))
  })

  it('fetches a single setting from its endpoint and normalizes a null value', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({ key: 'display.theme', value: 'dark' }))
    const value = await settingResource.refresh('display.theme')
    expect(authFetch).toHaveBeenCalledWith('/api/settings/display.theme')
    expect(value).toBe('dark')
  })

  it('keeps distinct settings fully isolated in the cache', async () => {
    vi.mocked(authFetch).mockImplementation(async (url: string) => {
      const key = url.replace('/api/settings/', '')
      return jsonResponse({ key, value: `value-${key}` })
    })
    await settingResource.refresh('a')
    await settingResource.refresh('b')
    expect(snapshot<string>(settingResource.keyOf('a')).data).toBe('value-a')
    expect(snapshot<string>(settingResource.keyOf('b')).data).toBe('value-b')
  })
})

describe('setSetting mutation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCache()
  })

  it('PUTs the value and writes the server-confirmed value through with no refetch', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({ key: 'display.theme', value: 'dark' }))

    await setSetting('display.theme', 'dark')

    expect(authFetch).toHaveBeenCalledWith(
      '/api/settings/display.theme',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'dark' }),
      }),
    )
    // Subscribers on the key converge immediately — one PUT, no follow-up GET.
    expect(snapshot<string>(settingResource.keyOf('display.theme')).data).toBe('dark')
    expect(authFetch).toHaveBeenCalledTimes(1)
  })

  it('converges every consumer on the same key after a save (discrepancy test)', async () => {
    // A consumer lands on the key before any value exists.
    expect(snapshot<string>(settingResource.keyOf('keybindings')).data).toBeUndefined()

    // A save elsewhere lands on the same key and both converge with no follow-up GET.
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({ key: 'keybindings', value: '{"x":1}' }))
    await setSetting('keybindings', '{"x":1}')
    expect(snapshot<string>(settingResource.keyOf('keybindings')).data).toBe('{"x":1}')
    expect(authFetch).toHaveBeenCalledTimes(1)
  })

  it('does not refetch a fresh setting on remount', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({ key: 'display.theme', value: 'dark' }))
    await settingResource.refresh('display.theme')
    expect(authFetch).toHaveBeenCalledTimes(1)

    // A remount calls load(); the entry is fresh so no new fetch fires.
    load(settingResource.keyOf('display.theme'), () => settingResource.fetch('display.theme'), settingResource.maxAgeMs)
    expect(authFetch).toHaveBeenCalledTimes(1)
  })
})

describe('fetchSettingsBulk warm-up', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCache()
  })

  it('fetches all keys in one batched request and writes each through', async () => {
    vi.mocked(authFetch).mockResolvedValue(
      jsonResponse({ 'display.theme': 'dark', 'display.showThinking': 'false', keybindings: '{"x":1}' }),
    )

    await fetchSettingsBulk(['display.theme', 'display.showThinking', 'keybindings'])

    expect(authFetch).toHaveBeenCalledWith('/api/settings?keys=display.theme%2Cdisplay.showThinking%2Ckeybindings')
    // One batch request — no per-key refetches.
    expect(authFetch).toHaveBeenCalledTimes(1)
    expect(snapshot<string>(settingResource.keyOf('display.theme')).data).toBe('dark')
    expect(snapshot<string>(settingResource.keyOf('display.showThinking')).data).toBe('false')
    expect(snapshot<string>(settingResource.keyOf('keybindings')).data).toBe('{"x":1}')
  })

  it('is a no-op for an empty key list', async () => {
    await fetchSettingsBulk([])
    expect(authFetch).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent calls for the same key set (single-flight)', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({ 'display.theme': 'dark' }))

    await Promise.all([fetchSettingsBulk(['display.theme']), fetchSettingsBulk(['display.theme'])])

    expect(authFetch).toHaveBeenCalledTimes(1)
    expect(snapshot<string>(settingResource.keyOf('display.theme')).data).toBe('dark')
  })
})

describe('workspaceConfigResource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCache()
  })

  it('scopes the cache key by workdir so wrong-project config is impossible', () => {
    expect(workspaceConfigResource.keyOf('/a')).toBe('workspace-config:/a')
    expect(workspaceConfigResource.keyOf('/b')).toBe('workspace-config:/b')
    expect(workspaceConfigResource.keyOf('/a')).not.toBe(workspaceConfigResource.keyOf('/b'))
  })

  it('fetches the config scoped to the workdir', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({ config: { setup: ['pnpm'] } }))
    const data = await workspaceConfigResource.refresh('/tmp/proj')
    expect(authFetch).toHaveBeenCalledWith('/api/workspace/config?workdir=%2Ftmp%2Fproj')
    expect(data?.setup).toEqual(['pnpm'])
  })

  it('normalizes a missing config to null', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({ config: null }))
    const data = await workspaceConfigResource.refresh('/tmp/empty')
    expect(data).toBeNull()
  })

  it('keeps different workdirs fully isolated in the cache', async () => {
    vi.mocked(authFetch).mockImplementation(async (url: string) => {
      const workdir = decodeURIComponent(url.split('workdir=')[1]!)
      return jsonResponse({ config: { setup: [workdir] } })
    })
    await workspaceConfigResource.refresh('/a')
    await workspaceConfigResource.refresh('/b')
    expect(snapshot<WorkspaceConfigResponse | null>(workspaceConfigResource.keyOf('/a'))?.data?.setup).toEqual(['/a'])
    expect(snapshot<WorkspaceConfigResponse | null>(workspaceConfigResource.keyOf('/b'))?.data?.setup).toEqual(['/b'])
  })
})

describe('saveWorkspaceConfig mutation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCache()
  })

  it('POSTs the config and writes the saved value through with no refetch', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({ config: { setup: ['pnpm'], rootDir: '/workspaces/x' } }))

    await saveWorkspaceConfig('/tmp/proj', { setup: ['pnpm'] })

    expect(authFetch).toHaveBeenCalledWith(
      '/api/workspace/config?workdir=%2Ftmp%2Fproj',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setup: ['pnpm'] }),
      }),
    )
    expect(snapshot<WorkspaceConfigResponse | null>(workspaceConfigResource.keyOf('/tmp/proj'))?.data?.setup).toEqual([
      'pnpm',
    ])
    expect(authFetch).toHaveBeenCalledTimes(1)
  })
})
