import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authFetch } from './api'
import { clearCache, retain } from './resourceCache'
import { readWorkflows, workflowsResource } from './resources'
import { createWorkflow, deleteWorkflow, duplicateWorkflow, updateWorkflow } from './workflows-actions'

vi.mock('./api', () => ({
  authFetch: vi.fn(),
}))

function jsonResponse(data: unknown, ok = true): Response {
  return { ok, json: () => Promise.resolve(data) } as unknown as Response
}

let listSeq = 0

function listFor(url: string): Response {
  const workdir = url.includes('?workdir=') ? decodeURIComponent(url.split('=')[1] ?? '') : ''
  listSeq += 1
  return jsonResponse({
    defaults: [],
    userItems: [],
    projectItems: [{ id: `wf-${workdir}-${listSeq}`, name: workdir, scope: 'project' }],
  })
}

/** Seed two cached workflow lists and mark them as held by a mounted consumer. */
async function seedLists(workdirs: string[], retained: string[]): Promise<void> {
  vi.mocked(authFetch).mockImplementation(async (url: string) => listFor(url))
  for (const workdir of workdirs) await workflowsResource.refresh(workdir)
  for (const workdir of retained) retain(workflowsResource.keyOf(workdir))
  vi.mocked(authFetch).mockClear()
  vi.mocked(authFetch).mockImplementation(async (url: string) =>
    url.startsWith('/api/workflows?') ? listFor(url) : jsonResponse({}),
  )
}

function fetchedUrls(): string[] {
  return vi.mocked(authFetch).mock.calls.map(([url]) => url)
}

function countFetches(url: string): number {
  return fetchedUrls().filter((fetched) => fetched === url).length
}

describe('workflow mutations revalidate every live workflow list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCache()
  })

  it('updateWorkflow refreshes the edited workdir and every other live list', async () => {
    await seedLists(['/repo/a', '/repo/b', '/repo/c'], ['/repo/a', '/repo/b'])
    const siblingBefore = readWorkflows('/repo/b')?.projectItems[0]?.id

    const result = await updateWorkflow(
      'wf-1',
      { metadata: { id: 'wf-1', name: 'WF', description: '', version: '1.0.0' } },
      '/repo/a',
      'project',
    )

    expect(result.success).toBe(true)
    const urls = fetchedUrls()
    expect(urls).toContain('/api/workflows/wf-1?workdir=%2Frepo%2Fa&scope=project')
    expect(urls).toContain('/api/workflows?workdir=%2Frepo%2Fa')
    expect(urls).toContain('/api/workflows?workdir=%2Frepo%2Fb')
    expect(urls).not.toContain('/api/workflows?workdir=%2Frepo%2Fc')
    // One mutation, one request per live list — the caller's own scope must not
    // be fetched twice.
    expect(countFetches('/api/workflows?workdir=%2Frepo%2Fa')).toBe(1)
    expect(countFetches('/api/workflows?workdir=%2Frepo%2Fb')).toBe(1)
    // The launch surfaces on the other project read this key: it must hold the
    // refetched list, not the pre-edit snapshot.
    expect(readWorkflows('/repo/b')?.projectItems[0]?.id).not.toBe(siblingBefore)
  })

  it('createWorkflow revalidates the other live lists too (user-scope edits are global)', async () => {
    await seedLists(['/repo/a', '/repo/b'], ['/repo/a', '/repo/b'])

    const result = await createWorkflow(
      {
        metadata: { id: 'wf-2', name: 'WF 2', description: '', version: '1.0.0' },
        entryStep: 's1',
        settings: { maxIterations: 10 },
        steps: [],
      },
      'user',
      '/repo/a',
    )

    expect(result.success).toBe(true)
    const urls = fetchedUrls()
    expect(urls).toContain('/api/workflows?workdir=%2Frepo%2Fa')
    expect(urls).toContain('/api/workflows?workdir=%2Frepo%2Fb')
  })

  it('deleteWorkflow revalidates the other live lists too', async () => {
    await seedLists(['/repo/a', '/repo/b'], ['/repo/a', '/repo/b'])

    const result = await deleteWorkflow('wf-1', 'project', '/repo/a')

    expect(result.success).toBe(true)
    const urls = fetchedUrls()
    expect(urls).toContain('/api/workflows/wf-1?workdir=%2Frepo%2Fa&scope=project')
    expect(urls).toContain('/api/workflows?workdir=%2Frepo%2Fb')
  })

  it('duplicateWorkflow revalidates the other live lists too', async () => {
    await seedLists(['/repo/a', '/repo/b'], ['/repo/a', '/repo/b'])

    const result = await duplicateWorkflow('wf-1', 'user', '/repo/a')

    expect(result.success).toBe(true)
    const urls = fetchedUrls()
    expect(urls).toContain('/api/workflows?workdir=%2Frepo%2Fa')
    expect(urls).toContain('/api/workflows?workdir=%2Frepo%2Fb')
  })
})
