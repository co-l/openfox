import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useNotificationToastsStore } from './notificationToasts'

describe('notificationToasts store', () => {
  beforeEach(() => {
    vi.useRealTimers()
    useNotificationToastsStore.setState({ toasts: [] })
  })

  it('pushes and auto-dismisses toasts after 5 seconds', () => {
    vi.useFakeTimers()
    useNotificationToastsStore.getState().pushToast({
      id: 't1',
      title: 'Toast 1',
      body: 'Message 1',
      source: 'plugin',
      createdAt: '',
    })
    expect(useNotificationToastsStore.getState().toasts).toHaveLength(1)

    vi.advanceTimersByTime(5000)
    expect(useNotificationToastsStore.getState().toasts).toHaveLength(0)
  })

  it('manually dismisses a toast', () => {
    useNotificationToastsStore.getState().pushToast({
      id: 't1',
      title: 'Toast 1',
      body: 'Message 1',
      source: 'plugin',
      createdAt: '',
    })
    useNotificationToastsStore.getState().dismissToast('t1')
    expect(useNotificationToastsStore.getState().toasts).toHaveLength(0)
  })

  it('clears all toasts', () => {
    useNotificationToastsStore.getState().pushToast({
      id: 't1',
      title: 'Toast 1',
      body: 'Message 1',
      source: 'plugin',
      createdAt: '',
    })
    useNotificationToastsStore.getState().pushToast({
      id: 't2',
      title: 'Toast 2',
      body: 'Message 2',
      source: 'plugin',
      createdAt: '',
    })
    useNotificationToastsStore.getState().clearToasts()
    expect(useNotificationToastsStore.getState().toasts).toHaveLength(0)
  })
})
