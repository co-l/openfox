import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

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

import { isClaudeCodeProject, readClaudeCompatMode, resolveClaudeCompat } from './claude-compat.js'

const mockStore = ((await import('../db/settings.js')) as unknown as { __store: Map<string, string> }).__store

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'claude-compat-test-'))
  mockStore.clear()
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('isClaudeCodeProject', () => {
  it('returns false for a directory without Claude Code markers', async () => {
    expect(await isClaudeCodeProject(tempDir)).toBe(false)
  })

  it('detects a .claude directory', async () => {
    await mkdir(join(tempDir, '.claude'))
    expect(await isClaudeCodeProject(tempDir)).toBe(true)
  })

  it('detects a CLAUDE.md file', async () => {
    await writeFile(join(tempDir, 'CLAUDE.md'), '# memory')
    expect(await isClaudeCodeProject(tempDir)).toBe(true)
  })

  it('returns false for a directory that does not exist', async () => {
    expect(await isClaudeCodeProject(join(tempDir, 'missing'))).toBe(false)
  })
})

describe('readClaudeCompatMode', () => {
  it('defaults to auto', () => {
    expect(readClaudeCompatMode()).toBe('auto')
  })

  it('maps the stored booleans', () => {
    mockStore.set('compat.claudeCode', 'true')
    expect(readClaudeCompatMode()).toBe('enabled')
    mockStore.set('compat.claudeCode', 'false')
    expect(readClaudeCompatMode()).toBe('disabled')
  })

  it('falls back to auto for unknown values', () => {
    mockStore.set('compat.claudeCode', 'yes-please')
    expect(readClaudeCompatMode()).toBe('auto')
  })
})

describe('resolveClaudeCompat', () => {
  it('honours an explicit override over the setting', async () => {
    mockStore.set('compat.claudeCode', 'false')
    expect(await resolveClaudeCompat(tempDir, true)).toBe(true)
    mockStore.set('compat.claudeCode', 'true')
    expect(await resolveClaudeCompat(tempDir, false)).toBe(false)
  })

  it('stays on for a plain project when forced on', async () => {
    mockStore.set('compat.claudeCode', 'true')
    expect(await resolveClaudeCompat(tempDir)).toBe(true)
  })

  it('stays off for a Claude Code project when forced off', async () => {
    await mkdir(join(tempDir, '.claude'))
    mockStore.set('compat.claudeCode', 'false')
    expect(await resolveClaudeCompat(tempDir)).toBe(false)
  })

  it('auto-enables for a Claude Code project', async () => {
    await mkdir(join(tempDir, '.claude'))
    expect(await resolveClaudeCompat(tempDir)).toBe(true)
  })

  it('stays off in auto mode for a plain project', async () => {
    expect(await resolveClaudeCompat(tempDir)).toBe(false)
  })

  it('stays off in auto mode when no directory is known', async () => {
    expect(await resolveClaudeCompat(undefined)).toBe(false)
  })
})
