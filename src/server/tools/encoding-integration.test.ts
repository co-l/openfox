import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileTool } from './read.js'
import { editFileTool } from './edit.js'
import { writeFileTool } from './write.js'
import type { ToolContext } from './types.js'
import { SessionManager } from '../session/manager.js'
import { initDatabase, closeDatabase, getDatabase } from '../db/index.js'
import { initEventStore } from '../events/index.js'
import type { Config } from '../../shared/types.js'
import * as iconv from 'iconv-lite'

const mockProviderManager = {
  getCurrentModelContext: () => 200000,
}

function createTestContext(sessionManager: SessionManager, sessionId: string, workdir: string): ToolContext {
  return {
    sessionManager,
    sessionId,
    workdir,
  }
}

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

describe('encoding integration', () => {
  let testDir: string
  let sessionId: string
  let context: ToolContext
  let sessionManager: SessionManager

  beforeEach(async () => {
    initDatabase(createTestConfig())
    initEventStore(getDatabase())

    testDir = join(tmpdir(), `openfox-encoding-test-${Date.now()}`)
    await rm(testDir, { recursive: true, force: true })
    await mkdir(testDir, { recursive: true })

    sessionManager = new SessionManager(mockProviderManager as any)
    const { createProject } = await import('../db/projects.js')
    const project = createProject('test-project', testDir)
    const session = sessionManager.createSession(project.id)
    sessionId = session.id
    context = createTestContext(sessionManager, sessionId, testDir)
  })

  afterEach(async () => {
    closeDatabase()
    await rm(testDir, { recursive: true, force: true })
  })

  describe('read_file encoding detection', () => {
    it('detects UTF-8 and returns encoding in metadata', async () => {
      const filePath = join(testDir, 'utf8.txt')
      await writeFile(filePath, 'hello world', 'utf-8')

      const result = await readFileTool.execute({ path: filePath }, context)
      expect(result.success).toBe(true)
      expect(result.metadata).toBeDefined()
      expect(result.metadata?.['encoding']).toBe('utf-8')
      expect(result.metadata?.['confidence']).toBeGreaterThan(0)
    })

    it('detects non-UTF-8 encoded files and decodes without replacement chars', async () => {
      const filePath = join(testDir, 'nonutf8.txt')
      // Windows-1252 encoded smart quotes and em-dash
      const buf = Buffer.from([0x93, 0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x94, 0x20, 0x97])
      await writeFile(filePath, buf)

      const result = await readFileTool.execute({ path: filePath }, context)
      expect(result.success).toBe(true)
      expect(result.metadata?.['encoding']).not.toBe('utf-8')
      // Should decode without replacement characters
      expect(result.output).not.toContain('\ufffd')
      expect(result.output).toContain('\u201c')
    })

    it('detects UTF-16 with BOM', async () => {
      const filePath = join(testDir, 'utf16.txt')
      const content = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hello', 'utf-16le')])
      await writeFile(filePath, content)

      const result = await readFileTool.execute({ path: filePath }, context)
      expect(result.success).toBe(true)
      expect(result.metadata?.['encoding']).toBe('utf-16le')
      expect(result.output).toContain('hello')
    })

    it('detects UTF-8 with BOM', async () => {
      const filePath = join(testDir, 'utf8bom.txt')
      const content = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hello', 'utf-8')])
      await writeFile(filePath, content)

      const result = await readFileTool.execute({ path: filePath }, context)
      expect(result.success).toBe(true)
      expect(result.metadata?.['encoding']).toBe('utf-8')
      // BOM should be stripped from output
      expect(result.output).toContain('hello')
      expect(result.metadata?.['startLine']).toBe(1)
    })
  })

  describe('edit_file encoding preservation', () => {
    it('preserves UTF-8 encoding through edit', async () => {
      const filePath = join(testDir, 'edit-utf8.txt')
      await writeFile(filePath, 'line1\nline2\nline3', 'utf-8')

      await readFileTool.execute({ path: filePath }, context)
      const result = await editFileTool.execute(
        { path: filePath, old_string: 'line2', new_string: 'MODIFIED' },
        context,
      )

      expect(result.success).toBe(true)
      expect(result.metadata).toBeDefined()
      expect(result.metadata?.['path']).toBe(filePath)
      const content = await readFile(filePath, 'utf-8')
      expect(content).toBe('line1\nMODIFIED\nline3')
    })

    it('preserves ISO-8859-1 encoding through edit', async () => {
      const filePath = join(testDir, 'edit-latin1.txt')
      // Write Latin-1 content: "café naïve" in ISO-8859-1
      const originalBuf = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x6e, 0x61, 0xef, 0x76, 0x65])
      await writeFile(filePath, originalBuf)

      await readFileTool.execute({ path: filePath }, context)
      const result = await editFileTool.execute({ path: filePath, old_string: 'café', new_string: 'CAFÉ' }, context)

      expect(result.success).toBe(true)
      const editedBuf = await readFile(filePath)
      // Should still be Latin-1 encoded: CAFÉ naïve
      expect(editedBuf).toEqual(Buffer.from([0x43, 0x41, 0x46, 0xc9, 0x20, 0x6e, 0x61, 0xef, 0x76, 0x65]))
    })

    it('preserves UTF-16 LE encoding through edit', async () => {
      const filePath = join(testDir, 'edit-utf16.txt')
      const original = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hello\nworld', 'utf-16le')])
      await writeFile(filePath, original)

      await readFileTool.execute({ path: filePath }, context)
      const result = await editFileTool.execute({ path: filePath, old_string: 'hello', new_string: 'HELLO' }, context)

      expect(result.success).toBe(true)
      const editedBuf = await readFile(filePath)
      // Should still have UTF-16 BOM
      expect(editedBuf[0]).toBe(0xff)
      expect(editedBuf[1]).toBe(0xfe)
      // Content should be HELLO\nworld in UTF-16 LE with BOM preserved
      const decoded = editedBuf.toString('utf-16le')
      expect(decoded).toBe('\ufeffHELLO\nworld')
    })

    it('preserves line endings alongside encoding', async () => {
      const filePath = join(testDir, 'edit-crlf-latin1.txt')
      // CRLF + Latin-1: "é\nà\nç" with CRLF
      const originalBuf = Buffer.from([0xe9, 0x0d, 0x0a, 0xe0, 0x0d, 0x0a, 0xe7])
      await writeFile(filePath, originalBuf)

      await readFileTool.execute({ path: filePath }, context)
      const result = await editFileTool.execute({ path: filePath, old_string: 'à', new_string: 'Ä' }, context)

      expect(result.success).toBe(true)
      const editedBuf = await readFile(filePath)
      // Should still have CRLF
      expect(editedBuf).toEqual(Buffer.from([0xe9, 0x0d, 0x0a, 0xc4, 0x0d, 0x0a, 0xe7]))
    })

    it('preserves Shift-JIS encoding through edit', async () => {
      const filePath = join(testDir, 'edit-shiftjis.txt')
      const originalText = '日本語のテスト文章です。編集テストを行います。'
      const originalBuf = iconv.encode(originalText, 'Shift_JIS')
      await writeFile(filePath, originalBuf)

      await readFileTool.execute({ path: filePath }, context)
      const result = await editFileTool.execute(
        { path: filePath, old_string: 'テスト文章', new_string: 'チェック文章' },
        context,
      )

      expect(result.success).toBe(true)
      const editedBuf = await readFile(filePath)
      const decoded = iconv.decode(editedBuf, 'Shift_JIS')
      expect(decoded).toBe('日本語のチェック文章です。編集テストを行います。')
    })
  })

  describe('write_file encoding support', () => {
    it('writes UTF-8 by default', async () => {
      const filePath = join(testDir, 'write-default.txt')
      const result = await writeFileTool.execute({ path: filePath, content: 'hello world' }, context)

      expect(result.success).toBe(true)
      expect(result.metadata).toBeDefined()
      expect(result.metadata?.['path']).toBe(filePath)
      const buf = await readFile(filePath)
      expect(buf.toString('utf-8')).toBe('hello world')
    })

    it('writes ISO-8859-1 when encoding is specified', async () => {
      const filePath = join(testDir, 'write-latin1.txt')
      const result = await writeFileTool.execute(
        { path: filePath, content: 'café naïve', encoding: 'ISO-8859-1' },
        context,
      )

      expect(result.success).toBe(true)
      const buf = await readFile(filePath)
      // Verify it's Latin-1 encoded, not UTF-8
      expect(buf).toEqual(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x6e, 0x61, 0xef, 0x76, 0x65]))
    })

    it('writes windows-1252 when encoding is specified', async () => {
      const filePath = join(testDir, 'write-w1252.txt')
      const result = await writeFileTool.execute(
        { path: filePath, content: '\u201cHello\u201d', encoding: 'windows-1252' },
        context,
      )

      expect(result.success).toBe(true)
      const buf = await readFile(filePath)
      expect(buf).toEqual(Buffer.from([0x93, 0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x94]))
    })

    it('writes UTF-16 LE when encoding is specified', async () => {
      const filePath = join(testDir, 'write-utf16.txt')
      const result = await writeFileTool.execute({ path: filePath, content: 'hello', encoding: 'utf-16le' }, context)

      expect(result.success).toBe(true)
      const buf = await readFile(filePath)
      expect(buf.toString('utf-16le')).toBe('hello')
    })
  })

  describe('full round-trip: read → edit → write', () => {
    it('preserves windows-1252 through read → edit → write cycle', async () => {
      const filePath = join(testDir, 'roundtrip-w1252.txt')
      // "Hello" with smart quotes in windows-1252
      const originalBuf = Buffer.from([0x93, 0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x94, 0x0a, 0x48, 0x69])
      await writeFile(filePath, originalBuf)

      // Read it
      const readResult = await readFileTool.execute({ path: filePath }, context)
      expect(readResult.metadata?.['encoding']).toBeDefined()
      const encoding = readResult.metadata?.['encoding'] as string

      // Edit it
      await editFileTool.execute({ path: filePath, old_string: 'Hello', new_string: 'HELLO' }, context)

      // Read again
      const readResult2 = await readFileTool.execute({ path: filePath }, context)
      expect(readResult2.metadata?.['encoding']).toBe(encoding)
      expect(readResult2.output).toContain('HELLO')
      expect(readResult2.output).not.toContain('\ufffd')

      // Write a new file with same encoding
      const newFilePath = join(testDir, 'roundtrip-new.txt')
      await writeFileTool.execute({ path: newFilePath, content: '\u201cHELLO\u201d', encoding }, context)

      const readResult3 = await readFileTool.execute({ path: newFilePath }, context)
      expect(readResult3.metadata?.['encoding']).toBe(encoding)
    })
  })
})
