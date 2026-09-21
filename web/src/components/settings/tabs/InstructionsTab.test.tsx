/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InstructionsTab } from './InstructionsTab'

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

describe('InstructionsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockSettings).forEach((k) => delete mockSettings[k])
  })

  it('renders the Language section before Global Instructions', () => {
    const { container } = render(<InstructionsTab />)
    const text = container.textContent ?? ''
    expect(text).toContain('Language')
    expect(text).toContain('In what language should the agent talk to you?')
    expect(text.indexOf('Language')).toBeLessThan(text.indexOf('Global Instructions'))
  })

  it('defaults the language select to Automatic', () => {
    render(<InstructionsTab />)
    expect(screen.getByRole('combobox')).toHaveValue('automatic')
  })

  it('restores a saved preset language on load', () => {
    mockSettings['agent.language'] = 'French'
    render(<InstructionsTab />)
    expect(screen.getByRole('combobox')).toHaveValue('french')
  })

  it('saves a preset language on Save', async () => {
    const user = userEvent.setup()
    render(<InstructionsTab />)
    await user.selectOptions(screen.getByRole('combobox'), 'french')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(mockSetSetting).toHaveBeenCalledWith('agent.language', 'French')
  })

  it('shows the custom language input when Other is selected', async () => {
    const user = userEvent.setup()
    render(<InstructionsTab />)
    expect(screen.queryByPlaceholderText(/German/)).toBeNull()
    await user.selectOptions(screen.getByRole('combobox'), 'other')
    expect(screen.getByPlaceholderText(/German/)).toBeTruthy()
  })

  it('saves the custom language when Other is selected', async () => {
    const user = userEvent.setup()
    render(<InstructionsTab />)
    await user.selectOptions(screen.getByRole('combobox'), 'other')
    await user.type(screen.getByPlaceholderText(/German/), 'German')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(mockSetSetting).toHaveBeenCalledWith('agent.language', 'German')
  })

  it('restores a saved custom language on load', () => {
    mockSettings['agent.language'] = 'German'
    render(<InstructionsTab />)
    expect(screen.getByRole('combobox')).toHaveValue('other')
    expect(screen.getByPlaceholderText(/German/)).toHaveValue('German')
  })

  it('keeps Save disabled when Other is selected with an empty field', async () => {
    mockSettings['agent.language'] = 'French'
    const user = userEvent.setup()
    render(<InstructionsTab />)
    await user.selectOptions(screen.getByRole('combobox'), 'other')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('normalizes a lowercase preset name typed via Other on save', async () => {
    const user = userEvent.setup()
    render(<InstructionsTab />)
    await user.selectOptions(screen.getByRole('combobox'), 'other')
    await user.type(screen.getByPlaceholderText(/German/), 'french')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(mockSetSetting).toHaveBeenCalledWith('agent.language', 'French')
  })
})
