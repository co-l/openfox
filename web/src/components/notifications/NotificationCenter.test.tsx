// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NotificationCenter } from './NotificationCenter'
import { clearCache } from '../../lib/resourceCache'
import { notificationsResource } from '../../lib/resources'
import { authFetch } from '../../lib/api'
import { setLocale } from '@shared/i18n/index.js'
import type { Notification } from '@shared/types.js'

vi.mock('../../lib/api', () => ({
  authFetch: vi.fn(),
}))

const mockNotifs: Notification[] = [
  {
    id: 'n1',
    title: 'Plugin Alert',
    body: 'Something happened in plugin',
    source: 'plugin',
    read: false,
    createdAt: '2026-09-04T00:00:00.000Z',
  },
  {
    id: 'n2',
    title: 'System update',
    body: 'Everything is running smoothly',
    source: 'system',
    read: true,
    createdAt: '2026-09-04T01:00:00.000Z',
  },
]

describe('NotificationCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCache()
    setLocale('en')
  })

  it('renders empty state when there are no notifications', () => {
    notificationsResource.write([])
    render(<NotificationCenter isOpen={true} onClose={() => {}} />)

    expect(screen.getByText('Notifications')).toBeDefined()
    expect(screen.getByText('No notifications')).toBeDefined()
  })

  it('renders notification list and calls markAllRead on open', async () => {
    notificationsResource.write(mockNotifs)
    vi.mocked(authFetch).mockResolvedValue({ ok: true } as Response)

    render(<NotificationCenter isOpen={true} onClose={() => {}} />)

    expect(screen.getByText('Plugin Alert')).toBeDefined()
    expect(screen.getByText('Something happened in plugin')).toBeDefined()
    expect(screen.getByText('System update')).toBeDefined()

    await waitFor(() => {
      expect(authFetch).toHaveBeenCalledWith('/api/notifications/read-all', { method: 'POST' })
    })
  })

  it('supports French locale translation', () => {
    setLocale('fr')
    notificationsResource.write([])
    render(<NotificationCenter isOpen={true} onClose={() => {}} />)

    expect(screen.getByText('Notifications')).toBeDefined()
    expect(screen.getByText('Aucune notification')).toBeDefined()
  })

  it('deletes a notification on dismiss click', async () => {
    notificationsResource.write(mockNotifs)
    vi.mocked(authFetch).mockResolvedValue({ ok: true } as Response)

    render(<NotificationCenter isOpen={true} onClose={() => {}} />)

    const dismissBtns = screen.getAllByRole('button', { name: 'Dismiss notification' })
    fireEvent.click(dismissBtns[0]!)

    await waitFor(() => {
      expect(authFetch).toHaveBeenCalledWith('/api/notifications/n1', { method: 'DELETE' })
    })
  })

  it('opens confirmation modal and clears all notifications', async () => {
    notificationsResource.write(mockNotifs)
    vi.mocked(authFetch).mockResolvedValue({ ok: true } as Response)

    render(<NotificationCenter isOpen={true} onClose={() => {}} />)

    const clearAllBtn = screen.getByRole('button', { name: 'Clear all' })
    fireEvent.click(clearAllBtn)

    expect(screen.getByText('Clear all notifications?')).toBeDefined()
    expect(screen.getByText('Your entire notification history will be deleted.')).toBeDefined()

    const confirmBtns = screen.getAllByRole('button', { name: 'Clear all' })
    // The confirm button in the modal
    fireEvent.click(confirmBtns[confirmBtns.length - 1]!)

    await waitFor(() => {
      expect(authFetch).toHaveBeenCalledWith('/api/notifications', { method: 'DELETE' })
    })
  })
})
