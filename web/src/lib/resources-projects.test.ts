import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authFetch } from './api'
import { clearCache } from './resourceCache'
import { projectResource, projectsResource, readProject, readProjects } from './resources'

vi.mock('./api', () => ({
  authFetch: vi.fn(),
}))

function jsonResponse(data: unknown): Response {
  return { ok: true, json: () => Promise.resolve(data) } as unknown as Response
}

const projectA = { id: 'proj-a', name: 'Alpha', workdir: '/repo/a', createdAt: '', updatedAt: '' }

describe('projectsResource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCache()
  })

  it('uses a single global list key', () => {
    expect(projectsResource.keyOf()).toBe('projects:list')
  })

  it('fetches the projects list from the global endpoint', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({ projects: [projectA] }))
    await projectsResource.refresh()
    expect(authFetch).toHaveBeenCalledWith('/api/projects')
    expect(readProjects()?.projects[0]?.id).toBe('proj-a')
  })

  it('normalizes a missing projects field to an empty list', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({}))
    await projectsResource.refresh()
    expect(readProjects()).toEqual({ projects: [] })
  })

  it('single-entity project keys are scoped by id', () => {
    expect(projectResource.keyOf('proj-a')).toBe('project:proj-a')
    expect(projectResource.keyOf('proj-b')).not.toBe(projectResource.keyOf('proj-a'))
  })

  it('fetches the project detail from the id-scoped URL', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({ project: projectA }))
    const project = await projectResource.refresh('proj-a')
    expect(authFetch).toHaveBeenCalledWith('/api/projects/proj-a')
    expect(project?.id).toBe('proj-a')
    expect(readProject('proj-a')?.id).toBe('proj-a')
  })

  it('resolves to null when the detail is missing', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({}))
    const project = await projectResource.refresh('ghost')
    expect(project).toBeNull()
  })
})
