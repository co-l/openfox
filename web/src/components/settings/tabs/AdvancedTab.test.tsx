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

const { mockWorkflows } = vi.hoisted(() => ({
  mockWorkflows: [] as Array<{ id: string; name: string; scope: 'builtin' | 'user' | 'project' }>,
}))

vi.mock('../../../hooks/useWorkflows', () => ({
  useWorkflows: () => ({ workflows: mockWorkflows, refresh: vi.fn() }),
}))

describe('AdvancedTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockSettings).forEach((k) => delete mockSettings[k])
    mockWorkflows.splice(
      0,
      mockWorkflows.length,
      { id: 'build-verify', name: 'Build & Verify', scope: 'builtin' },
      { id: 'autonomous-build', name: 'Autonomous build', scope: 'user' },
      { id: 'local-flow', name: 'Local flow', scope: 'project' },
    )
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

  it('renders the HTTP Proxy input', () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    expect(container.textContent).toContain('HTTP Proxy')
    expect(container.textContent).toContain('Proxy server all OpenFox network requests')
  })

  it('renders the HTTP Proxy section', () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    expect(container.textContent).toContain('HTTP Proxy')
  })

  it('lists only global-scope workflows in the Favorite Workflow select', () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    const select = container.querySelector('select#global-favorite-workflow') as HTMLSelectElement | null
    const favoriteSelect =
      select ??
      Array.from(container.querySelectorAll('select')).find((s) =>
        Array.from(s.options).some((o) => o.textContent?.includes('Build & Verify')),
      )!
    const optionTexts = Array.from(favoriteSelect.options).map((o) => o.textContent ?? '')
    expect(optionTexts.some((t) => t.includes('Build & Verify'))).toBe(true)
    expect(optionTexts.some((t) => t.includes('Autonomous build'))).toBe(true)
    expect(optionTexts.some((t) => t.includes('Local flow'))).toBe(false)
  })

  it('renders the Auto-answer agent questions toggle and writes the setting', async () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    expect(container.textContent).toContain('Auto-answer agent questions')
    const toggle = Array.from(container.querySelectorAll('label')).find((l) =>
      l.textContent?.includes('Auto-answer agent questions'),
    )
    expect(toggle).toBeTruthy()
    await userEvent.setup().click(toggle!)
    expect(mockSetSetting).toHaveBeenCalledWith('agent.autoAnswerQuestions', 'true')
  })

  it('hides the automatic actions timeout when neither auto behavior is configured', () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    expect(container.textContent).not.toContain('Automatic actions timeout')
  })

  it('shows the automatic actions timeout once auto-answer is on and writes the setting', async () => {
    mockSettings['agent.autoAnswerQuestions'] = 'true'
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    expect(container.textContent).toContain('Automatic actions timeout')
    const input = container.querySelector('#auto-action-timeout') as HTMLInputElement
    expect(input).toBeTruthy()
    await userEvent.setup().clear(input)
    await userEvent.setup().type(input, '45')
    expect(mockSetSetting).toHaveBeenCalledWith('agent.autoActionTimeoutSeconds', '45')
  })

  it('shows the timeout when only a favorite workflow is set', () => {
    mockSettings['workflow.favoriteWorkflow'] = 'build-verify'
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    expect(container.textContent).toContain('Automatic actions timeout')
  })

  it('mentions local workflows in the favorite workflow description', () => {
    const { container } = render(<AdvancedTab onClose={vi.fn()} />)
    expect(container.textContent).toContain('Local workflows can only be picked at project level')
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
