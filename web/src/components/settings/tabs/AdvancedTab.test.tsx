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

vi.mock('../../../hooks/useAgents', () => ({
  useAgents: () => ({ agents: [], refresh: vi.fn() }),
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

  it('renders the Caveman thinking toggle and persists it', async () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    const toggles = container.querySelectorAll('label')
    const cavemanToggle = Array.from(toggles).find((t) => t.textContent?.includes('Caveman thinking'))
    expect(cavemanToggle).toBeTruthy()
    await userEvent.setup().click(cavemanToggle!)
    expect(mockSetSetting).toHaveBeenCalledWith('llm.cavemanThinking', 'true')
  })

  it('renders the auto-continue-on-boot toggle and persists it', async () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    const toggles = container.querySelectorAll('label')
    const toggle = Array.from(toggles).find((t) => t.textContent?.includes('Auto-continue on boot'))
    expect(toggle).toBeTruthy()
    await userEvent.setup().click(toggle!)
    expect(mockSetSetting).toHaveBeenCalledWith('agent.autoContinueOnBoot', 'true')
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

  it('renders the HTTP Proxy input', () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    expect(container.textContent).toContain('HTTP Proxy')
    expect(container.textContent).toContain('Proxy server all OpenFox network requests')
  })

  it('renders the HTTP Proxy section', () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    expect(container.textContent).toContain('HTTP Proxy')
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
