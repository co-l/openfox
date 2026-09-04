// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillInfo } from '../../lib/skills-actions'
import { useSessionStore } from '../../stores/session/store'
import { clearCache } from '../../lib/resourceCache'
import { skillsResource } from '../../lib/resources'
import { authFetch } from '../../lib/api'
import { SkillsContent } from './SkillsModal'
import { setLocale } from '@shared/i18n/index.js'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../lib/api', () => ({
  authFetch: vi.fn(),
}))

const { mockToggleSkill, mockDeleteSkill } = vi.hoisted(() => ({
  mockToggleSkill: vi.fn(),
  mockDeleteSkill: vi.fn(async () => ({ success: true })),
}))

vi.mock('../../lib/skills-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/skills-actions')>()
  return { ...actual, toggleSkill: mockToggleSkill, deleteSkill: mockDeleteSkill }
})

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

function seedSkills(workdir?: string) {
  vi.mocked(authFetch).mockImplementation(async (url: string) => {
    if (url === `/api/skills${workdir ? `?workdir=${encodeURIComponent(workdir)}` : ''}`) {
      return {
        ok: true,
        json: async () => ({
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
        }),
      } as unknown as Response
    }
    return { ok: true, json: async () => ({}) } as unknown as Response
  })
}

describe('SkillsContent', () => {
  afterEach(cleanup)

  beforeEach(async () => {
    vi.clearAllMocks()
    clearCache()
    setLocale('en')
    useSessionStore.setState({ currentSession: null })
    seedSkills()
    await skillsResource.refresh()
  })

  it('shows activation next to delete and toggles the skill', () => {
    render(<SkillsContent isOpen={false} />)

    const activation = screen.getByRole('switch', { name: 'Activation for My Skill' })
    const deleteButton = screen.getByTitle('Delete')
    expect(activation.getAttribute('aria-checked')).toBe('false')
    expect(activation.parentElement).toBe(deleteButton.parentElement)
    expect(activation.parentElement?.lastElementChild).toBe(activation)

    fireEvent.click(activation)
    expect(mockToggleSkill).toHaveBeenCalledWith('my-skill', undefined)
  })

  it('requires modal confirmation before deleting the full skill folder', async () => {
    render(<SkillsContent isOpen={false} />)
    const deleteBtn = screen.getByRole('button', { name: /delete/i })
    fireEvent.click(deleteBtn)

    expect(screen.getByText('This skill files will be deleted.')).toBeTruthy()
    expect(screen.getByText('The full skill folder and all its contents will be removed.')).toBeTruthy()
    expect(mockDeleteSkill).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete skill' }))
    await vi.waitFor(() => expect(mockDeleteSkill).toHaveBeenCalledWith('my-skill', undefined))
  })

  it('loads skills scoped to the session project workdir even when a workspace is active', async () => {
    useSessionStore.setState({
      currentSession: {
        id: 's1',
        projectId: 'p1',
        workdir: '/original/project',
        workspace: '/workspaces/openfox/review-branch',
        mode: 'planner',
        phase: 'plan',
        isRunning: false,
      } as any,
    })

    render(<SkillsContent isOpen={true} />)

    await waitFor(() => {
      expect(authFetch).toHaveBeenCalledWith('/api/skills?workdir=%2Foriginal%2Fproject')
    })
  })

  it('renders skills in subdirectories under collapsed-by-default collapsible sections and supports folder toggle', async () => {
    const nestedSkill1: SkillInfo = {
      id: 'nested-1',
      name: 'Nested Skill 1',
      description: 'Nested 1',
      version: '1',
      enabled: false,
      group: 'dev-tools',
      estimatedTokens: 120,
      source: 'global-openfox',
      path: '/tmp/skills/dev-tools/nested-1/SKILL.md',
      legacy: false,
      readOnly: false,
      warnings: [],
    }
    const nestedSkill2: SkillInfo = {
      id: 'nested-2',
      name: 'Nested Skill 2',
      description: 'Nested 2',
      version: '1',
      enabled: false,
      group: 'dev-tools',
      estimatedTokens: 80,
      source: 'global-openfox',
      path: '/tmp/skills/dev-tools/nested-2/SKILL.md',
      legacy: false,
      readOnly: false,
      warnings: [],
    }
    vi.mocked(authFetch).mockImplementation(
      async () =>
        ({
          ok: true,
          json: async () => ({
            defaults: [],
            userItems: [{ ...skill, estimatedTokens: 50 }, nestedSkill1, nestedSkill2],
            projectItems: [],
            items: [{ ...skill, estimatedTokens: 50 }, nestedSkill1, nestedSkill2],
            selectedDirectory: null,
            diagnostics: [],
          }),
        }) as unknown as Response,
    )
    await skillsResource.refresh()

    render(<SkillsContent isOpen={false} />)

    await waitFor(() => {
      expect(screen.getByText('My Skill')).toBeTruthy()
    })

    // Regular skill is rendered directly with its tokens
    expect(screen.getByText(/50\s+tokens/)).toBeTruthy()

    // Subdirectory card header is rendered with name, skill count and total tokens
    expect(screen.getByText('dev-tools')).toBeTruthy()
    expect(screen.getByText('(2 skills)')).toBeTruthy()
    expect(screen.getByText(/200\s+tokens/)).toBeTruthy()

    // Nested skills are collapsed by default
    expect(screen.queryByText('Nested Skill 1')).toBeNull()

    // Expanding the group shows nested skills with their individual tokens
    fireEvent.click(screen.getByText('dev-tools'))
    expect(screen.getByText('Nested Skill 1')).toBeTruthy()
    expect(screen.getByText(/120\s+tokens/)).toBeTruthy()
    expect(screen.getByText('Nested Skill 2')).toBeTruthy()
    expect(screen.getByText(/80\s+tokens/)).toBeTruthy()

    // Folder-level toggle activates all skills in the folder
    const folderToggle = screen.getByRole('switch', { name: 'Toggle all skills in dev-tools' })
    expect(folderToggle.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(folderToggle)
    expect(mockToggleSkill).toHaveBeenCalledWith('nested-1', undefined)
    expect(mockToggleSkill).toHaveBeenCalledWith('nested-2', undefined)
  })
})
