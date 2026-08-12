// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// React 19 requires this flag before act() can be used (repo convention).
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mockAuthFetch = vi.fn()
vi.mock('../lib/api', () => ({
  authFetch: (...args: unknown[]) => mockAuthFetch(...args),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { AutoUpdateModal } from './AutoUpdateModal'

const VERSION_INFO = { current: '2.0.110', latest: '2.0.111' } as const
const STALE_CHECK = {
  current: '2.0.110',
  latest: '2.0.111',
  isUpdateAvailable: true,
  isService: true,
}

function mockUpdateSuccess(isService: boolean, version = '2.0.111'): void {
  mockAuthFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ success: true, version, isService }),
  })
}

function mockRestartSuccess(): void {
  mockAuthFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ success: true }),
  })
}

function mockRestartHttpError(status = 500): void {
  mockAuthFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: () => Promise.resolve({ error: 'restart failed' }),
  })
}

function mockCheckCurrent(current: string, latest = '2.0.111'): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ current, latest, isUpdateAvailable: current !== latest, isService: true }),
  })
}

function mockCheckRejected(): void {
  mockFetch.mockRejectedValueOnce(new Error('Network error'))
}

function mockCheckAlways(current: string): void {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ ...STALE_CHECK, current }),
  })
}

function mockCheckService(isService: boolean): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ current: '2.0.110', latest: '2.0.111', isUpdateAvailable: true, isService }),
  })
}

// Deferred variant of the update POST so tests can toggle the checkbox while
// the update is still downloading, then resolve it.
function mockUpdateDeferred(isService = true, version = '2.0.111'): { resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<unknown>((res) => {
    resolve = () => res({ ok: true, json: () => Promise.resolve({ success: true, version, isService }) })
  })
  mockAuthFetch.mockImplementationOnce(() => promise)
  return { resolve }
}

type ModalProps = {
  isOpen: boolean
  onClose: () => void
  versionInfo?: { current: string; latest: string } | null
}

// Track created roots so afterEach can unmount them, stopping the progress-dots
// interval and any in-flight async work from leaking outside act().
const mountedRoots: Array<ReturnType<typeof createRoot>> = []

// Drain the microtask queue so promise chains inside the component (the
// open-time /check fetch, deferred update POSTs) settle deterministically
// inside act(). Bounded — generous enough that a mount path with a few more
// awaits still converges — and timer-mode agnostic (microtasks always run).
async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 25; i++) {
    await Promise.resolve()
  }
}

function renderModal(
  props: Partial<ModalProps> = {},
): Promise<{ container: HTMLElement; root: ReturnType<typeof createRoot> }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  // Rendering is async so the open-time /check fetch (which drives the
  // service-mode checkbox) settles inside act(), under both real and fake
  // timers.
  return act(async () => {
    root.render(
      <AutoUpdateModal
        isOpen={props.isOpen ?? true}
        onClose={props.onClose ?? vi.fn()}
        versionInfo={props.versionInfo ?? VERSION_INFO}
      />,
    )
    await drainMicrotasks()
    return { container, root }
  })
}

function findButton(label: string): HTMLButtonElement {
  const btn = Array.from(document.body.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes(label),
  ) as HTMLButtonElement | undefined
  if (!btn) throw new Error(`Button "${label}" not found`)
  return btn
}

function clickButton(_container: HTMLElement, label: string): void {
  const btn = findButton(label)
  act(() => {
    btn.click()
  })
}

function findCheckbox(): HTMLInputElement | null {
  return document.querySelector('input[type="checkbox"]')
}

function clickCheckbox(): void {
  const cb = findCheckbox()
  if (!cb) throw new Error('Checkbox not found')
  act(() => {
    cb.click()
  })
}

function bodyText(): string {
  return document.body.textContent ?? ''
}

beforeEach(() => {
  mockAuthFetch.mockReset()
  mockFetch.mockReset()
  localStorage.clear()
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { reload: vi.fn() },
  })
  vi.useRealTimers()
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => root.unmount())
  }
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('AutoUpdateModal — restart-after-update flow', () => {
  it('service mode: update succeeds without auto-restart and shows Restart OpenFox now + Later', async () => {
    mockCheckService(true)
    mockUpdateSuccess(true)
    const onClose = vi.fn()
    const { container } = await renderModal({ onClose })

    clickButton(container, 'Update OpenFox')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(mockAuthFetch.mock.calls.map((c) => c[0])).toEqual(['/api/auto-update'])
    expect(mockAuthFetch).toHaveBeenCalledTimes(1)
    expect(bodyText()).toContain('Restart OpenFox now')
    expect(bodyText()).toContain('Later')
  })

  it('non-service mode: no restart button, manual instruction + Close preserved', async () => {
    mockCheckService(false)
    mockUpdateSuccess(false)
    const onClose = vi.fn()
    const { container } = await renderModal({ onClose })

    clickButton(container, 'Update OpenFox')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(bodyText()).not.toContain('Restart OpenFox now')
    expect(bodyText()).toContain('Please restart OpenFox')
    expect(bodyText()).toContain('Close')

    clickButton(container, 'Close')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clicking Restart OpenFox now: calls /restart, polls /check, triggers reload when current matches installed version', async () => {
    vi.useFakeTimers()
    mockUpdateSuccess(true)
    mockRestartSuccess()
    mockCheckCurrent('2.0.110')
    mockCheckRejected()
    mockCheckCurrent('2.0.111', '2.0.111')

    const reloadMock = (window.location as unknown as { reload: () => void }).reload
    const { container } = await renderModal()

    clickButton(container, 'Update OpenFox')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    clickButton(container, 'Restart OpenFox now')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(mockAuthFetch.mock.calls.map((c) => c[0])).toContain('/api/auto-update/restart')
    expect(mockAuthFetch.mock.calls.filter((c) => c[0] === '/api/auto-update/restart')).toHaveLength(1)
    expect(bodyText()).toContain('Restarting')

    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000)
      })
    }

    expect(reloadMock).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('clicking Restart OpenFox now with explicit HTTP error on POST /restart still enters polling state', async () => {
    vi.useFakeTimers()
    mockUpdateSuccess(true)
    mockRestartHttpError()
    mockCheckAlways('2.0.110')

    const reloadMock = (window.location as unknown as { reload: () => void }).reload
    const { container } = await renderModal()

    clickButton(container, 'Update OpenFox')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    clickButton(container, 'Restart OpenFox now')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(mockFetch.mock.calls.length).toBeGreaterThan(0)
    expect(reloadMock).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('timeout (30s) on polling: no reload, fallback message and Close visible', async () => {
    vi.useFakeTimers()
    mockUpdateSuccess(true)
    mockRestartSuccess()
    mockCheckAlways('2.0.110')

    const reloadMock = (window.location as unknown as { reload: () => void }).reload
    const { container, root } = await renderModal({ onClose: vi.fn() })

    clickButton(container, 'Update OpenFox')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    clickButton(container, 'Restart OpenFox now')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000)
    })

    expect(reloadMock).not.toHaveBeenCalled()
    expect(bodyText().toLowerCase()).toContain('could not')
    expect(bodyText()).toContain('Close')

    await act(async () => {
      root.unmount()
    })

    vi.useRealTimers()
  })

  it('polling and timers are cleaned up on unmount', async () => {
    vi.useFakeTimers()
    mockUpdateSuccess(true)
    mockRestartSuccess()
    mockCheckAlways('2.0.110')

    const { container, root } = await renderModal()

    clickButton(container, 'Update OpenFox')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    clickButton(container, 'Restart OpenFox now')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const callsBeforeUnmount = mockFetch.mock.calls.length

    await act(async () => {
      root.unmount()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(mockFetch.mock.calls.length).toBe(callsBeforeUnmount)

    vi.useRealTimers()
  })

  it('service mode: renders the auto-restart checkbox, default unchecked', async () => {
    mockCheckService(true)
    await renderModal()

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const cb = findCheckbox()
    expect(cb).toBeTruthy()
    expect(cb!.checked).toBe(false)
    expect(bodyText()).toContain('Auto-restart once update is done')
  })

  it('non-service mode: renders no auto-restart checkbox', async () => {
    mockCheckService(false)
    await renderModal()

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(findCheckbox()).toBeNull()
    expect(bodyText()).not.toContain('Auto-restart once update is done')
  })

  it('checked before update: auto-restarts after the update finishes, no click needed, and marks the update applied before reload', async () => {
    vi.useFakeTimers()
    mockCheckService(true)
    mockUpdateSuccess(true)
    mockRestartSuccess()
    mockCheckCurrent('2.0.110')
    mockCheckRejected()
    mockCheckCurrent('2.0.111', '2.0.111')
    localStorage.setItem('openfox_last_version', '2.0.110')

    const reloadMock = (window.location as unknown as { reload: () => void }).reload
    const { container } = await renderModal()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    clickCheckbox()
    clickButton(container, 'Update OpenFox')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // Went straight to restarting — no "Restart OpenFox now" click required.
    expect(bodyText()).toContain('Restarting')
    expect(bodyText()).not.toContain('Restart OpenFox now')
    expect(mockAuthFetch.mock.calls.map((c) => c[0])).toContain('/api/auto-update/restart')

    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000)
      })
    }

    expect(reloadMock).toHaveBeenCalledTimes(1)
    // Truthful announcement: the applied-version flags are set only at reload.
    expect(localStorage.getItem('update_pending')).toBe('true')
    expect(localStorage.getItem('openfox_updated_to')).toBe('2.0.111')
    // The pre-update version is pinned as the changelog trim boundary.
    expect(localStorage.getItem('openfox_previous_version')).toBe('2.0.110')

    vi.useRealTimers()
  })

  it('checkbox stays visible while updating and a mid-update toggle is honored (live read)', async () => {
    vi.useFakeTimers()
    mockCheckService(true)
    const deferred = mockUpdateDeferred()
    mockRestartSuccess()
    mockCheckCurrent('2.0.110')
    mockCheckRejected()
    mockCheckCurrent('2.0.111', '2.0.111')

    const reloadMock = (window.location as unknown as { reload: () => void }).reload
    const { container } = await renderModal()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    clickButton(container, 'Update OpenFox')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // The download is in flight; the checkbox must still be there and live.
    expect(bodyText()).toContain('Updating')
    expect(findCheckbox()).toBeTruthy()

    clickCheckbox()
    await act(async () => {
      deferred.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(mockAuthFetch.mock.calls.map((c) => c[0])).toContain('/api/auto-update/restart')
    expect(bodyText()).toContain('Restarting')

    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000)
      })
    }

    expect(reloadMock).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('openfox_updated_to')).toBe('2.0.111')

    vi.useRealTimers()
  })

  it('choosing Later leaves the update unmarked (no false success banner)', async () => {
    mockCheckService(true)
    mockUpdateSuccess(true)
    const { container } = await renderModal({ onClose: vi.fn() })

    clickButton(container, 'Update OpenFox')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(bodyText()).toContain('Restart OpenFox now')
    clickButton(container, 'Later')

    expect(localStorage.getItem('update_pending')).toBeNull()
    expect(localStorage.getItem('openfox_updated_to')).toBeNull()
  })
})
