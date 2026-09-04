// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCache } from '../lib/resourceCache'
import { notificationsResource } from '../lib/resources'
import {
  useNotifications,
  deleteNotification,
  clearAllNotifications,
  markAllNotificationsRead,
} from './useNotifications'
import type { Notification } from '@shared/types.js'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { authFetchMock } = vi.hoisted(() => ({
  authFetchMock: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  authFetch: authFetchMock,
}))

function jsonResponse(data: unknown): Response {
  return { ok: true, json: () => Promise.resolve(data) } as unknown as Response
}

const mockNotif1: Notification = {
  id: 'n1',
  title: 'Test 1',
  body: 'Body 1',
  source: 'system',
  read: false,
  createdAt: '2026-09-04T00:00:00.000Z',
}

const mockNotif2: Notification = {
  id: 'n2',
  title: 'Test 2',
  body: 'Body 2',
  source: 'plugin',
  read: true,
  createdAt: '2026-09-04T01:00:00.000Z',
}

describe('useNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCache()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads notifications and calculates unreadCount', async () => {
    authFetchMock.mockResolvedValue(jsonResponse({ notifications: [mockNotif1, mockNotif2] }))
    const { result } = renderHook(() => useNotifications())

    expect(result.current.loading).toBe(true)
    expect(result.current.notifications).toEqual([])
    expect(result.current.unreadCount).toBe(0)

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.notifications).toEqual([mockNotif1, mockNotif2])
    expect(result.current.unreadCount).toBe(1)
  })

  it('deletes a notification and updates cache', async () => {
    notificationsResource.write([mockNotif1, mockNotif2])
    authFetchMock.mockResolvedValue(jsonResponse({}))

    const { result } = renderHook(() => useNotifications())
    expect(result.current.notifications).toHaveLength(2)

    await act(async () => {
      await deleteNotification('n1')
    })

    expect(authFetchMock).toHaveBeenCalledWith('/api/notifications/n1', { method: 'DELETE' })
    expect(result.current.notifications).toEqual([mockNotif2])
    expect(result.current.unreadCount).toBe(0)
  })

  it('clears all notifications', async () => {
    notificationsResource.write([mockNotif1, mockNotif2])
    authFetchMock.mockResolvedValue(jsonResponse({}))

    const { result } = renderHook(() => useNotifications())
    expect(result.current.notifications).toHaveLength(2)

    await act(async () => {
      await clearAllNotifications()
    })

    expect(authFetchMock).toHaveBeenCalledWith('/api/notifications', { method: 'DELETE' })
    expect(result.current.notifications).toEqual([])
    expect(result.current.unreadCount).toBe(0)
  })

  it('marks all notifications read', async () => {
    notificationsResource.write([mockNotif1, mockNotif2])
    authFetchMock.mockResolvedValue(jsonResponse({}))

    const { result } = renderHook(() => useNotifications())
    expect(result.current.unreadCount).toBe(1)

    await act(async () => {
      await markAllNotificationsRead()
    })

    expect(authFetchMock).toHaveBeenCalledWith('/api/notifications/read-all', { method: 'POST' })
    expect(result.current.unreadCount).toBe(0)
    expect(result.current.notifications.every((n) => n.read)).toBe(true)
  })
})
