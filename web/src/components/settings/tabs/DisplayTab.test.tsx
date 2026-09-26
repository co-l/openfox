/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
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

describe('DisplayTab Composer setting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockSettings).forEach((k) => delete mockSettings[k])
    setLocale('en')
  })

  it('renders the Composer section with the fullscreen toggle', () => {
    render(<DisplayTab />)

    expect(screen.getByText('Composer')).toBeTruthy()
    expect(screen.getByText('Expand composer full-screen on mobile')).toBeTruthy()
  })

  it('persists the fullscreen composer toggle', async () => {
    const user = userEvent.setup()
    render(<DisplayTab />)

    const label = screen.getByText('Expand composer full-screen on mobile').closest('label') as HTMLElement
    const toggle = within(label).getByRole('button')
    await user.click(toggle)

    expect(mockSetSetting).toHaveBeenCalledWith(SETTINGS_KEYS.DISPLAY_MOBILE_FULLSCREEN_COMPOSER, 'true')
  })
})

describe('DisplayTab tool call streaming toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockSettings).forEach((k) => delete mockSettings[k])
    setLocale('en')
  })

  it('renders the live tool call previews toggle off by default', () => {
    render(<DisplayTab />)

    const label = screen.getByText('Show live tool call previews').closest('label') as HTMLElement
    expect(label).toBeTruthy()
    const toggle = within(label).getByRole('button')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('persists turning the live previews toggle on', async () => {
    const user = userEvent.setup()
    render(<DisplayTab />)

    const label = screen.getByText('Show live tool call previews').closest('label') as HTMLElement
    const toggle = within(label).getByRole('button')
    await user.click(toggle)

    expect(mockSetSetting).toHaveBeenCalledWith(SETTINGS_KEYS.DISPLAY_SHOW_TOOL_CALL_STREAMING, 'true')
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
    const modelCheckboxes = checkboxes.filter(
      (c) =>
        c.closest('label')?.textContent?.includes('Collapse providers by default') ||
        c.closest('label')?.textContent?.includes('Collapse favorites by default'),
    )
    expect(modelCheckboxes.length).toBe(2)
    modelCheckboxes.forEach((checkbox) => expect(checkbox.checked).toBe(false))
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

describe('DisplayTab Fullscreen slash commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockSettings).forEach((k) => delete mockSettings[k])
    setLocale('en')
  })

  it('renders fullscreen slash commands toggle with proper description in English', () => {
    render(<DisplayTab />)
    expect(screen.getByText('Fullscreen slash commands view')).toBeTruthy()
    expect(
      screen.getByText('Choose whether the commands view uses default sizing or fills the available screen height.'),
    ).toBeTruthy()
  })

  it('renders fullscreen slash commands toggle with proper description in French', () => {
    setLocale('fr')
    render(<DisplayTab />)
    expect(screen.getByText('Vue plein écran des commandes slash')).toBeTruthy()
    expect(
      screen.getByText(
        'Choisissez si la vue des commandes utilise la taille par défaut ou remplit la hauteur d’écran disponible.',
      ),
    ).toBeTruthy()
  })
})

describe('DisplayTab Danger Level Selector settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockSettings).forEach((k) => delete mockSettings[k])
    setLocale('en')
  })

  it('renders Danger Level Selector settings and allows changing display style', async () => {
    const user = userEvent.setup()
    render(<DisplayTab />)

    expect(screen.getByText('Danger Level Selector')).toBeTruthy()
    expect(screen.getByText('Display style')).toBeTruthy()
    expect(screen.getByText('Auto-switch to list if more than threshold')).toBeTruthy()

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    const dangerStyleSelect = selects.find((s) => s.closest('label')?.textContent?.includes('Display style'))!
    await user.selectOptions(dangerStyleSelect, 'list')

    expect(mockSetSetting).toHaveBeenCalledWith(SETTINGS_KEYS.DISPLAY_DANGER_LEVEL_DISPLAY_MODE, 'list')
  })

  it('toggles auto-switch and displays threshold input', async () => {
    const user = userEvent.setup()
    mockSettings[SETTINGS_KEYS.DISPLAY_DANGER_LEVEL_AUTO_LIST] = 'true'
    mockSettings[SETTINGS_KEYS.DISPLAY_DANGER_LEVEL_AUTO_LIST_THRESHOLD] = '4'
    render(<DisplayTab />)

    expect(screen.getByText('Auto-switch threshold')).toBeTruthy()
    const input = screen.getByDisplayValue('4') as HTMLInputElement
    expect(input).toBeTruthy()

    await user.clear(input)
    await user.type(input, '5')
    fireEvent.blur(input)

    expect(mockSetSetting).toHaveBeenCalledWith(SETTINGS_KEYS.DISPLAY_DANGER_LEVEL_AUTO_LIST_THRESHOLD, '5')
  })
})
