import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import express from 'express'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createFileSearchRoutes } from './file-search.js'

describe('GET /api/files', () => {
  let app: express.Express
  let server: ReturnType<typeof app.listen>
  let baseUrl: string
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `openfox-file-search-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
    await mkdir(join(testDir, 'src'), { recursive: true })
    await writeFile(join(testDir, 'README.md'), '# Test')
    await writeFile(join(testDir, 'package.json'), '{}')
    await writeFile(join(testDir, 'src', 'index.ts'), 'export {}')
    await writeFile(join(testDir, 'src', 'utils.ts'), 'export {}')

    app = express()
    app.use('/api/files', createFileSearchRoutes())

    return new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${(server.address() as any).port}`
        resolve()
      })
    })
  })

  afterEach(async () => {
    server?.close()
    await rm(testDir, { recursive: true, force: true })
  })

  it('returns files matching an exact filename', async () => {
    const res = await fetch(`${baseUrl}/api/files?q=README.md&workdir=${encodeURIComponent(testDir)}`)
    expect(res.status).toBe(200)
    const results = (await res.json()) as Array<{ name: string; type: string; score: number }>
    expect(results.length).toBeGreaterThan(0)
    const first = results[0]!
    expect(first.name).toBe('README.md')
    expect(first.type).toBe('file')
    expect(first.score).toBe(100)
  })

  it('returns files matching a partial name', async () => {
    const res = await fetch(`${baseUrl}/api/files?q=package&workdir=${encodeURIComponent(testDir)}`)
    expect(res.status).toBe(200)
    const results = (await res.json()) as Array<{ name: string; score: number }>
    expect(results.length).toBeGreaterThan(0)
    const first = results[0]!
    expect(first.name).toBe('package.json')
    expect(first.score).toBeGreaterThanOrEqual(60)
  })

  it('returns directories with a higher score than files', async () => {
    const res = await fetch(`${baseUrl}/api/files?q=src&workdir=${encodeURIComponent(testDir)}`)
    expect(res.status).toBe(200)
    const results = (await res.json()) as Array<{ name: string; type: string; score: number }>
    expect(results.length).toBeGreaterThan(0)
    const first = results[0]!
    expect(first.name).toBe('src')
    expect(first.type).toBe('directory')
    expect(first.score).toBe(110)
  })

  it('returns empty array for non-matching query', async () => {
    const res = await fetch(`${baseUrl}/api/files?q=nonexistent&workdir=${encodeURIComponent(testDir)}`)
    expect(res.status).toBe(200)
    const results = (await res.json()) as Array<unknown>
    expect(results.length).toBe(0)
  })

  it('returns results for empty query so the user can navigate rather than type', async () => {
    const res = await fetch(`${baseUrl}/api/files?q=&workdir=${encodeURIComponent(testDir)}`)
    expect(res.status).toBe(200)
    const results = (await res.json()) as Array<{ type: string; score: number }>
    expect(results.length).toBeGreaterThan(0)
  })

  it('returns results sorted by score (highest first)', async () => {
    const res = await fetch(`${baseUrl}/api/files?q=ts&workdir=${encodeURIComponent(testDir)}`)
    expect(res.status).toBe(200)
    const results = (await res.json()) as Array<{ score: number }>
    expect(results.length).toBeGreaterThan(0)

    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.score).toBeLessThanOrEqual(results[i - 1]!.score)
    }
  })

  it('returns paths relative to workdir', async () => {
    const res = await fetch(`${baseUrl}/api/files?q=index&workdir=${encodeURIComponent(testDir)}`)
    expect(res.status).toBe(200)
    const results = (await res.json()) as Array<{ path: string }>
    expect(results.length).toBeGreaterThan(0)
    const first = results[0]!
    expect(first.path).toContain('src')
    expect(first.path).toContain('index.ts')
  })

  it('ignores node_modules by default', async () => {
    const nodeModulesDir = join(testDir, 'node_modules')
    await mkdir(nodeModulesDir, { recursive: true })
    await writeFile(join(nodeModulesDir, 'index.ts'), 'export {}')

    const res = await fetch(`${baseUrl}/api/files?q=index&workdir=${encodeURIComponent(testDir)}`)
    expect(res.status).toBe(200)
    const results = (await res.json()) as Array<{ path: string }>

    const nodeModulePaths = results.filter((r) => r.path.includes('node_modules'))
    expect(nodeModulePaths.length).toBe(0)
  })
})
