// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NotificationToasts } from './NotificationToasts'
import { useNotificationToastsStore } from '../../stores/notificationToasts'
import { setLocale } from '@shared/i18n/index.js'

describe('NotificationToasts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setLocale('en')
    useNotificationToastsStore.setState({ toasts: [] })
  })

  it('renders nothing when there are no toasts', () => {
    const { container } = render(<NotificationToasts />)
    expect(container.firstChild).toBeNull()
  })

  it('renders toasts and dismisses on click', () => {
    useNotificationToastsStore.setState({
      toasts: [
        {
          id: 't1',
          title: 'Toast Title',
          body: 'Toast Body',
          source: 'plugin',
          createdAt: '',
        },
      ],
    })

    render(<NotificationToasts />)
    expect(screen.getByText('Toast Title')).toBeDefined()
    expect(screen.getByText('Toast Body')).toBeDefined()

    const dismissBtn = screen.getByRole('button', { name: 'Dismiss notification' })
    fireEvent.click(dismissBtn)

    expect(useNotificationToastsStore.getState().toasts).toHaveLength(0)
  })
})
