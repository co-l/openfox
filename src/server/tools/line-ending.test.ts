import { describe, it, expect } from 'vitest'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

interface TestFile {
  path: string
  cleanup: () => Promise<void>
}

async function createTestFile(content: string): Promise<TestFile> {
  const dir = join(tmpdir(), `openfox-test-${randomUUID()}`)
  await mkdir(dir, { recursive: true })
  const filePath = join(dir, 'test.txt')
  await writeFile(filePath, content, 'utf-8')
  return {
    path: filePath,
    async cleanup() {
      const { rm } = await import('node:fs/promises')
      await rm(dir, { recursive: true, force: true })
    },
  }
}

function detectLineEnding(content: string): 'crlf' | 'lf' | 'cr' {
  if (content.includes('\r\n')) return 'crlf'
  if (content.includes('\n')) return 'lf'
  if (content.includes('\r')) return 'cr'
  return 'lf'
}

function normalizeToLF(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function restoreOriginalLineEndings(content: string, fileLineEnding: 'crlf' | 'lf' | 'cr'): string {
  if (fileLineEnding === 'crlf') {
    return content.replace(/\n/g, '\r\n')
  }
  if (fileLineEnding === 'cr') {
    return content.replace(/\n/g, '\r')
  }
  return content
}

describe('Line Ending Normalization', () => {
  describe('detectLineEnding', () => {
    it('detects CRLF when file has windows line endings', async () => {
      const file = await createTestFile('line1\r\nline2\r\nline3\r\n')
      const content = await readFile(file.path, 'utf-8')
      expect(detectLineEnding(content)).toBe('crlf')
      await file.cleanup()
    })

    it('detects LF when file has unix line endings', async () => {
      const file = await createTestFile('line1\nline2\nline3\n')
      const content = await readFile(file.path, 'utf-8')
      expect(detectLineEnding(content)).toBe('lf')
      await file.cleanup()
    })

    it('detects CR when file has classic mac line endings', async () => {
      const file = await createTestFile('line1\rline2\rline3\r')
      const content = await readFile(file.path, 'utf-8')
      expect(detectLineEnding(content)).toBe('cr')
      await file.cleanup()
    })
  })

  describe('normalizeToLF', () => {
    it('converts CRLF to LF', () => {
      const content = 'line1\r\nline2\r\nline3\r\n'
      expect(normalizeToLF(content)).toBe('line1\nline2\nline3\n')
    })

    it('converts CR to LF', () => {
      const content = 'line1\rline2\rline3\r'
      expect(normalizeToLF(content)).toBe('line1\nline2\nline3\n')
    })

    it('keeps LF as LF', () => {
      const content = 'line1\nline2\nline3\n'
      expect(normalizeToLF(content)).toBe('line1\nline2\nline3\n')
    })

    it('preserves other characters', () => {
      const content = '\tprotected $oSDecideurBAPLitige;\r\n  public $other;\r\n'
      expect(normalizeToLF(content)).toBe('\tprotected $oSDecideurBAPLitige;\n  public $other;\n')
    })
  })

  describe('restoreOriginalLineEndings', () => {
    it('converts LF to CRLF for CRLF files', () => {
      const content = 'line1\nline2\nline3\n'
      expect(restoreOriginalLineEndings(content, 'crlf')).toBe('line1\r\nline2\r\nline3\r\n')
    })

    it('keeps LF for LF files', () => {
      const content = 'line1\nline2\nline3\n'
      expect(restoreOriginalLineEndings(content, 'lf')).toBe('line1\nline2\nline3\n')
    })

    it('converts LF to CR for old mac files', () => {
      const content = 'line1\nline2\n'
      expect(restoreOriginalLineEndings(content, 'cr')).toBe('line1\rline2\r')
    })

    it('preserves tabs', () => {
      const content = '\tprotected $oSDecideurBAPLitige;\n'
      expect(restoreOriginalLineEndings(content, 'crlf')).toBe('\tprotected $oSDecideurBAPLitige;\r\n')
    })
  })

  describe('end-to-end edit workflow', () => {
    it('preserves CRLF when editing a CRLF file', async () => {
      const original = 'line1\r\nline2\r\nline3\r\n'
      const file = await createTestFile(original)

      const content = await readFile(file.path, 'utf-8')
      const fileLineEnding = detectLineEnding(content)

      const normalizedContent = normalizeToLF(content)
      const oldString = 'line2'
      const newString = 'NEW_LINE2'

      const newContent = normalizedContent.replace(oldString, newString)
      const restoredContent = restoreOriginalLineEndings(newContent, fileLineEnding)

      await writeFile(file.path, restoredContent, 'utf-8')
      const result = await readFile(file.path, 'utf-8')

      expect(result).toBe('line1\r\nNEW_LINE2\r\nline3\r\n')
      await file.cleanup()
    })

    it('preserves CRLF when editing multi-line in CRLF file', async () => {
      const original = 'class Foo {\r\n  public $prop;\r\n  public $other;\r\n}'
      const file = await createTestFile(original)

      const content = await readFile(file.path, 'utf-8')
      const fileLineEnding = detectLineEnding(content)

      const normalizedContent = normalizeToLF(content)
      const oldString = '  public $other;'
      const newString = '  public $newProp;'

      const newContent = normalizedContent.replace(oldString, newString)
      const restoredContent = restoreOriginalLineEndings(newContent, fileLineEnding)

      await writeFile(file.path, restoredContent, 'utf-8')
      const result = await readFile(file.path, 'utf-8')

      expect(result).toBe('class Foo {\r\n  public $prop;\r\n  public $newProp;\r\n}')
      await file.cleanup()
    })

    it('preserves LF when editing a LF file', async () => {
      const original = 'line1\nline2\nline3\n'
      const file = await createTestFile(original)

      const content = await readFile(file.path, 'utf-8')
      const fileLineEnding = detectLineEnding(content)

      const normalizedContent = normalizeToLF(content)
      const oldString = 'line2'
      const newString = 'NEW_LINE2'

      const newContent = normalizedContent.replace(oldString, newString)
      const restoredContent = restoreOriginalLineEndings(newContent, fileLineEnding)

      await writeFile(file.path, restoredContent, 'utf-8')
      const result = await readFile(file.path, 'utf-8')

      expect(result).toBe('line1\nNEW_LINE2\nline3\n')
      await file.cleanup()
    })

    it('handles replace_all with CRLF', async () => {
      const original = 'foo\r\nfoo\r\nfoo\r\n'
      const file = await createTestFile(original)

      const content = await readFile(file.path, 'utf-8')
      const fileLineEnding = detectLineEnding(content)

      const normalizedContent = normalizeToLF(content)
      const oldString = 'foo'
      const newString = 'bar'

      const newContent = normalizedContent.replaceAll(oldString, newString)
      const restoredContent = restoreOriginalLineEndings(newContent, fileLineEnding)

      await writeFile(file.path, restoredContent, 'utf-8')
      const result = await readFile(file.path, 'utf-8')

      expect(result).toBe('bar\r\nbar\r\nbar\r\n')
      await file.cleanup()
    })

    it('handles pattern with embedded newlines in CRLF file', async () => {
      const original = 'line1\r\nline2\r\nline3\r\n'
      const file = await createTestFile(original)

      const content = await readFile(file.path, 'utf-8')
      const fileLineEnding = detectLineEnding(content)

      const normalizedContent = normalizeToLF(content)
      const oldString = 'line1\nline2'
      const newString = 'LINE1_AND_LINE2'

      const newContent = normalizedContent.replace(oldString, newString)
      const restoredContent = restoreOriginalLineEndings(newContent, fileLineEnding)

      await writeFile(file.path, restoredContent, 'utf-8')
      const result = await readFile(file.path, 'utf-8')

      expect(result).toBe('LINE1_AND_LINE2\r\nline3\r\n')
      await file.cleanup()
    })

    it('preserves CR when editing a CR file', async () => {
      const original = 'line1\rline2\rline3\r'
      const file = await createTestFile(original)

      const content = await readFile(file.path, 'utf-8')
      const fileLineEnding = detectLineEnding(content)

      const normalizedContent = normalizeToLF(content)
      const oldString = 'line2'
      const newString = 'NEW_LINE2'

      const newContent = normalizedContent.replace(oldString, newString)
      const restoredContent = restoreOriginalLineEndings(newContent, fileLineEnding)

      await writeFile(file.path, restoredContent, 'utf-8')
      const result = await readFile(file.path, 'utf-8')

      expect(result).toBe('line1\rNEW_LINE2\rline3\r')
      await file.cleanup()
    })

    it('handles no newline at end of file', async () => {
      const original = 'line1\r\nline2\r\nline3'
      const file = await createTestFile(original)

      const content = await readFile(file.path, 'utf-8')
      const fileLineEnding = detectLineEnding(content)

      const normalizedContent = normalizeToLF(content)
      const oldString = 'line2'
      const newString = 'NEW_LINE2'

      const newContent = normalizedContent.replace(oldString, newString)
      const restoredContent = restoreOriginalLineEndings(newContent, fileLineEnding)

      await writeFile(file.path, restoredContent, 'utf-8')
      const result = await readFile(file.path, 'utf-8')

      expect(result).toBe('line1\r\nNEW_LINE2\r\nline3')
      await file.cleanup()
    })
  })
})