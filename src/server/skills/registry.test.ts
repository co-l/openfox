/**
 * Skill Registry Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { SkillDefinition } from './types.js'

vi.mock('../db/settings.js', () => {
  const store = new Map<string, string>()
  return {
    getSetting: (key: string) => store.get(key) ?? null,
    setSetting: (key: string, value: string) => { store.set(key, value) },
    deleteSetting: (key: string) => { store.delete(key) },
    __store: store,
  }
})

import {
  loadAllSkills,
  loadDefaultSkills,
  loadUserSkills,
  getEnabledSkills,
  getEnabledSkillMetadata,
  isSkillEnabled,
  setSkillEnabled,
  findSkillById,
  saveSkill,
  deleteSkill,
  skillExists,
  isDefaultSkill,
  getDefaultSkillIds,
} from './registry.js'
import { getSetting } from '../db/settings.js'

let tempDir: string

const mockStore = (await import('../db/settings.js') as any).__store as Map<string, string>

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
  await writeFile(join(skillsDir, `${id}.skill.md`), `---
id: ${id}
name: ${name}
description: Test skill ${id}
version: "1.0"
---

${prompt}
`)
}

describe('loadDefaultSkills', () => {
  it('should load bundled default skills', async () => {
    const defaults = await loadDefaultSkills()
    expect(defaults.length).toBeGreaterThanOrEqual(1)
    expect(defaults.some(s => s.metadata.id === 'browser')).toBe(true)
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

  it('should skip files without an id', async () => {
    const skillsDir = join(tempDir, 'skills')
    await mkdir(skillsDir, { recursive: true })
    await writeFile(join(skillsDir, 'bad.skill.md'), `---
name: No ID
---

Some prompt.
`)

    const skills = await loadUserSkills(tempDir)
    expect(skills).toEqual([])
  })

  it('should skip files with empty prompt', async () => {
    const skillsDir = join(tempDir, 'skills')
    await mkdir(skillsDir, { recursive: true })
    await writeFile(join(skillsDir, 'empty.skill.md'), `---
id: empty
name: Empty
description: Empty
version: "1.0"
---
`)

    const skills = await loadUserSkills(tempDir)
    expect(skills).toEqual([])
  })
})

describe('loadAllSkills', () => {
  it('should merge defaults and user skills', async () => {
    await createSkillFile(tempDir, 'test', 'Test Skill', 'Do the test.')

    const defaults = await loadDefaultSkills()
    const skills = await loadAllSkills(tempDir)
    expect(skills.some(s => s.metadata.id === 'test')).toBe(true)
    expect(skills.length).toBeGreaterThanOrEqual(defaults.length + 1)
  })

  it('should give precedence to user skills over defaults', async () => {
    const skillsDir = join(tempDir, 'skills')
    await mkdir(skillsDir, { recursive: true })
    await writeFile(join(skillsDir, 'custom.skill.md'), `---
id: custom
name: Custom Skill
description: Custom
version: "1.0"
---

Custom prompt.
`)

    const skills = await loadAllSkills(tempDir)
    const custom = skills.find(s => s.metadata.id === 'custom')
    expect(custom).toBeDefined()
    expect(custom!.prompt).toBe('Custom prompt.')
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
    expect(enabled.some(s => s.metadata.id === 'enabled_one')).toBe(true)
    expect(enabled.every(s => s.metadata.id === 'disabled_one' ? false : true)).toBe(true)
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
  it('should save and load a skill', async () => {
    const skill: SkillDefinition = {
      metadata: { id: 'my_skill', name: 'My Skill', description: 'Test', version: '1.0' },
      prompt: 'Execute my skill.',
    }

    await saveSkill(tempDir, skill)
    const skills = await loadAllSkills(tempDir)
    const loaded = skills.find(s => s.metadata.id === 'my_skill')

    expect(loaded).toBeDefined()
    expect(loaded!.metadata.name).toBe('My Skill')
    expect(loaded!.prompt).toBe('Execute my skill.')
  })

  it('should delete a skill and clean up settings', async () => {
    const skill: SkillDefinition = {
      metadata: { id: 'deleteme', name: 'Delete Me', description: 'Temp', version: '1' },
      prompt: 'Temporary.',
    }

    await saveSkill(tempDir, skill)
    setSkillEnabled('deleteme', false)
    expect(getSetting('skill.enabled.deleteme')).toBe('false')

    const result = await deleteSkill(tempDir, 'deleteme')
    expect(result.success).toBe(true)

    const skills = await loadAllSkills(tempDir)
    expect(skills.find(s => s.metadata.id === 'deleteme')).toBeUndefined()
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