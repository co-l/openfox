/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DisplayTab } from './DisplayTab'
import { setLocale } from '@shared/i18n/index.js'
import { SETTINGS_KEYS } from '../../../lib/resources'

vi.mock('wouter', () => ({
  useLocation: () => ['/', vi.fn()],
}))

const { mockSettings, mockSetSetting } = vi.hoisted(() => ({
  mockSettings: {} as Record<string, string>,
  mockSetSetting: vi.fn(),
}))

vi.mock('../../../hooks/useSetting', () => ({
  useSetting: (key: string, fallback = '') => ({ value: mockSettings[key] ?? fallback, loading: false }),
}))

vi.mock('../../../lib/resources', async (importOriginal) => ({
  ...(await importOriginal()),
  setSetting: mockSetSetting,
}))

vi.mock('../../../lib/fonts', async (importOriginal) => ({
  ...(await importOriginal()),
  detectAvailableFonts: () => ['JetBrains Mono'],
  resolveDefaultFamily: () => 'JetBrains Mono',
}))

describe('DisplayTab Language setting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockSettings).forEach((k) => delete mockSettings[k])
    setLocale('en')
  })

  it('renders the Language section', () => {
    render(<DisplayTab />)
    expect(screen.getByText('Language')).toBeTruthy()
    expect(screen.getByLabelText('Language')).toBeTruthy()
  })

  it('shows the three language options', () => {
    render(<DisplayTab />)
    const select = screen.getByLabelText('Language') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['automatic', 'en', 'fr'])
  })

  it('persists the chosen locale and applies it', async () => {
    const user = userEvent.setup()
    render(<DisplayTab />)
    const select = screen.getByLabelText('Language') as HTMLSelectElement
    await user.selectOptions(select, 'fr')
    expect(mockSetSetting).toHaveBeenCalledWith('display.locale', 'fr')
  })
})

describe('DisplayTab Model Selector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockSettings).forEach((k) => delete mockSettings[k])
    setLocale('en')
  })

  it('renders the Model Selector section with height select and collapse checkboxes', () => {
    render(<DisplayTab />)

    expect(screen.getByText('Model Selector')).toBeTruthy()
    expect(screen.getByText('Dropdown size')).toBeTruthy()
    expect(screen.getByText('Collapse providers by default')).toBeTruthy()
    expect(screen.getByText('Collapse favorites by default')).toBeTruthy()

    const select = screen.getByDisplayValue('Default') as HTMLSelectElement
    expect(select.value).toBe('default')

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(checkboxes.length).toBe(2)
    checkboxes.forEach((checkbox) => expect(checkbox.checked).toBe(false))
  })

  it('updates the dropdown size setting when changed', async () => {
    const user = userEvent.setup()
    render(<DisplayTab />)

    const select = screen.getByDisplayValue('Default') as HTMLSelectElement
    await user.selectOptions(select, 'full_height')

    expect(mockSetSetting).toHaveBeenCalledWith(SETTINGS_KEYS.DISPLAY_MODEL_SELECTOR_HEIGHT, 'full_height')
  })

  it('updates the collapse providers setting when checkbox is toggled', async () => {
    const user = userEvent.setup()
    render(<DisplayTab />)

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    const collapseProviders = checkboxes.find((c) =>
      c.closest('label')?.textContent?.includes('Collapse providers by default'),
    )!
    await user.click(collapseProviders)

    expect(mockSetSetting).toHaveBeenCalledWith(SETTINGS_KEYS.DISPLAY_COLLAPSE_PROVIDERS_BY_DEFAULT, 'true')
  })

  it('updates the collapse favorites setting when checkbox is toggled', async () => {
    const user = userEvent.setup()
    render(<DisplayTab />)

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    const collapseFavorites = checkboxes.find((c) =>
      c.closest('label')?.textContent?.includes('Collapse favorites by default'),
    )!
    await user.click(collapseFavorites)

    expect(mockSetSetting).toHaveBeenCalledWith(SETTINGS_KEYS.DISPLAY_COLLAPSE_FAVORITES_BY_DEFAULT, 'true')
  })
})
