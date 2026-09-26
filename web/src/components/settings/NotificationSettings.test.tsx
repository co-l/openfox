/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NotificationSettings } from './NotificationSettings'
import { setLocale } from '@shared/i18n/index.js'
import { useNotificationSettingsStore, DEFAULT_SETTINGS } from '../../stores/notifications'

vi.mock('../../lib/sound', () => ({
  requestNotificationPermission: vi.fn(async () => 'granted'),
}))

vi.mock('../../lib/resources', () => ({
  SETTINGS_KEYS: { NOTIFICATION_SETTINGS: 'notification_settings' },
  settingResource: {
    keyOf: (k: string) => `setting:${k}`,
    fetch: vi.fn(),
    maxAgeMs: 60000,
  },
  setSetting: vi.fn(),
}))

describe('NotificationSettings component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setLocale('en')
    useNotificationSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      loaded: true,
    })
  })

  it('renders plugin notification controls and interval options', () => {
    render(<NotificationSettings />)
    expect(screen.getByText('Plugin Notifications')).toBeTruthy()
    expect(screen.getByText('Plugin update notifications')).toBeTruthy()
    expect(screen.getByText('Check for plugin updates')).toBeTruthy()

    const select = screen.getByLabelText('Check for plugin updates') as HTMLSelectElement
    expect(select.value).toBe('1h')
    const options = Array.from(select.options).map((o) => o.value)
    expect(options).toEqual(['1h', '6h', '24h', 'startup'])
  })

  it('toggles plugin update notifications', async () => {
    const user = userEvent.setup()
    render(<NotificationSettings />)
    const toggle = screen.getByText('Plugin update notifications')
    await user.click(toggle)

    const { settings } = useNotificationSettingsStore.getState()
    expect(settings.pluginUpdateNotificationEnabled).toBe(false)
  })

  it('toggles switch with Space or Enter key', async () => {
    const user = userEvent.setup()
    render(<NotificationSettings />)
    const switchButton = screen.getByRole('switch', { name: 'Plugin update notifications' })
    switchButton.focus()
    await user.keyboard(' ')

    const { settings } = useNotificationSettingsStore.getState()
    expect(settings.pluginUpdateNotificationEnabled).toBe(false)
  })

  it('updates check interval when select changes', async () => {
    const user = userEvent.setup()
    render(<NotificationSettings />)
    const select = screen.getByLabelText('Check for plugin updates') as HTMLSelectElement
    await user.selectOptions(select, '6h')

    const { settings } = useNotificationSettingsStore.getState()
    expect(settings.pluginUpdateCheckInterval).toBe('6h')
  })
})
