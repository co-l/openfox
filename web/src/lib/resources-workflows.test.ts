import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authFetch } from './api'
import { clearCache, retain } from './resourceCache'
import {
  templateVariablesResource,
  workflowDefaultResource,
  workflowResource,
  workflowsResource,
  readWorkflows,
  refreshWorkflowLists,
  revalidateWorkflows,
  selectAllWorkflows,
  WORKFLOW_REVALIDATE_MS,
} from './resources'

vi.mock('./api', () => ({
  authFetch: vi.fn(),
}))

function jsonResponse(data: unknown): Response {
  return { ok: true, json: () => Promise.resolve(data) } as unknown as Response
}

describe('workflowsResource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCache()
  })

  it('scopes the cache key by workdir so wrong-scope data is impossible', () => {
    expect(workflowsResource.keyOf('/repo/a')).toBe('workflows:/repo/a')
    expect(workflowsResource.keyOf('/repo/b')).toBe('workflows:/repo/b')
    expect(workflowsResource.keyOf(undefined)).toBe('workflows:')
    expect(workflowsResource.keyOf('/repo/a')).not.toBe(workflowsResource.keyOf(undefined))
  })

  it('fetches the workflows list scoped to the requested workdir', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({ defaults: [] }))
    await workflowsResource.refresh('/repo/a')
    expect(authFetch).toHaveBeenCalledWith('/api/workflows?workdir=%2Frepo%2Fa')
  })

  it('keeps different workdir scopes isolated in the cache', async () => {
    vi.mocked(authFetch).mockImplementation(async (url: string) => {
      const workdir = url.includes('?workdir=') ? decodeURIComponent(url.split('=')[1] ?? '') : ''
      return jsonResponse({ defaults: [{ id: `wf-${workdir}`, name: `wf-${workdir}`, scope: 'builtin' }] })
    })
    await workflowsResource.refresh('/repo/a')
    await workflowsResource.refresh('/repo/b')

    expect(readWorkflows('/repo/a')?.defaults[0]?.id).toBe('wf-/repo/a')
    expect(readWorkflows('/repo/b')?.defaults[0]?.id).toBe('wf-/repo/b')
    expect(readWorkflows('/repo/c')).toBeUndefined()
  })

  it('normalizes missing response fields and defaults activeWorkflowId', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({}))
    await workflowsResource.refresh(undefined)
    expect(readWorkflows(undefined)).toEqual({
      defaults: [],
      userItems: [],
      projectItems: [],
      activeWorkflowId: 'default',
    })
  })

  it('selectAllWorkflows flattens every scope in order', () => {
    const data = {
      defaults: [{ id: 'a', name: 'A', description: '', version: '1', scope: 'builtin' as const }],
      userItems: [{ id: 'b', name: 'B', description: '', version: '1', scope: 'user' as const }],
      projectItems: [{ id: 'c', name: 'C', description: '', version: '1', scope: 'project' as const }],
    }
    expect(selectAllWorkflows(data).map((w) => w.id)).toEqual(['a', 'b', 'c'])
  })

  it('single-entity workflow keys are scoped by id, workdir and scope', () => {
    expect(workflowResource.keyOf('review', '/a', 'project')).toBe('workflow:review:/a:project')
    expect(workflowResource.keyOf('review', '/a', 'user')).toBe('workflow:review:/a:user')
    expect(workflowResource.keyOf('review', '/b')).toBe('workflow:review:/b:')
    expect(workflowResource.keyOf('other', '/a')).not.toBe(workflowResource.keyOf('review', '/a'))
  })

  it('single-entity workflow fetch hits the id-scoped URL with workdir and scope', async () => {
    vi.mocked(authFetch).mockResolvedValue(
      jsonResponse({ metadata: { id: 'review', name: 'Review' }, entryStep: 's1', settings: {}, steps: [] }),
    )
    const full = await workflowResource.refresh('review', '/repo/a', 'project')
    expect(authFetch).toHaveBeenCalledWith('/api/workflows/review?workdir=%2Frepo%2Fa&scope=project')
    expect(full?.metadata.id).toBe('review')
  })

  it('workflow default resource is keyed by id + workdir and hits the defaults URL', async () => {
    vi.mocked(authFetch).mockResolvedValue(
      jsonResponse({ metadata: { id: 'builtin', name: 'B' }, entryStep: 's1', settings: {}, steps: [] }),
    )
    const full = await workflowDefaultResource.refresh('builtin', '/repo/a')
    expect(authFetch).toHaveBeenCalledWith('/api/workflows/defaults/builtin?workdir=%2Frepo%2Fa')
    expect(full?.metadata.id).toBe('builtin')
    expect(workflowDefaultResource.keyOf('builtin', '/repo/a')).toBe('workflow-default:builtin:/repo/a')
  })

  it('refreshWorkflowLists revalidates every retained workflow list across workdirs', async () => {
    vi.mocked(authFetch).mockImplementation(async (url: string) => {
      const workdir = url.includes('?workdir=') ? decodeURIComponent(url.split('=')[1] ?? '') : ''
      return jsonResponse({ defaults: [{ id: `wf-${workdir}`, name: `wf-${workdir}`, scope: 'builtin' }] })
    })
    await workflowsResource.refresh('/repo/a')
    await workflowsResource.refresh('/repo/b')
    await workflowsResource.refresh('/repo/c')
    retain(workflowsResource.keyOf('/repo/a'))
    retain(workflowsResource.keyOf('/repo/b'))
    vi.mocked(authFetch).mockClear()

    await refreshWorkflowLists()

    const urls = vi.mocked(authFetch).mock.calls.map(([url]) => url)
    expect(urls).toEqual(
      expect.arrayContaining(['/api/workflows?workdir=%2Frepo%2Fa', '/api/workflows?workdir=%2Frepo%2Fb']),
    )
    expect(urls).not.toContain('/api/workflows?workdir=%2Frepo%2Fc')
  })

  it('refreshWorkflowLists refreshes the caller workdir once, even without a mounted consumer', async () => {
    vi.mocked(authFetch).mockImplementation(async (url: string) => {
      const workdir = url.includes('?workdir=') ? decodeURIComponent(url.split('=')[1] ?? '') : ''
      return jsonResponse({ defaults: [{ id: `wf-${workdir}`, name: `wf-${workdir}`, scope: 'builtin' }] })
    })
    await workflowsResource.refresh('/repo/a')
    await workflowsResource.refresh('/repo/b')
    retain(workflowsResource.keyOf('/repo/b'))
    vi.mocked(authFetch).mockClear()

    await refreshWorkflowLists('/repo/a')

    const urls = vi.mocked(authFetch).mock.calls.map(([url]) => url)
    expect(urls.filter((url) => url === '/api/workflows?workdir=%2Frepo%2Fa')).toHaveLength(1)
    expect(urls).toContain('/api/workflows?workdir=%2Frepo%2Fb')
  })

  it('revalidateWorkflows is a no-op while the cached list is fresh', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({ defaults: [] }))
    await workflowsResource.refresh('/repo/a')
    vi.mocked(authFetch).mockClear()

    await revalidateWorkflows('/repo/a')

    expect(authFetch).not.toHaveBeenCalled()
  })

  it('revalidateWorkflows refetches once the cached list is older than the window', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(authFetch).mockResolvedValue(jsonResponse({ defaults: [] }))
      await workflowsResource.refresh('/repo/a')
      vi.mocked(authFetch).mockClear()
      vi.setSystemTime(Date.now() + WORKFLOW_REVALIDATE_MS + 1)

      await revalidateWorkflows('/repo/a')

      expect(authFetch).toHaveBeenCalledWith('/api/workflows?workdir=%2Frepo%2Fa')
    } finally {
      vi.useRealTimers()
    }
  })

  it('template variables resource uses a single global key', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({ variables: [{ name: 'x', description: 'X' }] }))
    expect(templateVariablesResource.keyOf()).toBe('workflow-template-variables')
    const data = await templateVariablesResource.refresh()
    expect(authFetch).toHaveBeenCalledWith('/api/workflows/template-variables')
    expect(data?.variables).toEqual([{ name: 'x', description: 'X' }])
  })
})
