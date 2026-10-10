// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLocation } from 'wouter'
import { useProject } from './useProject'
import { useMissingProjectRedirect } from './useMissingProjectRedirect'

vi.mock('wouter', () => ({ useLocation: vi.fn() }))
vi.mock('./useProject', () => ({ useProject: vi.fn() }))

describe('useMissingProjectRedirect', () => {
  const navigate = vi.fn()
  beforeEach(() => {
    navigate.mockReset()
    vi.mocked(useLocation).mockReturnValue(['/p/gone', navigate] as never)
  })

  it('goes back home when the project of the URL does not exist', () => {
    // A restored tab or a link to a deleted project left the view on an
    // endless spinner.
    vi.mocked(useProject).mockReturnValue({ project: null, notFound: true, refresh: vi.fn() } as never)

    renderHook(() => useMissingProjectRedirect('gone'))

    expect(navigate).toHaveBeenCalledWith('/')
  })

  it('stays while the project loads or exists', () => {
    vi.mocked(useProject).mockReturnValue({ project: null, notFound: false, refresh: vi.fn() } as never)

    renderHook(() => useMissingProjectRedirect('p1'))

    expect(navigate).not.toHaveBeenCalled()
  })
})
