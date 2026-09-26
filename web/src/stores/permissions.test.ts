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
    grants: [],
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
      rules: [{ id: 'r-deny', effect: 'DENY', tool: 'run_command', pattern: 'rm -rf *' }],
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
      rules: [{ id: 'r-allow', effect: 'ALLOW', tool: 'read_file', pattern: '/x/**' }],
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
      rules: [{ id: 'r-deny', effect: 'DENY', tool: 'run_command', pattern: 'rm -rf *' }],
    }
    const projectCfg: PermissionConfig = {
      version: 1,
      rules: [{ id: 'r-allow', effect: 'ALLOW', tool: 'read_file', pattern: '/x/**' }],
    }
    fetchMock.mockResolvedValueOnce(createJsonResponse({ config: globalCfg }))
    fetchMock.mockResolvedValueOnce(createJsonResponse({ config: projectCfg }))
    await usePermissionsStore.getState().fetchAll('/workdir')
    expect(usePermissionsStore.getState().mergedRules).toHaveLength(2)
    expect(usePermissionsStore.getState().mergedRules.map((r) => r.scope)).toContain('global')
    expect(usePermissionsStore.getState().mergedRules.map((r) => r.scope)).toContain('project')
  })

  it('addRule POSTs the single rule to /rules, never a whole config', async () => {
    const config: PermissionConfig = {
      version: 1,
      rules: [{ id: 'r-deny', effect: 'DENY', tool: 'run_command', pattern: 'rm -rf *' }],
    }
    fetchMock.mockResolvedValueOnce(createJsonResponse({ config }))
    await usePermissionsStore.getState().addRule('global', { effect: 'DENY', tool: 'run_command', pattern: 'rm -rf *' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toContain('/api/permissions/rules?scope=global')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ effect: 'DENY', tool: 'run_command', pattern: 'rm -rf *' })
    expect(usePermissionsStore.getState().globalConfig).toEqual(config)
  })

  it('updateRule PUTs to the rule id, not to its index', async () => {
    const config: PermissionConfig = {
      version: 1,
      rules: [{ id: 'r-ask', effect: 'ASK', tool: 'write_file', pattern: '**/.env*' }],
    }
    fetchMock.mockResolvedValueOnce(createJsonResponse({ config }))
    await usePermissionsStore
      .getState()
      .updateRule('project', 'r-ask', { effect: 'ASK', tool: 'write_file', pattern: '**/.env*' }, '/workdir')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toContain('/api/permissions/rules/r-ask?scope=project')
    expect(url).toContain('workdir=%2Fworkdir')
    expect(init.method).toBe('PUT')
    expect(usePermissionsStore.getState().projectConfig).toEqual(config)
  })

  it('deleteRule DELETEs the rule id', async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse({ config: { version: 1, rules: [] } }))
    await usePermissionsStore.getState().deleteRule('global', 'r-deny')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toContain('/api/permissions/rules/r-deny?scope=global')
    expect(init.method).toBe('DELETE')
    expect(usePermissionsStore.getState().globalConfig).toEqual({ version: 1, rules: [] })
  })

  it('throws when a mutation fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'bad' }) })
    await expect(usePermissionsStore.getState().deleteRule('global', 'missing')).rejects.toThrow('bad')
  })

  it('fetchAll without workdir only fetches global, skips project', async () => {
    const globalCfg: PermissionConfig = {
      version: 1,
      rules: [{ id: 'r-deny', effect: 'DENY', tool: 'run_command', pattern: 'rm -rf *' }],
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

  describe('session grants', () => {
    const grants = [{ sessionId: 's1', paths: [{ path: '/x', grantedAt: 1 }], rules: [] }]

    it('fetchGrants stores the grants the server returns', async () => {
      fetchMock.mockResolvedValueOnce(createJsonResponse({ grants }))
      await usePermissionsStore.getState().fetchGrants()
      expect(usePermissionsStore.getState().grants).toEqual(grants)
      expect(fetchMock).toHaveBeenCalledWith('/api/permissions/grants', expect.anything())
    })

    it('fetchGrants sets error on failure and keeps the previous grants', async () => {
      usePermissionsStore.setState({ grants })
      fetchMock.mockResolvedValueOnce(createJsonResponse({}, 500))
      await usePermissionsStore.getState().fetchGrants()
      expect(usePermissionsStore.getState().error).toBe('HTTP 500')
      expect(usePermissionsStore.getState().grants).toEqual(grants)
    })

    it('treats a 404 revocation as already gone and resyncs from the answer', async () => {
      usePermissionsStore.setState({ grants })
      fetchMock.mockResolvedValueOnce(createJsonResponse({ grants: [] }, 404))
      await usePermissionsStore.getState().revokeGrantedPath('s1', '/x')
      expect(usePermissionsStore.getState().grants).toEqual([])
      expect(usePermissionsStore.getState().saving).toBe(false)
    })

    it('rejects on another failure and resets saving', async () => {
      fetchMock.mockResolvedValueOnce(createJsonResponse({ error: 'boom' }, 500))
      await expect(usePermissionsStore.getState().revokeSessionGrants('s1')).rejects.toThrow('boom')
      expect(usePermissionsStore.getState().saving).toBe(false)
    })
  })
})
