/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdvancedTab } from './AdvancedTab'

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
