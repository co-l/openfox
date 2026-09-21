import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { computeFileHash } from '../tools/file-tracker.js'
import { preflightPathTool } from './tool-preflight.js'
import type { FileReadEntry } from '../../shared/types.js'

describe('tool-preflight', () => {
  let workdir: string

  beforeEach(async () => {
    workdir = join(tmpdir(), `openfox-preflight-${Date.now()}`)
    await mkdir(workdir, { recursive: true })
  })

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true })
  })

  it('allows new files (not on disk)', async () => {
    const error = await preflightPathTool('src/new.ts', { workdir, readFiles: {} })
    expect(error).toBeUndefined()
  })

  it('allows existing files that were read with matching hash', async () => {
    const file = join(workdir, 'src', 'app.ts')
    await mkdir(join(workdir, 'src'), { recursive: true })
    await writeFile(file, 'content')
    const hash = (await computeFileHash(file))!
    const readFiles: Record<string, FileReadEntry> = {
      [file]: { hash, readAt: new Date().toISOString() },
    }

    const error = await preflightPathTool('src/app.ts', { workdir, readFiles })
    expect(error).toBeUndefined()
  })

  it('rejects existing files that were not read', async () => {
    const file = join(workdir, 'src', 'app.ts')
    await mkdir(join(workdir, 'src'), { recursive: true })
    await writeFile(file, 'content')

    const error = await preflightPathTool('src/app.ts', { workdir, readFiles: {} })
    expect(error).toContain('must be read before writing')
  })

  it('rejects existing files changed externally since read', async () => {
    const file = join(workdir, 'src', 'app.ts')
    await mkdir(join(workdir, 'src'), { recursive: true })
    await writeFile(file, 'original')
    const hash = (await computeFileHash(file))!
    const readFiles: Record<string, FileReadEntry> = {
      [file]: { hash, readAt: new Date().toISOString() },
    }
    await writeFile(file, 'changed externally')

    const error = await preflightPathTool('src/app.ts', { workdir, readFiles })
    expect(error).toContain('modified externally')
  })

  it('resolves absolute paths against the filesystem as-is', async () => {
    const file = join(workdir, 'abs.ts')
    await writeFile(file, 'content')

    const error = await preflightPathTool(file, { workdir, readFiles: {} })
    expect(error).toContain('must be read before writing')
  })
})
