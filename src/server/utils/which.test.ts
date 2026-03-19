import { mkdtemp, rm, writeFile, chmod, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { which } from './which.js'

describe('which', () => {
  let workdir: string
  let pathDir: string
  let oldPath: string | undefined

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'openfox-which-workdir-'))
    pathDir = await mkdtemp(join(tmpdir(), 'openfox-which-path-'))
    oldPath = process.env['PATH']
  })

  afterEach(async () => {
    process.env['PATH'] = oldPath
    await rm(workdir, { recursive: true, force: true })
    await rm(pathDir, { recursive: true, force: true })
  })

  it('prefers absolute paths, then project-local bins, then PATH', async () => {
    const absolute = join(pathDir, 'absolute-cmd')
    await writeFile(absolute, '#!/bin/sh\nexit 0\n')
    await chmod(absolute, 0o755)

    const projectBinDir = join(workdir, 'node_modules', '.bin')
    await mkdir(projectBinDir, { recursive: true })
    const projectCmd = join(projectBinDir, 'project-cmd')
    await writeFile(projectCmd, '#!/bin/sh\nexit 0\n')
    await chmod(projectCmd, 0o755)

    const pathCmd = join(pathDir, 'path-cmd')
    await writeFile(pathCmd, '#!/bin/sh\nexit 0\n')
    await chmod(pathCmd, 0o755)
    process.env['PATH'] = pathDir

    expect(await which(absolute)).toBe(absolute)
    expect(await which('project-cmd', workdir)).toBe(projectCmd)
    expect(await which('path-cmd')).toBe(pathCmd)
    expect(await which('missing-cmd', workdir)).toBeNull()
    expect(await which('/missing/absolute')).toBeNull()
  })
})
