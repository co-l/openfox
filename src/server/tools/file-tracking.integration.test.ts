import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileTool } from './read.js'
import { writeFileTool } from './write.js'
import { editFileTool } from './edit.js'
import type { ToolContext } from './types.js'
import { SessionManager } from '../session/manager.js'
import { initDatabase, closeDatabase, getDatabase } from '../db/index.js'
import { initEventStore } from '../events/index.js'
import type { Config } from '../../shared/types.js'

// Mock provider manager
const mockProviderManager = {
  getCurrentModelContext: () => 200000,
}

// Create a minimal test context
function createTestContext(sessionManager: SessionManager, sessionId: string, workdir: string): ToolContext {
  return {
    sessionManager,
    sessionId,
    workdir,
  }
}

// Create test config with in-memory database
function createTestConfig(): Config {
  return {
    llm: { baseUrl: 'http://localhost:8000/v1', model: 'test', timeout: 1000, idleTimeout: 30000, backend: 'vllm' },
    context: { maxTokens: 100000, compactionThreshold: 0.85, compactionTarget: 0.6 },
    agent: { maxIterations: 10, maxConsecutiveFailures: 3, toolTimeout: 1000 },
    server: { port: 3000, host: 'localhost' },
    database: { path: ':memory:' },
    workdir: process.cwd(),
  }
}

describe('file tracking integration', () => {
  let testDir: string
  let sessionId: string
  let context: ToolContext
  let sessionManager: SessionManager

  beforeEach(async () => {
    // Initialize database for session manager
    initDatabase(createTestConfig())
    // Initialize EventStore
    initEventStore(getDatabase())

    // Create test directory
    testDir = join(tmpdir(), `openfox-file-tracking-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })

    // Create a test project and session
    sessionManager = new SessionManager(mockProviderManager as any)
    const { createProject } = await import('../db/projects.js')
    const project = createProject('test-project', testDir)
    const session = sessionManager.createSession(project.id)
    sessionId = session.id
    context = createTestContext(sessionManager, sessionId, testDir)
  })

  afterEach(async () => {
    closeDatabase()
    // Windows keeps the directory in "pending delete" after the files are
    // unlinked, so rmdir returns EBUSY; fs.rm does not retry unless asked.
    await rm(testDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  describe('write_file requires read first', () => {
    it('allows writing to new file without reading', async () => {
      const result = await writeFileTool.execute({ path: 'new-file.txt', content: 'hello world' }, context)

      expect(result.success).toBe(true)
      expect(result.output).toContain('Successfully wrote')
    })

    it('rejects writing to existing file that was not read', async () => {
      // Create existing file
      await writeFile(join(testDir, 'existing.txt'), 'original content')

      const result = await writeFileTool.execute({ path: 'existing.txt', content: 'new content' }, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('must be read before writing')
    })

    it('allows writing to existing file after reading', async () => {
      // Create existing file
      await writeFile(join(testDir, 'existing.txt'), 'original content')

      // Read the file first
      const readResult = await readFileTool.execute({ path: 'existing.txt' }, context)
      expect(readResult.success).toBe(true)

      // Now write should succeed
      const writeResult = await writeFileTool.execute({ path: 'existing.txt', content: 'new content' }, context)

      expect(writeResult.success).toBe(true)
      expect(writeResult.output).toContain('Successfully wrote')
    })

    it('allows multiple writes after single read', async () => {
      // Create existing file
      await writeFile(join(testDir, 'multi-write.txt'), 'original content')

      // Read the file first
      await readFileTool.execute({ path: 'multi-write.txt' }, context)

      // First write
      const write1 = await writeFileTool.execute({ path: 'multi-write.txt', content: 'first update' }, context)
      expect(write1.success).toBe(true)

      // Second write (hash was updated after first write)
      const write2 = await writeFileTool.execute({ path: 'multi-write.txt', content: 'second update' }, context)
      expect(write2.success).toBe(true)
    })

    it('allows repeated writes after creating a new file', async () => {
      const write1 = await writeFileTool.execute(
        { path: 'created-then-written.txt', content: 'first version' },
        context,
      )
      expect(write1.success).toBe(true)

      const write2 = await writeFileTool.execute(
        { path: 'created-then-written.txt', content: 'second version' },
        context,
      )

      expect(write2.success).toBe(true)
      expect(write2.output).toContain('Successfully wrote')
    })
  })

  describe('edit_file requires read first', () => {
    it('rejects editing file that was not read', async () => {
      await writeFile(join(testDir, 'edit-me.txt'), 'hello world')

      const result = await editFileTool.execute({ path: 'edit-me.txt', old_string: 'hello', new_string: 'hi' }, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('must be read before writing')
    })

    it('allows editing file after reading', async () => {
      await writeFile(join(testDir, 'edit-me.txt'), 'hello world')

      // Read first
      await readFileTool.execute({ path: 'edit-me.txt' }, context)

      // Edit should succeed
      const result = await editFileTool.execute({ path: 'edit-me.txt', old_string: 'hello', new_string: 'hi' }, context)

      expect(result.success).toBe(true)
      expect(result.output).toContain('Successfully replaced')
    })

    it('allows multiple edits after single read', async () => {
      await writeFile(join(testDir, 'multi-edit.txt'), 'aaa bbb ccc')

      // Read first
      await readFileTool.execute({ path: 'multi-edit.txt' }, context)

      // First edit
      const edit1 = await editFileTool.execute(
        { path: 'multi-edit.txt', old_string: 'aaa', new_string: 'xxx' },
        context,
      )
      expect(edit1.success).toBe(true)

      // Second edit (hash was updated after first edit)
      const edit2 = await editFileTool.execute(
        { path: 'multi-edit.txt', old_string: 'bbb', new_string: 'yyy' },
        context,
      )
      expect(edit2.success).toBe(true)
    })

    it('allows editing a file that was just created with write_file', async () => {
      const writeResult = await writeFileTool.execute(
        { path: 'created-then-edited.txt', content: 'hello world' },
        context,
      )
      expect(writeResult.success).toBe(true)

      const editResult = await editFileTool.execute(
        { path: 'created-then-edited.txt', old_string: 'hello', new_string: 'hi' },
        context,
      )

      expect(editResult.success).toBe(true)
      expect(editResult.output).toContain('Successfully replaced')
    })
  })

  describe('external change detection', () => {
    it('rejects write when file changed externally after read', async () => {
      await writeFile(join(testDir, 'external.txt'), 'original')

      // Read the file
      await readFileTool.execute({ path: 'external.txt' }, context)

      // Simulate external change
      await writeFile(join(testDir, 'external.txt'), 'changed by another process')

      // Write should fail - file hash no longer matches
      const result = await writeFileTool.execute({ path: 'external.txt', content: 'agent update' }, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('must be read before writing')
    })

    it('allows write after re-reading externally changed file', async () => {
      await writeFile(join(testDir, 'external2.txt'), 'original')

      // Read the file
      await readFileTool.execute({ path: 'external2.txt' }, context)

      // Simulate external change
      await writeFile(join(testDir, 'external2.txt'), 'changed externally')

      // Re-read the file
      await readFileTool.execute({ path: 'external2.txt' }, context)

      // Now write should succeed
      const result = await writeFileTool.execute({ path: 'external2.txt', content: 'agent update' }, context)

      expect(result.success).toBe(true)
    })
  })

  describe('readFiles tracking in session', () => {
    it('tracks read files in session execution state', async () => {
      await writeFile(join(testDir, 'tracked.txt'), 'content')

      // Initially no files tracked
      let readFiles = sessionManager.getReadFiles(sessionId)
      expect(Object.keys(readFiles)).toHaveLength(0)

      // Read the file
      await readFileTool.execute({ path: 'tracked.txt' }, context)

      // Now file should be tracked
      readFiles = sessionManager.getReadFiles(sessionId)
      const fullPath = join(testDir, 'tracked.txt')
      const trackedFile = readFiles[fullPath]
      expect(trackedFile).toBeDefined()
      expect(trackedFile?.hash).toBeDefined()
      expect(trackedFile?.readAt).toBeDefined()
    })

    it('updates hash after write', async () => {
      await writeFile(join(testDir, 'update-hash.txt'), 'original')

      // Read
      await readFileTool.execute({ path: 'update-hash.txt' }, context)

      const fullPath = join(testDir, 'update-hash.txt')
      const entryBefore = sessionManager.getReadFiles(sessionId)[fullPath]
      expect(entryBefore).toBeDefined()
      const hashBefore = entryBefore?.hash

      // Write new content
      await writeFileTool.execute({ path: 'update-hash.txt', content: 'new content' }, context)

      // Hash should be updated
      const entryAfter = sessionManager.getReadFiles(sessionId)[fullPath]
      expect(entryAfter).toBeDefined()
      const hashAfter = entryAfter?.hash
      expect(hashAfter).not.toBe(hashBefore)
    })
  })

  describe('cross-workspace read tracking', () => {
    it('allows writing to a file in a new workspace after reading it in the original', async () => {
      const originalDir = join(testDir, 'original')
      const workspaceDir = join(testDir, 'workspace')
      await mkdir(join(originalDir, 'src'), { recursive: true })
      await mkdir(join(workspaceDir, 'src'), { recursive: true })

      const content = 'shared original content'
      await writeFile(join(originalDir, 'src', 'app.ts'), content)
      await writeFile(join(workspaceDir, 'src', 'app.ts'), content)

      // Read in the original workspace
      const originalContext = createTestContext(sessionManager, sessionId, originalDir)
      const readResult = await readFileTool.execute({ path: 'src/app.ts' }, originalContext)
      expect(readResult.success).toBe(true)

      // Switch to the new workspace (same session, different workdir)
      const workspaceContext = createTestContext(sessionManager, sessionId, workspaceDir)
      const writeResult = await writeFileTool.execute(
        { path: 'src/app.ts', content: 'updated content' },
        workspaceContext,
      )

      expect(writeResult.success).toBe(true)
    })

    it('allows editing a file in a new workspace after reading it in the original', async () => {
      const originalDir = join(testDir, 'original')
      const workspaceDir = join(testDir, 'workspace')
      await mkdir(originalDir, { recursive: true })
      await mkdir(workspaceDir, { recursive: true })

      await writeFile(join(originalDir, 'app.ts'), 'hello world')
      await writeFile(join(workspaceDir, 'app.ts'), 'hello world')

      // Read in the original workspace
      const originalContext = createTestContext(sessionManager, sessionId, originalDir)
      const readResult = await readFileTool.execute({ path: 'app.ts' }, originalContext)
      expect(readResult.success).toBe(true)

      // Switch to the new workspace (same session, different workdir)
      const workspaceContext = createTestContext(sessionManager, sessionId, workspaceDir)
      const editResult = await editFileTool.execute(
        { path: 'app.ts', old_string: 'hello', new_string: 'hi' },
        workspaceContext,
      )

      expect(editResult.success).toBe(true)
      expect(editResult.output).toContain('Successfully replaced')
    })

    it('still rejects writing in the new workspace when content differs from what was read', async () => {
      const originalDir = join(testDir, 'original')
      const workspaceDir = join(testDir, 'workspace')
      await mkdir(originalDir, { recursive: true })
      await mkdir(workspaceDir, { recursive: true })

      await writeFile(join(originalDir, 'app.ts'), 'original content')
      await writeFile(join(workspaceDir, 'app.ts'), 'diverged content')

      // Read in the original workspace
      const originalContext = createTestContext(sessionManager, sessionId, originalDir)
      const readResult = await readFileTool.execute({ path: 'app.ts' }, originalContext)
      expect(readResult.success).toBe(true)

      // Switch to the new workspace (same session, different workdir)
      const workspaceContext = createTestContext(sessionManager, sessionId, workspaceDir)
      const writeResult = await writeFileTool.execute({ path: 'app.ts', content: 'agent update' }, workspaceContext)

      expect(writeResult.success).toBe(false)
      // The agent only ever read the original copy; the workspace copy is unknown,
      // so it is a "not read" failure, not an external modification.
      expect(writeResult.error).toContain('Use read_file first')
      expect(writeResult.error).not.toContain('modified externally')
    })
  })
})
