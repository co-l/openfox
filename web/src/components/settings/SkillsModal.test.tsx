// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSkillsStore, type SkillInfo } from '../../stores/skills'
import { SkillsContent } from './SkillsModal'

const skill: SkillInfo = {
  id: 'my-skill',
  name: 'My Skill',
  description: 'Test skill',
  version: '1',
  enabled: false,
  source: 'global-openfox',
  path: '/tmp/skills/my-skill/SKILL.md',
  legacy: false,
  readOnly: false,
  warnings: [],
}

describe('SkillsContent', () => {
  afterEach(cleanup)

  beforeEach(() => {
    useSkillsStore.setState({
      defaults: [],
      userItems: [skill],
      projectItems: [],
      items: [skill],
      selectedDirectory: {
        configuredPath: '/tmp/skills',
        resolvedPath: '/tmp/skills',
        available: true,
        custom: false,
      },
      diagnostics: [],
      loading: false,
    })
  })

  it('shows activation next to delete and toggles the skill', () => {
    const toggleSkill = vi.fn()
    useSkillsStore.setState({ toggleSkill })

    render(<SkillsContent isOpen={false} />)

    const activation = screen.getByRole('switch', { name: 'Activation for My Skill' })
    const deleteButton = screen.getByTitle('Delete')
    expect(activation.getAttribute('aria-checked')).toBe('false')
    expect(activation.parentElement).toBe(deleteButton.parentElement)
    expect(activation.parentElement?.lastElementChild).toBe(activation)

    fireEvent.click(activation)
    expect(toggleSkill).toHaveBeenCalledWith('my-skill')
  })

  it('requires modal confirmation before deleting the full skill folder', async () => {
    const deleteSkill = vi.fn(async () => ({ success: true }))
    const fetchSkills = vi.fn(async () => undefined)
    useSkillsStore.setState({ deleteSkill, fetchSkills })

    render(<SkillsContent isOpen={false} />)
    fireEvent.click(screen.getByTitle('Delete'))

    expect(screen.getByText('This skill files will be deleted.')).toBeTruthy()
    expect(screen.getByText('The full skill folder and all its contents will be removed.')).toBeTruthy()
    expect(deleteSkill).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete skill' }))
    await vi.waitFor(() => expect(deleteSkill).toHaveBeenCalledWith('my-skill'))
    expect(fetchSkills).toHaveBeenCalled()
  })
})
