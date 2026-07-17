/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdvancedTab } from './AdvancedTab'
import { SETTINGS_KEYS } from '../../../stores/settings'

vi.mock('wouter', () => ({
  useLocation: () => ['/', vi.fn()],
}))

const mockSettings: Record<string, string> = {}
const mockGetSetting = vi.fn()
const mockSetSetting = vi.fn()

vi.mock('../../stores/settings', () => ({
  SETTINGS_KEYS: {
    DISPLAY_SHOW_OPEN_IN_EDITOR: 'display.showOpenInEditorLinks',
    LLM_DYNAMIC_SYSTEM_PROMPT: 'llm.dynamicSystemPrompt',
    CACHE_WARMING: 'cache.warming',
    RETRY_PATTERNS: 'agent.retryPatterns',
  },
  useSettingsStore: vi.fn((selector) => {
    const state = {
      settings: mockSettings,
      getSetting: mockGetSetting,
      setSetting: mockSetSetting,
    }
    return selector(state)
  }),
}))

vi.mock('../useSettingsStore', () => ({
  useSettingsStoreState: () => ({
    settings: mockSettings,
    getSetting: mockGetSetting,
    setSetting: mockSetSetting,
  }),
}))

describe('AdvancedTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockSettings).forEach((k) => delete mockSettings[k])
  })

  afterEach(cleanup)

  it('renders the Dynamic System Prompt toggle', () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    expect(container.textContent).toContain('Dynamic System Prompt')
  })

  it('renders the Speculative Cache Warming toggle', () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    expect(container.textContent).toContain('Speculative Cache Warming')
  })

  it('renders the Auto-Retry Patterns section', () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    expect(container.textContent).toContain('Auto-Retry Patterns')
  })

  it('renders the Open in VSCode toggle', () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    expect(container.textContent).toContain('Open in VSCode')
  })

  it('renders the Onboarding section', () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    expect(container.textContent).toContain('Onboarding')
  })

  it('does not render search engine section', () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    expect(container.textContent).not.toContain('Search Engine')
  })

  it('toggles Dynamic System Prompt on click', async () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    const toggles = container.querySelectorAll('label')
    const dynamicToggle = Array.from(toggles).find((t) => t.textContent?.includes('Dynamic System Prompt'))
    expect(dynamicToggle).toBeTruthy()
    await userEvent.setup().click(dynamicToggle!)
    expect(mockSetSetting).toHaveBeenCalledWith('llm.dynamicSystemPrompt', 'true')
  })
})

describe('AdvancedTab model cascade cooldowns', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockSettings).forEach((k) => delete mockSettings[k])
    mockSetSetting.mockResolvedValue({ success: true })
  })

  afterEach(cleanup)

  it('loads, displays, and saves both global cooldown settings', async () => {
    mockSettings[SETTINGS_KEYS.MODEL_CASCADE_OVERLOAD_COOLDOWN_MS] = '1200000'
    mockSettings[SETTINGS_KEYS.MODEL_CASCADE_TRANSIENT_COOLDOWN_MS] = '120000'
    render(<AdvancedTab onClose={vi.fn()} />)

    const overload = screen.getByLabelText('Quota / overload (minutes)') as HTMLInputElement
    const transient = screen.getByLabelText('Network / timeout / 5xx (minutes)') as HTMLInputElement
    expect(overload.value).toBe('20')
    expect(transient.value).toBe('2')

    fireEvent.change(overload, { target: { value: '' } })
    fireEvent.change(transient, { target: { value: '' } })
    expect(mockSetSetting).not.toHaveBeenCalled()

    fireEvent.change(overload, { target: { value: '15' } })
    fireEvent.change(transient, { target: { value: '3' } })
    expect(mockSetSetting).not.toHaveBeenCalled()
    fireEvent.blur(overload)
    fireEvent.blur(transient)
    await waitFor(() => {
      expect(mockSetSetting).toHaveBeenCalledWith(SETTINGS_KEYS.MODEL_CASCADE_OVERLOAD_COOLDOWN_MS, '900000')
      expect(mockSetSetting).toHaveBeenCalledWith(SETTINGS_KEYS.MODEL_CASCADE_TRANSIENT_COOLDOWN_MS, '180000')
    })
  })

  it('shows validation feedback for blank or negative cooldowns', async () => {
    mockSettings[SETTINGS_KEYS.MODEL_CASCADE_OVERLOAD_COOLDOWN_MS] = '1200000'
    render(<AdvancedTab onClose={vi.fn()} />)
    const overload = screen.getByLabelText('Quota / overload (minutes)')

    fireEvent.change(overload, { target: { value: '' } })
    fireEvent.blur(overload)
    expect(await screen.findByText('Enter a non-negative number of minutes.')).toBeTruthy()
    expect(mockSetSetting).not.toHaveBeenCalled()

    fireEvent.change(overload, { target: { value: '-1' } })
    fireEvent.blur(overload)
    expect(await screen.findByText('Enter a non-negative number of minutes.')).toBeTruthy()
    expect(mockSetSetting).not.toHaveBeenCalled()
  })

  it('surfaces setting save failures', async () => {
    mockSettings[SETTINGS_KEYS.MODEL_CASCADE_OVERLOAD_COOLDOWN_MS] = '1200000'
    mockSetSetting.mockResolvedValueOnce({ success: false, error: 'Failed to save cooldown' })
    render(<AdvancedTab onClose={vi.fn()} />)
    const overload = screen.getByLabelText('Quota / overload (minutes)')

    fireEvent.change(overload, { target: { value: '15' } })
    fireEvent.blur(overload)

    expect(await screen.findByText('Failed to save cooldown')).toBeTruthy()
  })
})
