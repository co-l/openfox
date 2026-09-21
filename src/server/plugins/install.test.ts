import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installPluginFromPath, parseGithubUrl } from './install.js'

describe('parseGithubUrl', () => {
  it('accepts the plain repository URL', () => {
    expect(parseGithubUrl('https://github.com/user/repo')).toEqual({
      owner: 'user',
      repo: 'repo',
      cloneUrl: 'https://github.com/user/repo.git',
    })
  })

  it('normalizes a trailing .git', () => {
    expect(parseGithubUrl('https://github.com/user/repo.git').cloneUrl).toBe('https://github.com/user/repo.git')
  })

  it('normalizes a trailing slash', () => {
    expect(parseGithubUrl('https://github.com/user/repo/').cloneUrl).toBe('https://github.com/user/repo.git')
  })

  it('normalizes a tree/branch URL copied from the GitHub UI', () => {
    expect(parseGithubUrl('https://github.com/user/repo/tree/main')).toEqual({
      owner: 'user',
      repo: 'repo',
      cloneUrl: 'https://github.com/user/repo.git',
    })
  })

  it('rejects non-GitHub URLs and unsafe repository names', () => {
    expect(() => parseGithubUrl('https://example.com/user/repo')).toThrow('Invalid GitHub URL')
    expect(() => parseGithubUrl('https://github.com/user/repo<script>')).toThrow('Invalid repository name')
  })
})

describe('installPluginFromPath', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'openfox-plugin-install-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('copies the plugin and skips node_modules and .git', async () => {
    const source = join(root, 'source-plugin')
    await mkdir(join(source, 'node_modules', 'dep'), { recursive: true })
    await mkdir(join(source, '.git'), { recursive: true })
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'source-plugin', version: '1.0.0' }))
    await writeFile(join(source, 'index.js'), 'export function register() {}')

    const pluginsDir = join(root, 'plugins')
    const target = await installPluginFromPath(source, pluginsDir)

    expect(target).toBe(join(pluginsDir, 'source-plugin'))
    const entries = await readdir(target)
    expect(entries).toContain('index.js')
    expect(entries).not.toContain('node_modules')
    expect(entries).not.toContain('.git')
  })
})
