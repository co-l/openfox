/**
 * Skill Registry Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir, realpath, readFile, symlink } from 'node:fs/promises'
import { symlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { SkillDefinition } from './types.js'

/** Symlink creation needs a privilege/Developer Mode on Windows — probe once. */
const CAN_SYMLINK = (() => {
  if (process.platform !== 'win32') return true
  const probe = join(tmpdir(), `skill-symlink-probe-${process.pid}`)
  try {
    symlinkSync('probe-target', probe, 'file')
    rmSync(probe)
    return true
  } catch {
    return false
  }
})()

vi.mock('../db/settings.js', () => {
  const store = new Map<string, string>()
  return {
    getSetting: (key: string) => store.get(key) ?? null,
    setSetting: (key: string, value: string) => {
      store.set(key, value)
    },
    deleteSetting: (key: string) => {
      store.delete(key)
    },
    __store: store,
  }
})

import {
  loadAllSkills,
  loadAllSkillsWithDiagnostics,
  loadDefaultSkills,
  loadUserSkills,
  loadProjectSkills,
  getEnabledSkills,
  isSkillEnabled,
  setSkillEnabled,
  findSkillById,
  saveSkill,
  deleteSkill,
  skillExists,
  isDefaultSkill,
  getDefaultSkillIds,
  saveSkillToProject,
  deleteProjectSkill,
} from './registry.js'
import { getSetting } from '../db/settings.js'

let tempDir: string

const mockStore = ((await import('../db/settings.js')) as any).__store as Map<string, string>

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'skill-registry-test-'))
  mockStore.clear()
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

async function createSkillFile(dir: string, id: string, name: string, prompt: string): Promise<void> {
  const skillsDir = join(dir, 'skills')
  await mkdir(skillsDir, { recursive: true })
  await writeFile(
    join(skillsDir, `${id}.skill.md`),
    `---
id: ${id}
name: ${name}
description: Test skill ${id}
version: "1.0"
---

${prompt}
`,
  )
}

async function createProjectSkillFile(projectDir: string, id: string, name: string, prompt: string): Promise<void> {
  const skillsDir = join(projectDir, '.openfox', 'skills')
  await mkdir(skillsDir, { recursive: true })
  await writeFile(
    join(skillsDir, `${id}.skill.md`),
    `---
id: ${id}
name: ${name}
description: Test project skill ${id}
version: "1.0"
---

${prompt}
`,
  )
}

async function createPortableSkill(
  rootDir: string,
  id: string,
  prompt: string,
  frontmatter = `name: ${id}\ndescription: Portable ${id}`,
): Promise<void> {
  const packageDir = join(rootDir, 'skills', id)
  await mkdir(packageDir, { recursive: true })
  await writeFile(join(packageDir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n${prompt}\n`)
}

async function createPortableInRoot(root: string, id: string, prompt: string): Promise<void> {
  const packageDir = join(root, id)
  await mkdir(packageDir, { recursive: true })
  await writeFile(join(packageDir, 'SKILL.md'), `---\nname: ${id}\ndescription: Portable ${id}\n---\n\n${prompt}\n`)
}

describe('loadDefaultSkills', () => {
  it('should load bundled default skills', async () => {
    const defaults = await loadDefaultSkills()
    expect(defaults.length).toBeGreaterThanOrEqual(1)
    expect(defaults.some((s) => s.metadata.id === 'browser')).toBe(true)
  })
})

describe('loadUserSkills', () => {
  it('should return empty array when skills directory does not exist', async () => {
    const skills = await loadUserSkills(tempDir)
    expect(skills).toEqual([])
  })

  it('should load valid .skill.md files', async () => {
    await createSkillFile(tempDir, 'test', 'Test Skill', 'Do the test.')

    const skills = await loadUserSkills(tempDir)
    expect(skills).toHaveLength(1)
    expect(skills[0]!.metadata.id).toBe('test')
    expect(skills[0]!.metadata.name).toBe('Test Skill')
    expect(skills[0]!.prompt).toBe('Do the test.')
  })

  it('loads a portable SKILL.md using its name as canonical ID', async () => {
    await createPortableSkill(tempDir, 'portable-test', 'Use scripts/run.sh.')

    const skills = await loadUserSkills(tempDir)

    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({
      metadata: {
        id: 'portable-test',
        name: 'portable-test',
        description: 'Portable portable-test',
        version: '',
      },
      prompt: 'Use scripts/run.sh.',
      legacy: false,
      source: 'global-openfox',
    })
    expect(skills[0]!.entrypoint).toBe(join(tempDir, 'skills', 'portable-test', 'SKILL.md'))
    expect(skills[0]!.directory).toBe(await realpath(join(tempDir, 'skills', 'portable-test')))
  })

  it('loads non-standard portable names with migration warnings', async () => {
    await createPortableSkill(tempDir, 'folder-name', 'Do work.', 'name: Invalid_Name\ndescription: Lenient migration')

    const skills = await loadUserSkills(tempDir)

    expect(skills[0]!.metadata.id).toBe('Invalid_Name')
    expect(skills[0]!.warnings).toEqual([
      'Skill name must use 1-64 lowercase letters, numbers, and single hyphens',
      'Skill name "Invalid_Name" does not match package directory "folder-name"',
    ])
  })

  it('prefers a portable package over a same-ID legacy file in one root', async () => {
    await createSkillFile(tempDir, 'same-id', 'Legacy Same', 'Legacy prompt.')
    await createPortableSkill(tempDir, 'same-id', 'Portable prompt.')

    const skills = await loadUserSkills(tempDir)

    expect(skills.filter((skill) => skill.metadata.id === 'same-id')).toHaveLength(1)
    expect(skills[0]).toMatchObject({ prompt: 'Portable prompt.', legacy: false })
  })

  it('should skip files without an id', async () => {
    const skillsDir = join(tempDir, 'skills')
    await mkdir(skillsDir, { recursive: true })
    await writeFile(
      join(skillsDir, 'bad.skill.md'),
      `---
name: No ID
---

Some prompt.
`,
    )

    const skills = await loadUserSkills(tempDir)
    expect(skills).toEqual([])
  })

  it('should skip files with empty prompt', async () => {
    const skillsDir = join(tempDir, 'skills')
    await mkdir(skillsDir, { recursive: true })
    await writeFile(
      join(skillsDir, 'empty.skill.md'),
      `---
id: empty
name: Empty
description: Empty
version: "1.0"
---
`,
    )

    const skills = await loadUserSkills(tempDir)
    expect(skills).toEqual([])
  })
})

describe('loadProjectSkills', () => {
  it('should return empty array when project dir does not exist', async () => {
    const skills = await loadProjectSkills(tempDir)
    expect(skills).toEqual([])
  })

  it('should load valid .skill.md files from .openfox/skills/', async () => {
    await createProjectSkillFile(tempDir, 'proj-skill', 'Project Skill', 'Do the project thing.')

    const skills = await loadProjectSkills(tempDir)
    expect(skills).toHaveLength(1)
    expect(skills[0]!.metadata.id).toBe('proj-skill')
    expect(skills[0]!.metadata.name).toBe('Project Skill')
    expect(skills[0]!.prompt).toBe('Do the project thing.')
  })
})

describe('loadAllSkills', () => {
  it('should merge defaults and user skills', async () => {
    await createSkillFile(tempDir, 'test', 'Test Skill', 'Do the test.')

    const defaults = await loadDefaultSkills()
    const skills = await loadAllSkills(tempDir)
    expect(skills.some((s) => s.metadata.id === 'test')).toBe(true)
    expect(skills.length).toBeGreaterThanOrEqual(defaults.length + 1)
  })

  it('should give precedence to user skills over defaults', async () => {
    const skillsDir = join(tempDir, 'skills')
    await mkdir(skillsDir, { recursive: true })
    await writeFile(
      join(skillsDir, 'custom.skill.md'),
      `---
id: custom
name: Custom Skill
description: Custom
version: "1.0"
---

Custom prompt.
`,
    )

    const skills = await loadAllSkills(tempDir)
    const custom = skills.find((s) => s.metadata.id === 'custom')
    expect(custom).toBeDefined()
    expect(custom!.prompt).toBe('Custom prompt.')
  })

  it('should merge project skills on top of user and defaults', async () => {
    await createProjectSkillFile(tempDir, 'proj-skill', 'Project Skill', 'Project prompt.')

    const defaults = await loadDefaultSkills()
    const skills = await loadAllSkills(tempDir, tempDir)
    expect(skills.some((s) => s.metadata.id === 'proj-skill')).toBe(true)
    expect(skills.length).toBeGreaterThanOrEqual(defaults.length + 1)
  })

  it('should give precedence to project skills over user and defaults', async () => {
    await createSkillFile(tempDir, 'shared', 'User Skill', 'User version.')
    await createProjectSkillFile(tempDir, 'shared', 'Project Skill', 'Project version.')

    const skills = await loadAllSkills(tempDir, tempDir)
    const shared = skills.find((s) => s.metadata.id === 'shared')
    expect(shared).toBeDefined()
    expect(shared!.prompt).toBe('Project version.')
  })

  it('should give precedence to project skills over defaults with same id', async () => {
    // Override a default skill ID with project version
    const defaults = await loadDefaultSkills()
    const defaultId = defaults[0]!.metadata.id
    await createProjectSkillFile(tempDir, defaultId, 'Override', 'Project override.')

    const skills = await loadAllSkills(tempDir, tempDir)
    const overridden = skills.find((s) => s.metadata.id === defaultId)
    expect(overridden).toBeDefined()
    expect(overridden!.prompt).toBe('Project override.')
  })

  it('should load correctly when only project dir has skills', async () => {
    await createProjectSkillFile(tempDir, 'only-proj', 'Only Project', 'Only project.')

    const skills = await loadAllSkills(tempDir, tempDir)
    expect(skills.some((s) => s.metadata.id === 'only-proj')).toBe(true)
  })

  it('should work without project dir', async () => {
    await createSkillFile(tempDir, 'user-skill', 'User Skill', 'User.')
    const defaults = await loadDefaultSkills()

    const skills = await loadAllSkills(tempDir)
    expect(skills.some((s) => s.metadata.id === 'user-skill')).toBe(true)
    expect(skills.length).toBeGreaterThanOrEqual(defaults.length + 1)
  })

  it('discovers all standard roots with deterministic precedence', async () => {
    const homeDir = join(tempDir, 'home')
    const configDir = join(tempDir, 'config')
    const projectDir = join(tempDir, 'project')
    const selectedDir = join(tempDir, 'selected skills')
    await createPortableInRoot(join(homeDir, '.agents', 'skills'), 'shared', 'global shared')
    await createPortableInRoot(join(configDir, 'skills'), 'shared', 'global openfox')
    await createPortableInRoot(selectedDir, 'shared', 'selected')
    await createPortableInRoot(join(projectDir, '.agents', 'skills'), 'shared', 'project shared')
    await createPortableInRoot(join(projectDir, '.openfox', 'skills'), 'shared', 'project openfox')
    mockStore.set('skills.directories', JSON.stringify([selectedDir]))

    const skills = await loadAllSkills(configDir, projectDir, { homeDir })

    expect(skills.find((skill) => skill.metadata.id === 'shared')).toMatchObject({
      prompt: 'project openfox',
      source: 'project-openfox',
    })
  })

  it('reports duplicate precedence decisions', async () => {
    const configDir = join(tempDir, 'config')
    const selectedDir = join(tempDir, 'selected')
    await createPortableInRoot(join(configDir, 'skills'), 'duplicate', 'global version')
    await createPortableInRoot(selectedDir, 'duplicate', 'selected version')
    mockStore.set('skills.directories', JSON.stringify([selectedDir]))

    const result = await loadAllSkillsWithDiagnostics(configDir, undefined, { homeDir: join(tempDir, 'home') })

    expect(result.skills.find((skill) => skill.metadata.id === 'duplicate')?.prompt).toBe('selected version')
    expect(result.diagnostics).toContain('Skill "duplicate" from selected overrides global-openfox')
  })

  it('expands tilde in selected skill directories', async () => {
    const homeDir = join(tempDir, 'home')
    await createPortableInRoot(join(homeDir, 'Shared Skills'), 'tilde-skill', 'Found through tilde.')
    mockStore.set('skills.directories', JSON.stringify(['~/Shared Skills']))

    const skills = await loadAllSkills(join(tempDir, 'config'), undefined, { homeDir })

    expect(skills.find((skill) => skill.metadata.id === 'tilde-skill')).toMatchObject({ source: 'selected' })
  })

  it.skipIf(!CAN_SYMLINK)('deduplicates a physical package reached through a directory symlink', async () => {
    const homeDir = join(tempDir, 'home')
    const globalRoot = join(homeDir, '.agents', 'skills')
    const selectedLink = join(tempDir, 'selected-link')
    await createPortableInRoot(globalRoot, 'linked-skill', 'Linked once.')
    await symlink(globalRoot, selectedLink, 'dir')
    mockStore.set('skills.directories', JSON.stringify([selectedLink]))

    const result = await loadAllSkillsWithDiagnostics(join(tempDir, 'config'), undefined, { homeDir })

    expect(result.skills.filter((skill) => skill.metadata.id === 'linked-skill')).toHaveLength(1)
    expect(result.diagnostics).toContain('Skill "linked-skill" reached through multiple paths')
  })
})

describe('isSkillEnabled / setSkillEnabled', () => {
  it('should default to enabled when no setting exists', () => {
    expect(isSkillEnabled('new_skill')).toBe(true)
  })

  it('should return false when disabled', () => {
    setSkillEnabled('my_skill', false)
    expect(isSkillEnabled('my_skill')).toBe(false)
  })

  it('should return true when explicitly enabled', () => {
    setSkillEnabled('my_skill', false)
    setSkillEnabled('my_skill', true)
    expect(isSkillEnabled('my_skill')).toBe(true)
  })

  it('should persist to settings store', () => {
    setSkillEnabled('persist_test', false)
    expect(getSetting('skill.enabled.persist_test')).toBe('false')
  })
})

describe('getEnabledSkills', () => {
  it('should return only enabled skills', async () => {
    await createSkillFile(tempDir, 'enabled_one', 'Enabled', 'Prompt one.')
    await createSkillFile(tempDir, 'disabled_one', 'Disabled', 'Prompt two.')

    setSkillEnabled('disabled_one', false)

    const enabled = await getEnabledSkills(tempDir)
    expect(enabled.some((s) => s.metadata.id === 'enabled_one')).toBe(true)
    expect(enabled.every((s) => (s.metadata.id === 'disabled_one' ? false : true))).toBe(true)
  })
})

describe('findSkillById', () => {
  it('should return the matching skill', () => {
    const skills: SkillDefinition[] = [
      { metadata: { id: 'a', name: 'A', description: 'A', version: '1' }, prompt: 'A' },
      { metadata: { id: 'b', name: 'B', description: 'B', version: '1' }, prompt: 'B' },
    ]
    const found = findSkillById('b', skills)
    expect(found).toBeDefined()
    expect(found!.metadata.name).toBe('B')
  })

  it('should return undefined for non-existent id', () => {
    expect(findSkillById('missing', [])).toBeUndefined()
  })
})

describe('CRUD', () => {
  it('saves new user skills as portable packages', async () => {
    await saveSkill(tempDir, {
      metadata: { id: 'portable-new', name: 'Portable New', description: 'Test', version: '2.1.0' },
      prompt: 'Portable instructions.',
    })

    const content = await readFile(join(tempDir, 'skills', 'portable-new', 'SKILL.md'), 'utf-8')
    expect(content).toContain('name: portable-new')
    expect(content).toContain('description: Test')
    expect(content).toContain('version: 2.1.0')
    expect(content).toContain('displayName: Portable New')
    expect(content).toContain('Portable instructions.')
  })

  it('should save and load a skill', async () => {
    const skill: SkillDefinition = {
      metadata: { id: 'my_skill', name: 'My Skill', description: 'Test', version: '1.0' },
      prompt: 'Execute my skill.',
    }

    await saveSkill(tempDir, skill)
    const skills = await loadAllSkills(tempDir)
    const loaded = skills.find((s) => s.metadata.id === 'my_skill')

    expect(loaded).toBeDefined()
    expect(loaded!.metadata.name).toBe('My Skill')
    expect(loaded!.prompt).toBe('Execute my skill.')
  })

  it('should delete a skill and clean up settings', async () => {
    await createSkillFile(tempDir, 'deleteme', 'Delete Me', 'Temporary.')
    setSkillEnabled('deleteme', false)
    expect(getSetting('skill.enabled.deleteme')).toBe('false')

    const result = await deleteSkill(tempDir, 'deleteme')
    expect(result.success).toBe(true)

    const skills = await loadAllSkills(tempDir)
    expect(skills.find((s) => s.metadata.id === 'deleteme')).toBeUndefined()
    expect(getSetting('skill.enabled.deleteme')).toBeNull()
  })

  it('should not delete built-in default skills', async () => {
    const result = await deleteSkill(tempDir, 'browser')
    expect(result.success).toBe(false)
    expect(result.reason).toBe('Cannot delete built-in defaults')
  })

  it('should return false when deleting non-existent skill', async () => {
    const result = await deleteSkill(tempDir, 'nonexistent')
    expect(result.success).toBe(false)
  })

  it('should check skill existence', async () => {
    expect(await skillExists(tempDir, 'nope')).toBe(false)

    await saveSkill(tempDir, {
      metadata: { id: 'exists', name: 'Exists', description: 'E', version: '1' },
      prompt: 'Here.',
    })
    expect(await skillExists(tempDir, 'exists')).toBe(true)
  })

  it('should save and load a project skill', async () => {
    const skill: SkillDefinition = {
      metadata: { id: 'proj_skill', name: 'Project Skill', description: 'Project', version: '1.0' },
      prompt: 'Execute project skill.',
    }

    await saveSkillToProject(tempDir, skill)

    const loaded = await loadProjectSkills(tempDir)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]!.metadata.id).toBe('proj_skill')
    expect(loaded[0]!.prompt).toBe('Execute project skill.')
  })

  it('should delete a project skill', async () => {
    await createProjectSkillFile(tempDir, 'proj_del', 'Delete Project', 'Temporary.')
    expect(await loadProjectSkills(tempDir)).toHaveLength(1)

    const result = await deleteProjectSkill(tempDir, 'proj_del')
    expect(result.success).toBe(true)
    expect(await loadProjectSkills(tempDir)).toHaveLength(0)
  })

  it('should check project skill existence', async () => {
    await saveSkillToProject(tempDir, {
      metadata: { id: 'proj_exists', name: 'Exists', description: 'E', version: '1' },
      prompt: 'Here.',
    })

    expect(await skillExists(tempDir, 'proj_exists', tempDir)).toBe(true)
  })
})

describe('isDefaultSkill', () => {
  it('should correctly identify built-in default skills', async () => {
    const defaults = await loadDefaultSkills()
    for (const skill of defaults) {
      expect(await isDefaultSkill(skill.metadata.id)).toBe(true)
    }
    expect(await isDefaultSkill('nonexistent-skill')).toBe(false)
  })
})

describe('getDefaultSkillIds', () => {
  it('should return all default skill IDs', async () => {
    const ids = await getDefaultSkillIds()
    expect(ids.length).toBeGreaterThan(0)
    expect(ids).toContain('browser')
  })
})
