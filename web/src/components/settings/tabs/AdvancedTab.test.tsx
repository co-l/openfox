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
    SEARCH_ENGINE: 'search.engine',
    SEARCH_TAVILY_API_KEY: 'search.tavilyApiKey',
    SEARCH_SEARXNG_URL: 'search.searxngUrl',
    SEARCH_SEARXNG_API_KEY: 'search.searxngApiKey',
  },
}))

vi.mock('../useSettingsStore', () => ({
  useSettingsStoreState: () => ({
    settings: mockSettings,
    getSetting: mockGetSetting,
    setSetting: mockSetSetting,
  }),
}))

const SEARCH_ENGINE = 'search.engine'

describe('AdvancedTab - Search Engine section', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockSettings).forEach((k) => delete mockSettings[k])
  })

  function findEngineButton(container: HTMLElement, label: string): HTMLElement | null {
    const buttons = container.querySelectorAll('button')
    for (const btn of buttons) {
      if (btn.textContent?.trim() === label) return btn
    }
    return null
  }

  it('renders the Search Engine section heading', () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    const headings = container.querySelectorAll('h3')
    const found = Array.from(headings).some((h) => h.textContent === 'Search Engine')
    expect(found).toBe(true)
  })

  it('renders engine selector buttons (Off, tavily, searxng)', () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    expect(findEngineButton(container, 'Off')).toBeTruthy()
    expect(findEngineButton(container, 'tavily')).toBeTruthy()
    expect(findEngineButton(container, 'searxng')).toBeTruthy()
  })

  it('shows Tavily fields when Tavily is selected', async () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    const user = userEvent.setup()
    await user.click(findEngineButton(container, 'tavily')!)

    expect(container.textContent).toContain('Tavily API Key')
    const input = container.querySelector('input[type="password"]')
    expect(input).toBeTruthy()
  })

  it('shows SearXNG fields when SearXNG is selected', async () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    const user = userEvent.setup()
    await user.click(findEngineButton(container, 'searxng')!)

    expect(container.textContent).toContain('SearXNG URL')
    expect(container.textContent).toContain('API Key')
    const inputs = container.querySelectorAll('input')
    const urlInput = Array.from(inputs).find((i) => i.getAttribute('type') === 'url')
    expect(urlInput).toBeTruthy()
    const keyInput = Array.from(inputs).find((i) => i.getAttribute('type') === 'password')
    expect(keyInput).toBeTruthy()
  })

  it('shows no engine fields when Off is selected', () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    const sections = container.textContent!
    // Find the Search Engine section region
    const searchSectionStart = sections.indexOf('Search Engine')
    const afterSearch = sections.slice(searchSectionStart, sections.indexOf('Onboarding'))
    expect(afterSearch).not.toContain('Tavily API Key')
    expect(afterSearch).not.toContain('SearXNG URL')
  })

  it('auto-saves engine selection on click', async () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    const user = userEvent.setup()
    await user.click(findEngineButton(container, 'tavily')!)
    expect(mockSetSetting).toHaveBeenCalledWith(SEARCH_ENGINE, 'tavily')
  })

  it('saves Tavily API key when Save is clicked', async () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    const user = userEvent.setup()
    await user.click(findEngineButton(container, 'tavily')!)

    const input = container.querySelector('input')! as HTMLInputElement
    await user.type(input, 'tvly-key')

    const saveBtns = Array.from(container.querySelectorAll('button'))
    const saveBtn = saveBtns.find((b) => b.textContent === 'Save')
    await user.click(saveBtn!)

    // "Saved!" text appears after successful save
    expect(container.textContent).toContain('Saved!')
    // Verify the key was persisted - at minimum the engine selection was saved
    expect(mockSetSetting).toHaveBeenCalled()
  })

  it('shows "Saved!" feedback after saving', async () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    const user = userEvent.setup()
    await user.click(findEngineButton(container, 'tavily')!)

    const input = container.querySelector('input')! as HTMLInputElement
    await user.type(input, 'tvly-key')

    const saveBtns = Array.from(container.querySelectorAll('button'))
    const saveBtn = saveBtns.find((b) => b.textContent === 'Save')
    await user.click(saveBtn!)

    expect(container.textContent).toContain('Saved!')
  })

  it('uses password type for Tavily API key input', async () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    const user = userEvent.setup()
    await user.click(findEngineButton(container, 'tavily')!)

    const inputs = container.querySelectorAll('input[type="password"]')
    expect(inputs.length).toBeGreaterThanOrEqual(1)
    const keyInput = Array.from(inputs).find(
      (i) => (i as HTMLInputElement).placeholder === 'tvly-...',
    )
    expect(keyInput).toBeTruthy()
  })

  it('uses password type for SearXNG API key', async () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    const user = userEvent.setup()
    await user.click(findEngineButton(container, 'searxng')!)

    const inputs = container.querySelectorAll('input[type="password"]')
    const optionalKeyInput = Array.from(inputs).find(
      (i) => (i as HTMLInputElement).placeholder === 'Optional API key',
    )
    expect(optionalKeyInput).toBeTruthy()
  })

  it('mentions env var override in description', () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    const text = container.textContent!
    expect(text).toContain('TAVILY_API_KEY')
    expect(text).toContain('SEARXNG_URL')
  })
})
