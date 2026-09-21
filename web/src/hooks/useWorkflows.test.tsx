// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authFetch } from '../lib/api'
import { clearCache } from '../lib/resourceCache'
import { workflowsResource } from '../lib/resources'
import type { WorkflowInfo } from '../lib/workflows-actions'
import { useWorkflows } from './useWorkflows'

vi.mock('../lib/api', () => ({
  authFetch: vi.fn(),
}))

function workflow(id: string, scope: WorkflowInfo['scope']): WorkflowInfo {
  return { id, name: id, description: '', version: '1', scope }
}

function seedWorkflows(workdir: string | undefined) {
  vi.mocked(authFetch).mockImplementation(async (url: string) => {
    if (url === `/api/workflows${workdir ? `?workdir=${encodeURIComponent(workdir)}` : ''}`) {
      return {
        ok: true,
        json: async () => ({
          defaults: [workflow('builtin', 'builtin')],
          userItems: [workflow('mine', 'user')],
          projectItems: [workflow('ours', 'project')],
        }),
      } as unknown as Response
    }
    return { ok: true, json: async () => ({}) } as unknown as Response
  })
}

describe('useWorkflows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCache()
  })

  it('flattens workflows from every scope', async () => {
    seedWorkflows(undefined)
    await workflowsResource.refresh()
    const { result } = renderHook(() => useWorkflows())
    expect(result.current.workflows.map((w) => w.id)).toEqual(['builtin', 'mine', 'ours'])
  })

  it('returns an empty list while the scope was never loaded', () => {
    const { result } = renderHook(() => useWorkflows('/nowhere'))
    expect(result.current.workflows).toEqual([])
  })

  it('keeps distinct workdir scopes isolated', async () => {
    seedWorkflows('/repo/a')
    await workflowsResource.refresh('/repo/a')
    const a = renderHook(() => useWorkflows('/repo/a'))
    const b = renderHook(() => useWorkflows('/repo/b'))
    expect(a.result.current.workflows.map((w) => w.id)).toEqual(['builtin', 'mine', 'ours'])
    expect(b.result.current.workflows).toEqual([])
    a.unmount()
    b.unmount()
  })

  it('produces a stable object across re-renders while the underlying data is unchanged', async () => {
    seedWorkflows(undefined)
    await workflowsResource.refresh()
    const { result } = renderHook(() => useWorkflows())
    const first = result.current
    act(() => {})
    expect(result.current).toBe(first)
  })
})
