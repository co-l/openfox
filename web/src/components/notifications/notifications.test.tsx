/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NotificationToasts } from './NotificationToasts'
import { NotificationCenter } from './NotificationCenter'
import { NotificationBell } from './NotificationBell'
import { usePluginToastStore } from '../../stores/pluginToasts'
import { notificationsResource } from '../../lib/resources'
import { clearCache, write } from '../../lib/resourceCache'
import { useLocaleStore } from '../../stores/locale'

const notificationsRef: { current: { notifications: unknown[]; unreadCount: number } } = {
  current: { notifications: [], unreadCount: 0 },
}

const authFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
}))

function setFetchPayload(data: unknown): void {
  authFetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(data), { status: 200 })))
}

const markNotificationsRead = vi.fn()
const deleteNotification = vi.fn()
const clearNotifications = vi.fn()
const invokePluginRpc = vi.fn()
vi.mock('../../lib/plugin-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/plugin-actions')>()
  return {
    ...actual,
    markNotificationsRead: (...args: unknown[]) => markNotificationsRead(...args),
    deleteNotification: (...args: unknown[]) => deleteNotification(...args),
    clearNotifications: (...args: unknown[]) => clearNotifications(...args),
    invokePluginRpc: (...args: unknown[]) => invokePluginRpc(...args),
  }
})

const NOTIFICATION = {
  id: 'n1',
  pluginId: 'demo',
  title: { en: 'Build finished', fr: 'Build terminé' },
  body: { en: '3 tests passed', fr: '3 tests réussis' },
  level: 'success' as const,
  createdAt: '2026-09-08T10:00:00.000Z',
}

const NOTIFICATION_WITH_ACTION = {
  ...NOTIFICATION,
  id: 'n2',
  actions: [
    {
      label: { en: 'Open report', fr: 'Ouvrir le rapport' },
      onActivate: { kind: 'rpc' as const, method: 'report' },
    },
  ],
}

describe('NotificationToasts', () => {
  beforeEach(() => {
    clearCache()
    setFetchPayload({ notifications: [], unreadCount: 0 })
    usePluginToastStore.setState({ toasts: [] })
    useLocaleStore.setState({ locale: 'en' })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders and dismisses plugin toasts', async () => {
    usePluginToastStore.getState().push(NOTIFICATION)
    render(<NotificationToasts />)
    expect(screen.getByText('Build finished')).toBeDefined()
    expect(screen.getByText('3 tests passed')).toBeDefined()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(usePluginToastStore.getState().toasts).toHaveLength(0)
  })

  it('localizes toast content in French', () => {
    useLocaleStore.setState({ locale: 'fr' })
    usePluginToastStore.getState().push(NOTIFICATION)
    render(<NotificationToasts />)
    expect(screen.getByText('Build terminé')).toBeDefined()
  })

  it('renders notification actions and dispatches their activation', async () => {
    invokePluginRpc.mockResolvedValue('ok')
    usePluginToastStore.getState().push(NOTIFICATION_WITH_ACTION)
    render(<NotificationToasts />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Open report' }))
    await waitFor(() => expect(invokePluginRpc).toHaveBeenCalledWith('demo', 'report', {}, {}))
  })
})

describe('NotificationBell', () => {
  beforeEach(() => {
    clearCache()
    useLocaleStore.setState({ locale: 'en' })
    setFetchPayload({ notifications: [], unreadCount: 0 })
    write(notificationsResource.keyOf(), { notifications: [], unreadCount: 0 })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('matches the header icon button style', () => {
    render(<NotificationBell />)
    const button = screen.getByRole('button', { name: 'Notifications' })
    expect(button.className).toContain('text-text-muted')
    expect(button.className).toContain('hover:bg-bg-tertiary')
    expect(button.querySelector('svg')?.getAttribute('class')).toContain('w-4 h-4')
  })

  it('shows the unread count badge', () => {
    write(notificationsResource.keyOf(), { notifications: [NOTIFICATION], unreadCount: 3 })
    render(<NotificationBell />)
    expect(screen.getByText('3')).toBeDefined()
  })
})

describe('NotificationCenter', () => {
  beforeEach(() => {
    clearCache()
    useLocaleStore.setState({ locale: 'en' })
    notificationsRef.current = { notifications: [NOTIFICATION], unreadCount: 1 }
    setFetchPayload(notificationsRef.current)
    write(notificationsResource.keyOf(), { notifications: [NOTIFICATION], unreadCount: 1 })
    markNotificationsRead.mockReset()
    deleteNotification.mockReset()
    clearNotifications.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  function renderCenter() {
    render(<NotificationCenter trigger={<button type="button">bell</button>} />)
    return userEvent.setup()
  }

  async function openPanel(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'bell' }))
  }

  it('opens on trigger click, lists notifications and marks them all read', async () => {
    const user = renderCenter()
    await openPanel(user)
    expect(screen.getByText('Build finished')).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Mark all as read' }))
    await waitFor(() => expect(markNotificationsRead).toHaveBeenCalledWith())
  })

  it('deletes a single notification and clears all', async () => {
    const user = renderCenter()
    await openPanel(user)
    await user.click(screen.getByRole('button', { name: 'Delete notification' }))
    await waitFor(() => expect(deleteNotification).toHaveBeenCalledWith('n1'))

    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => expect(clearNotifications).toHaveBeenCalled())
  })

  it('marks a single notification read on row click without closing', async () => {
    const user = renderCenter()
    await openPanel(user)
    await user.click(screen.getByText('Build finished'))
    await waitFor(() => expect(markNotificationsRead).toHaveBeenCalledWith('n1'))
    expect(screen.getByText('Build finished')).toBeDefined()
  })

  it('renders the empty state', async () => {
    notificationsRef.current = { notifications: [], unreadCount: 0 }
    setFetchPayload(notificationsRef.current)
    write(notificationsResource.keyOf(), { notifications: [], unreadCount: 0 })
    const user = renderCenter()
    await openPanel(user)
    expect(screen.getByText('No notifications yet')).toBeDefined()
  })

  it('tolerates partial notification data without a notifications field', async () => {
    authFetchMock.mockImplementation(() => Promise.resolve(new Response('{}', { status: 200 })))
    const user = renderCenter()
    await openPanel(user)
    expect(screen.getByText('No notifications yet')).toBeDefined()
  })
})
