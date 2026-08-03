// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

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

type ModalProps = {
  isOpen: boolean
  onClose: () => void
  versionInfo?: { current: string; latest: string } | null
}

function renderModal(props: Partial<ModalProps> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <AutoUpdateModal
        isOpen={props.isOpen ?? true}
        onClose={props.onClose ?? vi.fn()}
        versionInfo={props.versionInfo ?? VERSION_INFO}
      />,
    )
  })
  return { container, root }
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
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('AutoUpdateModal — restart-after-update flow', () => {
  it('service mode: update succeeds without auto-restart and shows Restart OpenFox now + Later', async () => {
    mockUpdateSuccess(true)
    const onClose = vi.fn()
    const { container } = renderModal({ onClose })

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
    mockUpdateSuccess(false)
    const onClose = vi.fn()
    const { container } = renderModal({ onClose })

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
    const { container } = renderModal()

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
    const { container } = renderModal()

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
    const { container, root } = renderModal({ onClose: vi.fn() })

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

    const { container, root } = renderModal()

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
})
