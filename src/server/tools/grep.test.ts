import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { grepTool } from './grep.js'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ToolContext } from './types.js'

describe('grepTool', () => {
  const testDir = join(process.cwd(), 'test-grep-temp')
  
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true })
  })
  
  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('should find matches in files', async () => {
    await writeFile(join(testDir, 'test.txt'), 'hello world\nfoo bar\nhello again\n')
    
    const mockContext: ToolContext = {
      workdir: testDir,
      sessionId: 'test-session',
      sessionManager: {} as any,
    }
    
    const result = await grepTool.execute(
      { pattern: 'hello' },
      mockContext
    )
    
    expect(result.success).toBe(true)
    expect(result.output).toContain('hello world')
    expect(result.output).toContain('hello again')
  })

  it('should find multiple matches on different lines', async () => {
    await writeFile(join(testDir, 'file1.txt'), 'test line 1\ntest line 2\ntest line 3\n')
    await writeFile(join(testDir, 'file2.txt'), 'test line A\ntest line B\n')
    
    const mockContext: ToolContext = {
      workdir: testDir,
      sessionId: 'test-session',
      sessionManager: {} as any,
    }
    
    const result = await grepTool.execute(
      { pattern: 'test' },
      mockContext
    )
    
    expect(result.success).toBe(true)
    expect(result.output).toContain('file1.txt:1:')
    expect(result.output).toContain('file1.txt:2:')
    expect(result.output).toContain('file1.txt:3:')
    expect(result.output).toContain('file2.txt:1:')
    expect(result.output).toContain('file2.txt:2:')
  })

  it('should handle regex patterns correctly', async () => {
    await writeFile(join(testDir, 'regex.txt'), 'foo1\nfoo2\nbar1\nfoo3\n')
    
    const mockContext: ToolContext = {
      workdir: testDir,
      sessionId: 'test-session',
      sessionManager: {} as any,
    }
    
    const result = await grepTool.execute(
      { pattern: 'foo\\d' },
      mockContext
    )
    
    expect(result.success).toBe(true)
    expect(result.output).toContain('foo1')
    expect(result.output).toContain('foo2')
    expect(result.output).toContain('foo3')
    expect(result.output).not.toContain('bar1')
  })

  it('should be case insensitive', async () => {
    await writeFile(join(testDir, 'case.txt'), 'Hello\nHELLO\nhello\nHeLLo\n')
    
    const mockContext: ToolContext = {
      workdir: testDir,
      sessionId: 'test-session',
      sessionManager: {} as any,
    }
    
    const result = await grepTool.execute(
      { pattern: 'hello' },
      mockContext
    )
    
    expect(result.success).toBe(true)
    expect(result.output).toContain('Hello')
    expect(result.output).toContain('HELLO')
    expect(result.output).toContain('hello')
    expect(result.output).toContain('HeLLo')
  })

  it('should handle complex patterns with alternation', async () => {
    await writeFile(join(testDir, 'complex.txt'), 'exportVideo\nprocessJobs\njobService\nstartJob\nother\n')
    
    const mockContext: ToolContext = {
      workdir: testDir,
      sessionId: 'test-session',
      sessionManager: {} as any,
    }
    
    const result = await grepTool.execute(
      { pattern: 'exportVideo|processJobs|jobService|startJob' },
      mockContext
    )
    
    expect(result.success).toBe(true)
    const output = result.output as string
    expect(output).toContain('exportVideo')
    expect(output).toContain('processJobs')
    expect(output).toContain('jobService')
    expect(output).toContain('startJob')
    expect(output).not.toContain('other')
  })

  it('should return no matches when pattern not found', async () => {
    await writeFile(join(testDir, 'empty.txt'), 'nothing here\n')
    
    const mockContext: ToolContext = {
      workdir: testDir,
      sessionId: 'test-session',
      sessionManager: {} as any,
    }
    
    const result = await grepTool.execute(
      { pattern: 'notfound' },
      mockContext
    )
    
    expect(result.success).toBe(true)
    expect(result.output).toBe('No matches found.')
  })

  it('should handle invalid regex patterns', async () => {
    const mockContext: ToolContext = {
      workdir: testDir,
      sessionId: 'test-session',
      sessionManager: {} as any,
    }
    
    const result = await grepTool.execute(
      { pattern: '[invalid' },
      mockContext
    )
    
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid regex pattern')
  })
})
