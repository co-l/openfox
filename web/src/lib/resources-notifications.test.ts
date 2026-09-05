import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authFetch } from './api'
import { clearCache, snapshot } from './resourceCache'
import { notificationsResource, readNotifications } from './resources'
import type { Notification } from '@shared/types.js'

vi.mock('./api', () => ({
  authFetch: vi.fn(),
}))

function jsonResponse(data: unknown): Response {
  return { ok: true, json: () => Promise.resolve(data) } as unknown as Response
}

const mockNotif: Notification = {
  id: 'n1',
  title: 'Test',
  body: 'Hello',
  source: 'system',
  read: false,
  createdAt: '2026-09-04T00:00:00.000Z',
}

describe('notificationsResource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCache()
  })

  it('uses a single global key', () => {
    expect(notificationsResource.keyOf()).toBe('notifications:list')
  })

  it('fetches notifications from the endpoint', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({ notifications: [mockNotif] }))
    const data = await notificationsResource.refresh()
    expect(authFetch).toHaveBeenCalledWith('/api/notifications')
    expect(data).toEqual([mockNotif])
    expect(readNotifications()).toEqual([mockNotif])
  })

  it('handles empty notifications response', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({}))
    const data = await notificationsResource.refresh()
    expect(data).toEqual([])
  })

  it('WS write-through replaces cached payload without fetching', async () => {
    vi.mocked(authFetch).mockResolvedValue(jsonResponse({ notifications: [mockNotif] }))
    await notificationsResource.refresh()
    expect(authFetch).toHaveBeenCalledTimes(1)

    const updated = [{ ...mockNotif, read: true }]
    notificationsResource.write(updated)
    expect(snapshot('notifications:list').data).toEqual(updated)
    expect(readNotifications()).toEqual(updated)
    expect(authFetch).toHaveBeenCalledTimes(1)
  })
})
