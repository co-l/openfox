import { describe, expect, it, vi, beforeEach } from 'vitest'
import { formatSkillPrompt, loadSkillTool } from './load-skill.js'
import type { SkillDefinition } from '../skills/types.js'

vi.mock('../skills/registry.js', () => ({
  loadAllSkills: vi.fn(),
  findSkillById: vi.fn(),
  isSkillEnabled: vi.fn(),
}))

vi.mock('../runtime-config.js', () => ({
  getRuntimeConfig: vi.fn().mockReturnValue({
    mode: 'test',
    workdir: '/global-server-workdir',
  }),
}))

vi.mock('../../cli/paths.js', () => ({
  getGlobalConfigDir: vi.fn().mockReturnValue('/test/config'),
}))

import { loadAllSkills, findSkillById, isSkillEnabled } from '../skills/registry.js'
import type { ToolContext } from './types.js'

const metadata = { id: 'test', name: 'Test', description: 'Test', version: '' }

function makeContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    workdir: '/session/project',
    sessionId: 'test-session',
    sessionManager: { requireSession: vi.fn() } as any,
    ...overrides,
  }
}

describe('formatSkillPrompt', () => {
  it('keeps legacy output byte-for-byte compatible', () => {
    const skill: SkillDefinition = { metadata, prompt: 'Legacy instructions.', legacy: true }
    expect(formatSkillPrompt(skill)).toBe('Legacy instructions.')
  })

  it('provides portable package directory for relative references', () => {
    const skill: SkillDefinition = {
      metadata,
      prompt: 'Run scripts/check.sh.',
      legacy: false,
      directory: '/shared skills/test',
    }
    expect(formatSkillPrompt(skill)).toBe(
      'Skill package directory: /shared skills/test\nResolve relative paths in these instructions from that directory.\n\nRun scripts/check.sh.',
    )
  })
})

describe('load_skill handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes session workdir to loadAllSkills instead of global server workdir', async () => {
    vi.mocked(isSkillEnabled).mockReturnValueOnce(true)
    vi.mocked(loadAllSkills).mockResolvedValueOnce([])
    vi.mocked(findSkillById).mockReturnValueOnce(undefined)

    const ctx = makeContext({ workdir: '/my/project' })

    await loadSkillTool.execute({ skillId: 'nonexistent' }, ctx)

    expect(loadAllSkills).toHaveBeenCalledWith('/test/config', '/my/project')
    expect(loadAllSkills).not.toHaveBeenCalledWith('/test/config', '/global-server-workdir')
  })

  it('finds a skill loaded from session workdir', async () => {
    const skill: SkillDefinition = {
      metadata: { id: 'proj-skill', name: 'Project Skill', description: 'A project skill', version: '1.0' },
      prompt: 'Do project things.',
      legacy: false,
      directory: '/my/project/.openfox/skills/proj-skill',
    }

    vi.mocked(isSkillEnabled).mockReturnValueOnce(true)
    vi.mocked(loadAllSkills).mockResolvedValueOnce([skill])
    vi.mocked(findSkillById).mockImplementation((id: string, skills: SkillDefinition[]) =>
      skills.find((s) => s.metadata.id === id),
    )

    const ctx = makeContext({ workdir: '/my/project' })

    const result = await loadSkillTool.execute({ skillId: 'proj-skill' }, ctx)

    expect(result.success).toBe(true)
    expect(result.output).toContain('Do project things.')
    expect(loadAllSkills).toHaveBeenCalledWith('/test/config', '/my/project')
  })
})
