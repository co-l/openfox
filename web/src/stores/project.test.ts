// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authFetch } from '../lib/api'
import { clearCache } from '../lib/resourceCache'
import { projectsResource, readProject, readProjects } from '../lib/resources'
import { useProjectStore } from './project'

vi.mock('../lib/api', () => ({
  authFetch: vi.fn(),
}))

const mockedAuthFetch = vi.mocked(authFetch)

const project = {
  id: 'proj-a',
  name: 'Alpha',
  workdir: '/repo/a',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
}

function jsonResponse(data: unknown = {}): Response {
  return { ok: true, json: () => Promise.resolve(data) } as Response
}

describe('project store mutations', () => {
  beforeEach(() => {
    mockedAuthFetch.mockReset()
    clearCache()
    useProjectStore.setState({ currentProjectId: null })
  })

  it('createProject POSTs then refreshes the list resource', async () => {
    mockedAuthFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/projects' && !init) return jsonResponse({ projects: [project] })
      return jsonResponse({ project })
    })
    const created = await useProjectStore.getState().createProject('Alpha', '/repo/a')

    expect(mockedAuthFetch).toHaveBeenNthCalledWith(
      1,
      '/api/projects',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Alpha', workdir: '/repo/a' }) }),
    )
    expect(mockedAuthFetch).toHaveBeenNthCalledWith(2, '/api/projects')
    expect(created).toEqual(project)
    expect(readProjects()?.projects[0]?.id).toBe('proj-a')
  })

  it('createProject surfaces a permission error object for EACCES', async () => {
    mockedAuthFetch.mockImplementation(async () => {
      return {
        ok: false,
        json: async () => ({ error: 'permission denied', code: 'EACCES', path: '/repo/a' }),
      } as Response
    })
    const created = await useProjectStore.getState().createProject('Alpha', '/repo/a')
    expect(created).toEqual({ error: { code: 'EACCES', path: '/repo/a', message: 'permission denied' } })
  })

  it('updateProject PUTs then refreshes list and detail resources', async () => {
    mockedAuthFetch.mockResolvedValue(jsonResponse({ project: { ...project, name: 'Beta' } }))
    const updated = await useProjectStore.getState().updateProject('proj-a', { name: 'Beta' })

    expect(mockedAuthFetch).toHaveBeenNthCalledWith(
      1,
      '/api/projects/proj-a',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ name: 'Beta' }) }),
    )
    expect(mockedAuthFetch).toHaveBeenNthCalledWith(2, '/api/projects')
    expect(mockedAuthFetch).toHaveBeenNthCalledWith(3, '/api/projects/proj-a')
    expect(updated?.name).toBe('Beta')
    expect(readProject('proj-a')?.name).toBe('Beta')
  })

  it('deleteProject DELETEs, refreshes the list, invalidates detail, and clears the open project', async () => {
    useProjectStore.setState({ currentProjectId: 'proj-a' })
    mockedAuthFetch.mockResolvedValue(jsonResponse({}))

    const ok = await useProjectStore.getState().deleteProject('proj-a')

    expect(ok).toBe(true)
    expect(mockedAuthFetch).toHaveBeenNthCalledWith(
      1,
      '/api/projects/proj-a',
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(mockedAuthFetch).toHaveBeenNthCalledWith(2, '/api/projects')
    expect(useProjectStore.getState().currentProjectId).toBeNull()
  })

  it('toggleStar PUTs and refreshes the list', async () => {
    mockedAuthFetch.mockResolvedValue(jsonResponse({}))
    const ok = await useProjectStore.getState().toggleStar('proj-a', true)

    expect(ok).toBe(true)
    expect(mockedAuthFetch).toHaveBeenNthCalledWith(
      1,
      '/api/projects/proj-a/star',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ isStarred: true }) }),
    )
    expect(mockedAuthFetch).toHaveBeenNthCalledWith(2, '/api/projects')
    expect(projectsResource.keyOf()).toBe('projects:list')
  })
})
