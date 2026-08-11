import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadPermissionsConfig,
  savePermissionsConfig,
  loadMergedRules,
  getGlobalPermissionsPath,
  getProjectPermissionsPath,
} from './registry.js'

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
  await mkdir(join(PROJECT_DIR, '.openfox'), { recursive: true })
  loggerMock.warn.mockClear()
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('getGlobalPermissionsPath / getProjectPermissionsPath', () => {
  it('returns configDir/permissions.json for global', () => {
    expect(getGlobalPermissionsPath(GLOBAL_DIR)).toBe(join(GLOBAL_DIR, 'permissions.json'))
  })

  it('returns workdir/.openfox/permissions.json for project', () => {
    expect(getProjectPermissionsPath(PROJECT_DIR)).toBe(join(PROJECT_DIR, '.openfox', 'permissions.json'))
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
    expect(loaded).toEqual(config)
  })

  it('loads project config from .openfox/permissions.json', async () => {
    const config = {
      version: 1,
      rules: [{ effect: 'ALLOW', tool: 'read_file', pattern: '/ubiquity/**' }],
    }
    await writeFile(join(PROJECT_DIR, '.openfox', 'permissions.json'), JSON.stringify(config))
    const loaded = await loadPermissionsConfig('project', GLOBAL_DIR, PROJECT_DIR)
    expect(loaded).toEqual(config)
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
    await savePermissionsConfig('global', GLOBAL_DIR, PROJECT_DIR, config)
    const loaded = await loadPermissionsConfig('global', GLOBAL_DIR, PROJECT_DIR)
    expect(loaded).toEqual(config)
  })

  it('deletes the file when rules array is empty', async () => {
    const config = { version: 1 as const, rules: [] }
    await savePermissionsConfig('global', GLOBAL_DIR, PROJECT_DIR, config)
    const { stat } = await import('node:fs/promises')
    await expect(stat(join(GLOBAL_DIR, 'permissions.json'))).rejects.toThrow()
  })

  it('creates .openfox dir if missing for project scope', async () => {
    const newProject = join(TEST_DIR, 'new-project')
    await mkdir(newProject, { recursive: true })
    const config = {
      version: 1 as const,
      rules: [{ effect: 'DENY' as const, tool: 'write_file', pattern: '**/.env*' }],
    }
    await savePermissionsConfig('project', GLOBAL_DIR, newProject, config)
    const loaded = await loadPermissionsConfig('project', GLOBAL_DIR, newProject)
    expect(loaded).toEqual(config)
  })
})

describe('loadMergedRules', () => {
  it('returns empty array when no files exist', async () => {
    const rules = await loadMergedRules(GLOBAL_DIR, PROJECT_DIR)
    expect(rules).toEqual([])
  })

  it('returns only global rules when no project file', async () => {
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
    await writeFile(
      join(PROJECT_DIR, '.openfox', 'permissions.json'),
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
