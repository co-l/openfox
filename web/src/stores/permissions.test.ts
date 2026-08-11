import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { usePermissionsStore } from './permissions'
import type { PermissionConfig } from '@shared/permissions.js'

vi.mock('../lib/ws', () => ({
  wsClient: { send: vi.fn() },
}))

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  usePermissionsStore.setState({
    globalConfig: null,
    projectConfig: null,
    mergedRules: [],
    loading: false,
    saving: false,
    error: null,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function createJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('usePermissionsStore', () => {
  it('fetches global config and populates mergedRules', async () => {
    const config: PermissionConfig = {
      version: 1,
      rules: [{ effect: 'DENY', tool: 'run_command', pattern: 'rm -rf *' }],
    }
    fetchMock.mockResolvedValueOnce(createJsonResponse({ config }))
    await usePermissionsStore.getState().fetchConfig('global')
    expect(usePermissionsStore.getState().globalConfig).toEqual(config)
    expect(usePermissionsStore.getState().mergedRules).toHaveLength(1)
    expect(usePermissionsStore.getState().mergedRules[0]!.scope).toBe('global')
  })

  it('fetches project config and populates mergedRules', async () => {
    const config: PermissionConfig = {
      version: 1,
      rules: [{ effect: 'ALLOW', tool: 'read_file', pattern: '/x/**' }],
    }
    fetchMock.mockResolvedValueOnce(createJsonResponse({ config }))
    await usePermissionsStore.getState().fetchConfig('project', '/workdir')
    expect(usePermissionsStore.getState().projectConfig).toEqual(config)
    expect(usePermissionsStore.getState().mergedRules).toHaveLength(1)
    expect(usePermissionsStore.getState().mergedRules[0]!.scope).toBe('project')
  })

  it('fetchAll loads both scopes and merges', async () => {
    const globalCfg: PermissionConfig = {
      version: 1,
      rules: [{ effect: 'DENY', tool: 'run_command', pattern: 'rm -rf *' }],
    }
    const projectCfg: PermissionConfig = {
      version: 1,
      rules: [{ effect: 'ALLOW', tool: 'read_file', pattern: '/x/**' }],
    }
    fetchMock.mockResolvedValueOnce(createJsonResponse({ config: globalCfg }))
    fetchMock.mockResolvedValueOnce(createJsonResponse({ config: projectCfg }))
    await usePermissionsStore.getState().fetchAll('/workdir')
    expect(usePermissionsStore.getState().mergedRules).toHaveLength(2)
    expect(usePermissionsStore.getState().mergedRules.map((r) => r.scope)).toContain('global')
    expect(usePermissionsStore.getState().mergedRules.map((r) => r.scope)).toContain('project')
  })

  it('saves global config', async () => {
    const config: PermissionConfig = { version: 1, rules: [] }
    fetchMock.mockResolvedValueOnce(createJsonResponse({ config }))
    await usePermissionsStore.getState().saveConfig('global', config)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('scope=global'),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(usePermissionsStore.getState().globalConfig).toEqual(config)
  })

  it('saves project config', async () => {
    const config: PermissionConfig = {
      version: 1,
      rules: [{ effect: 'ASK', tool: 'write_file', pattern: '**/.env*' }],
    }
    fetchMock.mockResolvedValueOnce(createJsonResponse({ config }))
    await usePermissionsStore.getState().saveConfig('project', config, '/workdir')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('scope=project'),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(usePermissionsStore.getState().projectConfig).toEqual(config)
  })

  it('throws on save failure', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'bad' }) })
    await expect(usePermissionsStore.getState().saveConfig('global', { version: 1, rules: [] })).rejects.toThrow()
  })

  it('fetchAll without workdir only fetches global, skips project', async () => {
    const globalCfg: PermissionConfig = {
      version: 1,
      rules: [{ effect: 'DENY', tool: 'run_command', pattern: 'rm -rf *' }],
    }
    fetchMock.mockResolvedValueOnce(createJsonResponse({ config: globalCfg }))
    await usePermissionsStore.getState().fetchAll(undefined)
    expect(usePermissionsStore.getState().globalConfig).toEqual(globalCfg)
    expect(usePermissionsStore.getState().projectConfig).toBeNull()
    expect(usePermissionsStore.getState().mergedRules).toHaveLength(1)
    expect(usePermissionsStore.getState().mergedRules[0]!.scope).toBe('global')
    expect(usePermissionsStore.getState().error).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('scope=global'), expect.anything())
  })

  it('fetchConfig project without workdir handles 400 gracefully', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'workdir required' }) })
    await usePermissionsStore.getState().fetchConfig('project', undefined)
    expect(usePermissionsStore.getState().error).toBeTruthy()
    expect(usePermissionsStore.getState().projectConfig).toBeNull()
  })

  it('sets error on fetch failure', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    await usePermissionsStore.getState().fetchConfig('global')
    expect(usePermissionsStore.getState().error).toBeTruthy()
  })
})
