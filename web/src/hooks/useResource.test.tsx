// @vitest-environment happy-dom
import { act, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GRACE_MS, clearCache, resource } from '../lib/resourceCache'
import { useResource, useResourceWhen } from './useResource'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function makeResource(maxAgeMs = 0) {
  const fetch = vi.fn(async () => 'loaded')
  const res = resource<string, []>({ key: () => 'test:key', fetch, maxAgeMs })
  return { fetch, res }
}

describe('useResource', () => {
  beforeEach(() => {
    clearCache()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mounts loading, populates data, and releases on unmount (evicted after grace)', async () => {
    const { fetch, res } = makeResource()
    const { result, unmount } = renderHook(() => useResource(res))

    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeUndefined()

    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toBe('loaded')
    expect(fetch).toHaveBeenCalledTimes(1)

    unmount()
    vi.advanceTimersByTime(GRACE_MS + 1_000)

    const second = renderHook(() => useResource(res))
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    second.unmount()
  })

  it('does not refetch on a quick remount within the freshness window', async () => {
    const { fetch, res } = makeResource(60_000)
    const first = renderHook(() => useResource(res))
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(fetch).toHaveBeenCalledTimes(1)

    first.unmount()

    const second = renderHook(() => useResource(res))
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(second.result.current.data).toBe('loaded')
    second.unmount()
  })

  it('keeps distinct scopes isolated and reloads when the scope changes', async () => {
    const fetch = vi.fn(async (id: string) => `data-${id}`)
    const res = resource<string, [string]>({ key: (id) => `test:${id}`, fetch })
    const { result, rerender } = renderHook(({ id }) => useResource(res, id), { initialProps: { id: 'a' } })

    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(result.current.data).toBe('data-a')

    rerender({ id: 'b' })
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result.current.data).toBe('data-b')
  })

  it('propagates a mutation refresh to every subscriber on the same key (discrepancy test)', async () => {
    let counter = 0
    const fetch = vi.fn(async () => `v${++counter}`)
    const res = resource<string, []>({ key: () => 'shared:key', fetch })

    function Consumer({ label }: { label: string }) {
      const { data } = useResource(res)
      return (
        <div>
          {label}:{data ?? 'empty'}
        </div>
      )
    }

    const a = render(<Consumer label="A" />)
    const b = render(<Consumer label="B" />)
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(a.container.textContent).toBe('A:v1')
    expect(b.container.textContent).toBe('B:v1')

    // Component A mutates and refreshes the shared resource; component B must
    // see the fresh data on its next render with no remount and no extra fetch.
    await act(async () => {
      await res.refresh()
    })
    expect(b.container.textContent).toBe('B:v2')
    expect(a.container.textContent).toBe('A:v2')
    expect(fetch).toHaveBeenCalledTimes(2)

    a.unmount()
    b.unmount()
  })

  it('does not refetch on an unrelated re-render of the consumer', async () => {
    const { fetch, res } = makeResource()
    const { result, rerender } = renderHook(() => useResource(res))
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(fetch).toHaveBeenCalledTimes(1)

    rerender()
    rerender()
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(result.current.data).toBe('loaded')
  })

  it('skips the fetch while disabled and loads once enabled', async () => {
    const { fetch, res } = makeResource()
    const { result, rerender } = renderHook(({ enabled }) => useResourceWhen(enabled, res), {
      initialProps: { enabled: false },
    })

    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(result.current.data).toBeUndefined()

    rerender({ enabled: true })
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(result.current.data).toBe('loaded')
  })
})
