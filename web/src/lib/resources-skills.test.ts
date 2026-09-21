import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authFetch } from './api'
import { clearCache } from './resourceCache'
import { skillDefaultResource, skillResource, skillsResource, readSkills } from './resources'

vi.mock('./api', () => ({
  authFetch: vi.fn(),
}))

function jsonResponse(data: unknown): Response {
  return { ok: true, json: () => Promise.resolve(data) } as unknown as Response
}

describe('skillsResource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCache()
  })

  it('scopes the cache key by workdir so wrong-scope data is impossible', () => {
    expect(skillsResource.keyOf('/repo/a')).toBe('skills:/repo/a')
    expect(skillsResource.keyOf('/repo/b')).toBe('skills:/repo/b')
    expect(skillsResource.keyOf(undefined)).toBe('skills:')
    expect(skillsResource.keyOf('/repo/a')).not.toBe(skillsResource.keyOf(undefined))
  })

  it('fetches the skills list scoped to the requested workdir', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({ defaults: [] }))
    await skillsResource.refresh('/repo/a')
    expect(authFetch).toHaveBeenCalledWith('/api/skills?workdir=%2Frepo%2Fa')
  })

  it('keeps different workdir scopes isolated in the cache', async () => {
    vi.mocked(authFetch).mockImplementation(async (url: string) => {
      const workdir = url.includes('?workdir=') ? decodeURIComponent(url.split('=')[1] ?? '') : ''
      return jsonResponse({ defaults: [{ id: `skill-${workdir}`, name: `skill-${workdir}` }] })
    })
    await skillsResource.refresh('/repo/a')
    await skillsResource.refresh('/repo/b')

    expect(readSkills('/repo/a')?.defaults[0]?.id).toBe('skill-/repo/a')
    expect(readSkills('/repo/b')?.defaults[0]?.id).toBe('skill-/repo/b')
    expect(readSkills('/repo/c')).toBeUndefined()
  })

  it('normalizes missing response fields to empty collections', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({}))
    await skillsResource.refresh(undefined)
    expect(readSkills(undefined)).toEqual({
      defaults: [],
      userItems: [],
      projectItems: [],
      items: [],
      selectedDirectory: null,
      diagnostics: [],
    })
  })

  it('single-entity skill keys are scoped by id and workdir', () => {
    expect(skillResource.keyOf('review', '/a')).toBe('skill:review:/a')
    expect(skillResource.keyOf('review', '/b')).toBe('skill:review:/b')
    expect(skillResource.keyOf('review')).toBe('skill:review:')
    expect(skillResource.keyOf('other', '/a')).not.toBe(skillResource.keyOf('review', '/a'))
  })

  it('single-entity skill fetch hits the id-scoped URL with workdir', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({ metadata: { id: 'review', name: 'Review' }, prompt: 'x' }))
    const full = await skillResource.refresh('review', '/repo/a')
    expect(authFetch).toHaveBeenCalledWith('/api/skills/review?workdir=%2Frepo%2Fa')
    expect(full?.metadata.id).toBe('review')
  })

  it('skill default resource is keyed by id only and hits the defaults URL', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({ metadata: { id: 'summarize', name: 'S' }, prompt: 'p' }))
    const full = await skillDefaultResource.refresh('summarize')
    expect(authFetch).toHaveBeenCalledWith('/api/skills/defaults/summarize')
    expect(full?.metadata.id).toBe('summarize')
    expect(skillDefaultResource.keyOf('summarize')).toBe('skill-default:summarize')
  })

  it('missing single-entity skill resolves to null without throwing', async () => {
    vi.mocked(authFetch).mockResolvedValue({ ok: false, json: () => Promise.resolve({}) } as unknown as Response)
    const full = await skillResource.refresh('ghost', '/repo/a')
    expect(full).toBeNull()
  })
})
