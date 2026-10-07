// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authFetch } from '../lib/api'
import { clearCache } from '../lib/resourceCache'
import { useProject } from './useProject'

vi.mock('../lib/api', () => ({ authFetch: vi.fn() }))
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const respond = (status: number, body: unknown = {}) =>
  vi.mocked(authFetch).mockResolvedValue(new Response(JSON.stringify(body), { status }))

async function settle() {
  await act(async () => {
    await vi.runAllTimersAsync()
  })
}

describe('useProject', () => {
  beforeEach(() => {
    clearCache()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.mocked(authFetch).mockReset()
  })

  it('reports a project the server does not know', async () => {
    // A link or a restored tab can point to a project that no longer exists
    // (deleted, or another OpenFox instance): its view waited for it forever.
    respond(404, { error: 'Project not found' })
    const { result } = renderHook(() => useProject('gone'))

    await settle()

    expect(result.current.project).toBeNull()
    expect(result.current.notFound).toBe(true)
  })

  it('does not report a project that is loading or failed to load', async () => {
    // A server error or a dropped connection says nothing about the project:
    // only a 404 means it is gone.
    respond(500, { error: 'boom' })
    const { result } = renderHook(() => useProject('p1'))

    expect(result.current.notFound).toBe(false)
    await settle()

    expect(result.current.notFound).toBe(false)
  })

  it('returns the project when it exists', async () => {
    respond(200, { project: { id: 'p1', name: 'Demo', workdir: '/tmp/demo' } })
    const { result } = renderHook(() => useProject('p1'))

    await settle()

    expect(result.current.project).toMatchObject({ id: 'p1' })
    expect(result.current.notFound).toBe(false)
  })

  it('does not report anything without a project id', async () => {
    const { result } = renderHook(() => useProject(null))

    await settle()

    expect(result.current.notFound).toBe(false)
    expect(authFetch).not.toHaveBeenCalled()
  })
})
