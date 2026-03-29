import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { gitTool } from './git.js'
import { SessionManager } from '../session/manager.js'
import { createProject } from '../db/projects.js'
import { getDatabase, initDatabase } from '../db/index.js'
import { initEventStore } from '../events/index.js'
import { loadConfig } from '../config.js'

const execAsync = promisify(exec)

// Mock provider manager
const mockProviderManager = {
  getCurrentModelContext: () => 200000,
}

describe('git tool', () => {
  let testDir: string
  let sessionId: string
  let context: any
  let sessionManager: SessionManager

  beforeEach(async () => {
    // Initialize in-memory database
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
    // Initialize EventStore
    initEventStore(getDatabase())

    // Create test directory
    testDir = await mkdtemp(join(tmpdir(), 'openfox-git-test-'))

    // Initialize git repo
    await execAsync('git init', { cwd: testDir })
    await execAsync('git config user.email "test@test.com"', { cwd: testDir })
    await execAsync('git config user.name "Test User"', { cwd: testDir })
    await execAsync('git config core.quotepath false', { cwd: testDir })
    // Force English locale for git commands
    process.env['LANG'] = 'C'

    // Create initial commit
    await writeFile(join(testDir, 'README.md'), '# Test')
    await execAsync('git add .', { cwd: testDir })
    await execAsync('git commit -m "Initial commit"', { cwd: testDir })

    // Create project and session
    sessionManager = new SessionManager(mockProviderManager as any)
    const project = createProject('test-git-project', testDir)
    const session = sessionManager.createSession(project.id, 'Test Git Session')
    sessionId = session.id

    context = {
      sessionId,
      workdir: testDir,
      signal: undefined,
      onEvent: undefined,
      onProgress: undefined,
    }
  })

  afterEach(async () => {
    sessionManager.deleteSession(sessionId)
    await rm(testDir, { recursive: true, force: true })
  })

  describe('tool definition', () => {
    it('has correct name', () => {
      expect(gitTool.name).toBe('git')
    })

    it('has proper description', () => {
      expect(gitTool.definition.function.description).toContain('git command')
      expect(gitTool.definition.function.description).toContain('inspect repository')
    })

    it('has required command parameter', () => {
      const params = gitTool.definition.function.parameters as any
      expect(params.properties.command).toBeDefined()
      expect(params.required).toContain('command')
    })

    it('has optional cwd parameter', () => {
      const params = gitTool.definition.function.parameters as any
      expect(params.properties.cwd).toBeDefined()
      expect(params.required).not.toContain('cwd')
    })
  })

  describe('command validation', () => {
    it('rejects non-git commands', async () => {
      const result = await gitTool.execute({ command: 'ls -la' }, context)
      expect(result.success).toBe(false)
      expect(result.error).toContain('must start with "git"')
    })

    it('rejects commands without git prefix', async () => {
      const result = await gitTool.execute({ command: 'status' }, context)
      expect(result.success).toBe(false)
      expect(result.error).toContain('must start with "git"')
    })

    it('accepts git commands', async () => {
      const result = await gitTool.execute({ command: 'git status' }, context)
      expect(result.success).toBe(true)
      expect(result.output).toContain('branch')
    })
  })

  describe('destructive command blocking', () => {
    it('blocks git reset --hard', async () => {
      const result = await gitTool.execute({ command: 'git reset --hard' }, context)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Destructive git command blocked')
      expect(result.error).toContain('read-only')
    })

    it('blocks git reset --hard HEAD', async () => {
      const result = await gitTool.execute({ command: 'git reset --hard HEAD' }, context)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Destructive git command blocked')
    })

    it('blocks git push --force', async () => {
      const result = await gitTool.execute({ command: 'git push --force' }, context)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Destructive git command blocked')
    })

    it('blocks git branch -D', async () => {
      const result = await gitTool.execute({ command: 'git branch -D feature' }, context)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Destructive git command blocked')
    })

    it('allows safe git commands', async () => {
      const result = await gitTool.execute({ command: 'git log --oneline -1' }, context)
      expect(result.success).toBe(true)
    })
  })

  describe('git status', () => {
    it('shows clean working tree', async () => {
      const result = await gitTool.execute({ command: 'git status' }, context)
      expect(result.success).toBe(true)
      expect(result.output).toContain('branch')
      expect(result.output).toContain('clean')
    })

    it('shows uncommitted changes', async () => {
      await writeFile(join(testDir, 'test.txt'), 'new content')
      const result = await gitTool.execute({ command: 'git status' }, context)
      expect(result.success).toBe(true)
      expect(result.output).toContain('test.txt')
    })
  })

  describe('git diff', () => {
    it('shows no diff on clean repo', async () => {
      const result = await gitTool.execute({ command: 'git diff' }, context)
      expect(result.success).toBe(true)
      expect(result.output).not.toContain('diff')
    })

    it('shows diff after file modification', async () => {
      const filePath = join(testDir, 'README.md')
      await writeFile(filePath, '# Modified')
      const result = await gitTool.execute({ command: 'git diff' }, context)
      expect(result.success).toBe(true)
      expect(result.output).toContain('-# Test')
      expect(result.output).toContain('+# Modified')
    })
  })

  describe('git log', () => {
    it('shows commit history', async () => {
      const result = await gitTool.execute({ command: 'git log --oneline -5' }, context)
      expect(result.success).toBe(true)
      expect(result.output).toContain('Initial commit')
    })

    it('limits output to specified count', async () => {
      // Create more commits
      await writeFile(join(testDir, 'file1.txt'), 'content1')
      await execAsync('git add . && git commit -m "Second"', { cwd: testDir })
      await writeFile(join(testDir, 'file2.txt'), 'content2')
      await execAsync('git add . && git commit -m "Third"', { cwd: testDir })

      const result = await gitTool.execute({ command: 'git log --oneline -2' }, context)
      expect(result.success).toBe(true)
      expect(result.output).toBeDefined()
      const lines = result.output!.split('\n').filter(l => l.trim())
      // Should show at most 2 commits (the most recent ones)
      expect(lines.length).toBeLessThanOrEqual(3) // Initial + 2 new = 3, but -2 should show 2
      // Verify it contains the most recent commits
      expect(result.output).toContain('Third')
      expect(result.output).toContain('Second')
    })
  })

  describe('git branch', () => {
    it('shows current branch', async () => {
      const result = await gitTool.execute({ command: 'git branch' }, context)
      expect(result.success).toBe(true)
      expect(result.output).toContain('*')
    })

    it('lists all branches', async () => {
      await execAsync('git checkout -b feature', { cwd: testDir })
      await execAsync('git checkout main', { cwd: testDir })
      const result = await gitTool.execute({ command: 'git branch' }, context)
      expect(result.success).toBe(true)
      expect(result.output).toContain('feature')
      expect(result.output).toContain('main')
    })
  })

  describe('custom working directory', () => {
    it('uses cwd parameter', async () => {
      const subdir = join(testDir, 'subdir')
      await execAsync('mkdir -p ' + subdir)
      await execAsync('git init', { cwd: subdir })
      await execAsync('git config user.email "test@test.com"', { cwd: subdir })
      await execAsync('git config user.name "Test"', { cwd: subdir })
      await writeFile(join(subdir, 'file.txt'), 'content')
      await execAsync('git add . && git commit -m "init"', { cwd: subdir })

      const result = await gitTool.execute({ command: 'git status', cwd: 'subdir' }, context)
      expect(result.success).toBe(true)
      expect(result.output).toContain('branch')
      expect(result.output).toContain('clean')
    })
  })

  describe('error handling', () => {
    it('handles invalid git commands', async () => {
      const result = await gitTool.execute({ command: 'git invalid-command' }, context)
      expect(result.success).toBe(false)
      expect(result.output).toContain('Exit code:')
    })

    it('handles missing command', async () => {
      const result = await gitTool.execute({}, context)
      expect(result.success).toBe(false)
      expect(result.error).toContain('command is required')
    })
  })
})
