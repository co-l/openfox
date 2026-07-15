import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { installSkillPackage } from './installer.js'

let libraryDir: string

beforeEach(async () => {
  libraryDir = await mkdtemp(join(tmpdir(), 'openfox-skill-library-'))
})

afterEach(async () => {
  await rm(libraryDir, { recursive: true, force: true })
})

describe('installSkillPackage', () => {
  it('installs a portable package with nested binary assets', async () => {
    const binary = Buffer.from([0, 1, 2, 255])

    const installed = await installSkillPackage(libraryDir, 'image-tools', [
      {
        path: 'SKILL.md',
        content: Buffer.from('---\nname: image-tools\ndescription: Image tools\n---\n\nUse assets/template.bin.'),
      },
      { path: 'assets/template.bin', content: binary },
    ])

    expect(installed.id).toBe('image-tools')
    expect(await readFile(join(libraryDir, 'image-tools', 'assets', 'template.bin'))).toEqual(binary)
  })

  it('rejects duplicate relative paths before writing the package', async () => {
    await expect(
      installSkillPackage(libraryDir, 'duplicate-paths', [
        {
          path: 'SKILL.md',
          content: Buffer.from('---\nname: duplicate-paths\ndescription: Duplicate\n---\n\nInstructions.'),
        },
        { path: 'SKILL.md', content: Buffer.from('replacement') },
      ]),
    ).rejects.toMatchObject({ status: 400, message: 'Duplicate package path: SKILL.md' })
  })

  it('rejects traversal outside the package', async () => {
    await expect(
      installSkillPackage(libraryDir, 'unsafe', [
        {
          path: 'SKILL.md',
          content: Buffer.from('---\nname: unsafe\ndescription: Unsafe\n---\n\nInstructions.'),
        },
        { path: '../outside.txt', content: Buffer.from('unsafe') },
      ]),
    ).rejects.toMatchObject({ status: 400 })
    await expect(readFile(join(libraryDir, 'outside.txt'))).rejects.toThrow()
  })

  it('rejects NUL bytes in package paths and names', async () => {
    const skill = {
      path: 'SKILL.md',
      content: Buffer.from('---\nname: unsafe\ndescription: Unsafe\n---\n\nInstructions.'),
    }

    await expect(installSkillPackage(libraryDir, 'unsafe\0name', [skill])).rejects.toMatchObject({ status: 400 })
    await expect(
      installSkillPackage(libraryDir, 'unsafe', [skill, { path: 'assets/unsafe\0.bin', content: Buffer.from('x') }]),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects conflicts without changing the existing package', async () => {
    const destination = join(libraryDir, 'existing')
    await mkdir(destination)
    await writeFile(join(destination, 'keep.txt'), 'keep')

    await expect(
      installSkillPackage(libraryDir, 'existing', [
        {
          path: 'SKILL.md',
          content: Buffer.from('---\nname: existing\ndescription: Existing\n---\n\nInstructions.'),
        },
      ]),
    ).rejects.toMatchObject({ status: 409 })
    expect(await readFile(join(destination, 'keep.txt'), 'utf-8')).toBe('keep')
  })
})
