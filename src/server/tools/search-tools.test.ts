import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { globTool } from './glob.js'
import { grepTool } from './grep.js'

describe('search tools', () => {
  let workdir: string

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'openfox-search-tools-'))
    await mkdir(join(workdir, 'src'))
    await mkdir(join(workdir, 'src', 'nested'))
    await writeFile(join(workdir, 'src', 'alpha.ts'), 'const alpha = 1\nconst beta = 2\n')
    await writeFile(join(workdir, 'src', 'nested', 'beta.ts'), 'function alpha() {}\nalpha()\n')
    await writeFile(join(workdir, 'notes.txt'), 'alpha in notes\n')
  })

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true })
  })

  it('finds files with glob and reports truncation status', async () => {
    const result = await globTool.execute({ pattern: 'src/**/*.ts' }, {
      workdir,
      sessionId: 'session-1',
      sessionManager: {} as never,
    })

    expect(result).toMatchObject({ success: true, truncated: false })
    expect(result.output).toContain('src/alpha.ts')
    expect(result.output).toContain('src/nested/beta.ts')
    expect(result.output).toContain('[2 file(s) found]')
  })

  it('glob returns structured metadata with pattern, totalFound, shownCount, and truncated', async () => {
    const result = await globTool.execute({ pattern: 'src/**/*.ts' }, {
      workdir,
      sessionId: 'session-1',
      sessionManager: {} as never,
    })

    expect(result.success).toBe(true)
    expect(result.metadata).toBeDefined()
    expect(result.metadata).toMatchObject({
      pattern: 'src/**/*.ts',
      totalFound: 2,
      shownCount: 2,
      truncated: false,
    })
  })

  it('glob metadata includes cwd when provided', async () => {
    const result = await globTool.execute({ pattern: '*.ts', cwd: 'src' }, {
      workdir,
      sessionId: 'session-1',
      sessionManager: {} as never,
    })

    expect(result.success).toBe(true)
    expect(result.metadata).toBeDefined()
    expect(result.metadata).toMatchObject({
      pattern: '*.ts',
      cwd: 'src',
      totalFound: 1,
      shownCount: 1,
      truncated: false,
    })
  })

  it('greps matching files, validates regex, and reports no matches', async () => {
    const context = { workdir, sessionId: 'session-1', sessionManager: {} as never }

    const matches = await grepTool.execute({ pattern: 'alpha', include: '**/*.ts', cwd: 'src' }, context)
    expect(matches).toMatchObject({ success: true, truncated: false })
    expect(matches.output).toContain('alpha.ts:1: const alpha = 1')
    expect(matches.output).toContain('nested/beta.ts:1: function alpha() {}')
    expect(matches.output).toContain('[3 match(es) found]')

    await expect(grepTool.execute({ pattern: '[', cwd: 'src' }, context)).resolves.toMatchObject({ success: false, error: 'Invalid regex pattern: [' })
    await expect(grepTool.execute({ pattern: 'missing', cwd: 'src' }, context)).resolves.toMatchObject({ success: true, output: 'No matches found.' })
  })

  it('grep returns structured metadata with pattern, totalMatches, shownCount, and truncated', async () => {
    const context = { workdir, sessionId: 'session-1', sessionManager: {} as never }
    const result = await grepTool.execute({ pattern: 'alpha', include: '**/*.ts' }, context)

    expect(result.success).toBe(true)
    expect(result.metadata).toBeDefined()
    expect(result.metadata).toMatchObject({
      pattern: 'alpha',
      totalMatches: 3,
      shownCount: 3,
      truncated: false,
    })
  })

  it('grep metadata includes include and cwd when provided', async () => {
    const context = { workdir, sessionId: 'session-1', sessionManager: {} as never }
    const result = await grepTool.execute({ pattern: 'alpha', include: '**/*.ts', cwd: 'src' }, context)

    expect(result.success).toBe(true)
    expect(result.metadata).toBeDefined()
    expect(result.metadata).toMatchObject({
      pattern: 'alpha',
      include: '**/*.ts',
      cwd: 'src',
      totalMatches: 3,
      shownCount: 3,
      truncated: false,
    })
  })
})
