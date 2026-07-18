// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useUpdateStore } from './update'

beforeEach(() => {
  useUpdateStore.setState({ status: 'idle', current: null, latest: null })
  vi.restoreAllMocks()
})

describe('useUpdateStore', () => {
  describe('initial state', () => {
    it('starts as idle with no version info', () => {
      const state = useUpdateStore.getState()
      expect(state.status).toBe('idle')
      expect(state.current).toBeNull()
      expect(state.latest).toBeNull()
    })
  })

  describe('check', () => {
    it('transitions to checking then upToDate when no update available', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ isUpdateAvailable: false, current: '2.0.70', latest: '2.0.70' }),
      })
      vi.stubGlobal('fetch', mockFetch)

      const checkPromise = useUpdateStore.getState().check()

      expect(useUpdateStore.getState().status).toBe('checking')

      await checkPromise

      const state = useUpdateStore.getState()
      expect(state.status).toBe('upToDate')
      expect(state.current).toBe('2.0.70')
      expect(state.latest).toBe('2.0.70')
    })

    it('transitions to checking then available when update exists', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ isUpdateAvailable: true, current: '2.0.70', latest: '2.0.71' }),
      })
      vi.stubGlobal('fetch', mockFetch)

      await useUpdateStore.getState().check()

      const state = useUpdateStore.getState()
      expect(state.status).toBe('available')
      expect(state.current).toBe('2.0.70')
      expect(state.latest).toBe('2.0.71')
    })

    it('transitions to error on network failure', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
      vi.stubGlobal('fetch', mockFetch)

      await useUpdateStore.getState().check()

      expect(useUpdateStore.getState().status).toBe('error')
    })

    it('transitions to error on non-ok response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      })
      vi.stubGlobal('fetch', mockFetch)

      await useUpdateStore.getState().check()

      expect(useUpdateStore.getState().status).toBe('error')
    })

    it('guards against concurrent checks', async () => {
      let resolveFirst: (value: unknown) => void = () => {}
      const firstPromise = new Promise((resolve) => {
        resolveFirst = resolve
      })
      const mockFetch = vi.fn().mockReturnValue(firstPromise)
      vi.stubGlobal('fetch', mockFetch)

      useUpdateStore.setState({ status: 'idle' })

      const check1 = useUpdateStore.getState().check()
      const check2 = useUpdateStore.getState().check()

      resolveFirst({
        ok: true,
        json: () => Promise.resolve({ isUpdateAvailable: false, current: '1.0.0', latest: '1.0.0' }),
      })

      await Promise.all([check1, check2])

      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('force bypasses the concurrent check guard', async () => {
      let resolveFirst: (value: unknown) => void = () => {}
      const firstPromise = new Promise((resolve) => {
        resolveFirst = resolve
      })
      const mockFetch = vi.fn().mockReturnValue(firstPromise)
      vi.stubGlobal('fetch', mockFetch)

      useUpdateStore.setState({ status: 'idle' })

      const check1 = useUpdateStore.getState().check()
      const check2 = useUpdateStore.getState().check(true)

      resolveFirst({
        ok: true,
        json: () => Promise.resolve({ isUpdateAvailable: false, current: '1.0.0', latest: '1.0.0' }),
      })

      await Promise.all([check1, check2])

      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('force adds ?force=true to the request URL', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ isUpdateAvailable: false, current: '1.0.0', latest: '1.0.0' }),
      })
      vi.stubGlobal('fetch', mockFetch)

      await useUpdateStore.getState().check(true)

      expect(mockFetch).toHaveBeenCalledWith('/api/auto-update/check?force=true')
    })

    it('can check again after previous check completes', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ isUpdateAvailable: false, current: '2.0.70', latest: '2.0.70' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ isUpdateAvailable: true, current: '2.0.70', latest: '2.0.71' }),
        })
      vi.stubGlobal('fetch', mockFetch)

      await useUpdateStore.getState().check()
      expect(useUpdateStore.getState().status).toBe('upToDate')

      await useUpdateStore.getState().check()
      expect(useUpdateStore.getState().status).toBe('available')
      expect(useUpdateStore.getState().latest).toBe('2.0.71')
    })
  })
})
