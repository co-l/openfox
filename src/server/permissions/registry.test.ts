import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadPermissionsConfig,
  savePermissionsConfig,
  addPermissionRule,
  updatePermissionRule,
  deletePermissionRule,
  loadMergedRules,
  getGlobalPermissionsPath,
  getProjectPermissionsKey,
} from './registry.js'
import { loadConfig } from '../config.js'
import { closeDatabase, initDatabase } from '../db/index.js'
import { getSetting, setSetting } from '../db/settings.js'

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('../utils/logger.js', () => ({
  logger: loggerMock,
}))

const TEST_DIR = join(tmpdir(), 'openfox-permissions-registry-test')
const GLOBAL_DIR = join(TEST_DIR, 'global')
const PROJECT_DIR = join(TEST_DIR, 'project')

beforeEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
  await mkdir(GLOBAL_DIR, { recursive: true })
  await mkdir(PROJECT_DIR, { recursive: true })
  closeDatabase()
  const dbConfig = loadConfig()
  dbConfig.database.path = ':memory:'
  initDatabase(dbConfig)
  loggerMock.warn.mockClear()
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('getGlobalPermissionsPath / getProjectPermissionsKey', () => {
  it('returns configDir/permissions.json for global', () => {
    expect(getGlobalPermissionsPath(GLOBAL_DIR)).toBe(join(GLOBAL_DIR, 'permissions.json'))
  })

  it('returns a settings key derived from the resolved workdir for project', () => {
    expect(getProjectPermissionsKey(PROJECT_DIR)).toBe(`permissions.project.${PROJECT_DIR}`)
    expect(getProjectPermissionsKey(`${PROJECT_DIR}/`)).toBe(getProjectPermissionsKey(PROJECT_DIR))
  })
})

describe('loadPermissionsConfig', () => {
  it('returns empty config when file does not exist', async () => {
    const config = await loadPermissionsConfig('global', GLOBAL_DIR, PROJECT_DIR)
    expect(config).toEqual({ version: 1, rules: [] })
  })

  it('loads a valid config file', async () => {
    const config = { version: 1, rules: [{ effect: 'DENY', tool: 'run_command', pattern: 'rm -rf *' }] }
    await writeFile(join(GLOBAL_DIR, 'permissions.json'), JSON.stringify(config))
    const loaded = await loadPermissionsConfig('global', GLOBAL_DIR, PROJECT_DIR)
    expect(loaded).toMatchObject(config)
  })

  it('backfills an id on a hand-written rule that has none', async () => {
    const config = { version: 1, rules: [{ effect: 'DENY', tool: 'run_command', pattern: 'rm -rf *' }] }
    await writeFile(join(GLOBAL_DIR, 'permissions.json'), JSON.stringify(config))
    const loaded = await loadPermissionsConfig('global', GLOBAL_DIR, PROJECT_DIR)
    expect(loaded.rules[0]!.id).toBeTruthy()
  })

  it('keeps the id already written in the file', async () => {
    const config = { version: 1, rules: [{ id: 'keep-me', effect: 'DENY', tool: 'run_command', pattern: 'rm -rf *' }] }
    await writeFile(join(GLOBAL_DIR, 'permissions.json'), JSON.stringify(config))
    const loaded = await loadPermissionsConfig('global', GLOBAL_DIR, PROJECT_DIR)
    expect(loaded.rules[0]!.id).toBe('keep-me')
  })

  it('loads project config from the database', async () => {
    const config = {
      version: 1,
      rules: [{ effect: 'ALLOW', tool: 'read_file', pattern: '/ubiquity/**' }],
    }
    setSetting(getProjectPermissionsKey(PROJECT_DIR), JSON.stringify(config))
    const loaded = await loadPermissionsConfig('project', GLOBAL_DIR, PROJECT_DIR)
    expect(loaded).toMatchObject(config)
  })

  it('returns empty config on invalid JSON (graceful)', async () => {
    await writeFile(join(GLOBAL_DIR, 'permissions.json'), '{ not valid json')
    const loaded = await loadPermissionsConfig('global', GLOBAL_DIR, PROJECT_DIR)
    expect(loaded).toEqual({ version: 1, rules: [] })
  })

  it('logs warning on invalid JSON parse error', async () => {
    await writeFile(join(GLOBAL_DIR, 'permissions.json'), '{ not valid json')
    await loadPermissionsConfig('global', GLOBAL_DIR, PROJECT_DIR)
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'permissions.json parse error, ignoring',
      expect.objectContaining({ path: join(GLOBAL_DIR, 'permissions.json') }),
    )
  })

  it('does NOT log warning when file does not exist (ENOENT)', async () => {
    await loadPermissionsConfig('global', GLOBAL_DIR, PROJECT_DIR)
    expect(loggerMock.warn).not.toHaveBeenCalled()
  })

  it('returns empty config on Zod validation failure', async () => {
    await writeFile(join(GLOBAL_DIR, 'permissions.json'), JSON.stringify({ version: 1, rules: [{ effect: 'BAD' }] }))
    const loaded = await loadPermissionsConfig('global', GLOBAL_DIR, PROJECT_DIR)
    expect(loaded).toEqual({ version: 1, rules: [] })
  })
})

describe('savePermissionsConfig', () => {
  it('saves and reloads identical config (round-trip)', async () => {
    const config = {
      version: 1 as const,
      rules: [
        { effect: 'DENY' as const, tool: 'run_command', pattern: 'rm -rf *' },
        { effect: 'ALLOW' as const, tool: 'read_file', pattern: '/ubiquity/**' },
      ],
    }
    const saved = await savePermissionsConfig('global', GLOBAL_DIR, PROJECT_DIR, config)
    const loaded = await loadPermissionsConfig('global', GLOBAL_DIR, PROJECT_DIR)
    expect(loaded).toMatchObject(config)
    // Ids are assigned on save and survive the round-trip.
    expect(loaded.rules.map((rule) => rule.id)).toEqual(saved.rules.map((rule) => rule.id))
  })

  it('deletes the file when rules array is empty', async () => {
    const config = { version: 1 as const, rules: [] }
    await savePermissionsConfig('global', GLOBAL_DIR, PROJECT_DIR, config)
    const { stat } = await import('node:fs/promises')
    await expect(stat(join(GLOBAL_DIR, 'permissions.json'))).rejects.toThrow()
  })

  it('stores project scope in the database, never in the repository', async () => {
    const newProject = join(TEST_DIR, 'new-project')
    await mkdir(newProject, { recursive: true })
    const config = {
      version: 1 as const,
      rules: [{ effect: 'DENY' as const, tool: 'write_file', pattern: '**/.env*' }],
    }
    await savePermissionsConfig('project', GLOBAL_DIR, newProject, config)
    const loaded = await loadPermissionsConfig('project', GLOBAL_DIR, newProject)
    expect(loaded).toMatchObject(config)
    await expect(readdir(newProject)).resolves.toEqual([])
  })

  it('removes the project entry when saving an empty rule list', async () => {
    await savePermissionsConfig('project', GLOBAL_DIR, PROJECT_DIR, {
      version: 1,
      rules: [{ effect: 'DENY', tool: 'write_file', pattern: '**/.env*' }],
    })
    await savePermissionsConfig('project', GLOBAL_DIR, PROJECT_DIR, { version: 1, rules: [] })
    expect(getSetting(getProjectPermissionsKey(PROJECT_DIR))).toBeNull()
  })
})

describe('addPermissionRule / updatePermissionRule / deletePermissionRule', () => {
  const denyRule = { effect: 'DENY' as const, tool: 'run_command', pattern: 'rm -rf *' }
  const allowRule = { effect: 'ALLOW' as const, tool: 'read_file', pattern: '/ubiquity/**' }

  it('addPermissionRule appends a rule with a fresh id', async () => {
    const first = await addPermissionRule('global', GLOBAL_DIR, PROJECT_DIR, denyRule)
    const second = await addPermissionRule('global', GLOBAL_DIR, PROJECT_DIR, allowRule)
    expect(second.rules).toHaveLength(2)
    expect(second.rules[0]!.id).toBe(first.rules[0]!.id)
    expect(second.rules[1]!.id).not.toBe(first.rules[0]!.id)
  })

  it('addPermissionRule re-reads the file, so a concurrent add is not lost', async () => {
    // Simulates a second client: it added a rule after the first one loaded.
    await addPermissionRule('global', GLOBAL_DIR, PROJECT_DIR, denyRule)
    await addPermissionRule('global', GLOBAL_DIR, PROJECT_DIR, allowRule)
    const loaded = await loadPermissionsConfig('global', GLOBAL_DIR, PROJECT_DIR)
    expect(loaded.rules.map((rule) => rule.tool)).toEqual(['run_command', 'read_file'])
  })

  it('updatePermissionRule replaces the rule with that id, keeping id and position', async () => {
    await addPermissionRule('global', GLOBAL_DIR, PROJECT_DIR, denyRule)
    const added = await addPermissionRule('global', GLOBAL_DIR, PROJECT_DIR, allowRule)
    const targetId = added.rules[1]!.id
    const updated = await updatePermissionRule('global', GLOBAL_DIR, PROJECT_DIR, targetId, {
      effect: 'ASK',
      tool: 'read_file',
      pattern: '/other/**',
    })
    expect(updated!.rules[1]).toEqual({ id: targetId, effect: 'ASK', tool: 'read_file', pattern: '/other/**' })
    expect(updated!.rules[0]!.tool).toBe('run_command')
  })

  it('updatePermissionRule returns null for an unknown id', async () => {
    await addPermissionRule('global', GLOBAL_DIR, PROJECT_DIR, denyRule)
    expect(await updatePermissionRule('global', GLOBAL_DIR, PROJECT_DIR, 'nope', denyRule)).toBeNull()
  })

  it('deletePermissionRule removes only the rule with that id', async () => {
    const first = await addPermissionRule('global', GLOBAL_DIR, PROJECT_DIR, denyRule)
    await addPermissionRule('global', GLOBAL_DIR, PROJECT_DIR, allowRule)
    const remaining = await deletePermissionRule('global', GLOBAL_DIR, PROJECT_DIR, first.rules[0]!.id)
    expect(remaining!.rules).toHaveLength(1)
    expect(remaining!.rules[0]!.tool).toBe('read_file')
  })

  it('deletePermissionRule returns null for an unknown id', async () => {
    await addPermissionRule('global', GLOBAL_DIR, PROJECT_DIR, denyRule)
    expect(await deletePermissionRule('global', GLOBAL_DIR, PROJECT_DIR, 'nope')).toBeNull()
  })
})

describe('loadMergedRules', () => {
  it('returns empty array when no files exist', async () => {
    const rules = await loadMergedRules(GLOBAL_DIR, PROJECT_DIR)
    expect(rules).toEqual([])
  })

  it('returns only global rules when no project rules', async () => {
    const globalConfig = {
      version: 1 as const,
      rules: [{ effect: 'DENY' as const, tool: 'run_command', pattern: 'rm -rf *' }],
    }
    await writeFile(join(GLOBAL_DIR, 'permissions.json'), JSON.stringify(globalConfig))
    const rules = await loadMergedRules(GLOBAL_DIR, PROJECT_DIR)
    expect(rules).toHaveLength(1)
    expect(rules[0]!.effect).toBe('DENY')
  })

  it('merges global + project rules', async () => {
    await writeFile(
      join(GLOBAL_DIR, 'permissions.json'),
      JSON.stringify({
        version: 1,
        rules: [{ effect: 'DENY', tool: 'run_command', pattern: 'rm -rf *' }],
      }),
    )
    setSetting(
      getProjectPermissionsKey(PROJECT_DIR),
      JSON.stringify({
        version: 1,
        rules: [{ effect: 'ALLOW', tool: 'read_file', pattern: '/ubiquity/**' }],
      }),
    )
    const rules = await loadMergedRules(GLOBAL_DIR, PROJECT_DIR)
    expect(rules).toHaveLength(2)
    expect(rules.map((r) => r.effect)).toContain('DENY')
    expect(rules.map((r) => r.effect)).toContain('ALLOW')
  })

  it('re-reads file on each load (no stale cache)', async () => {
    await writeFile(
      join(GLOBAL_DIR, 'permissions.json'),
      JSON.stringify({ version: 1, rules: [{ effect: 'DENY', tool: 'read_file' }] }),
    )
    const rules1 = await loadMergedRules(GLOBAL_DIR, PROJECT_DIR)
    expect(rules1).toHaveLength(1)
    await writeFile(
      join(GLOBAL_DIR, 'permissions.json'),
      JSON.stringify({
        version: 1,
        rules: [
          { effect: 'DENY', tool: 'read_file' },
          { effect: 'ALLOW', tool: 'read_file' },
        ],
      }),
    )
    const rules2 = await loadMergedRules(GLOBAL_DIR, PROJECT_DIR)
    expect(rules2).toHaveLength(2)
  })
})
