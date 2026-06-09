import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import express from 'express'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDirectoryRoutes } from './directories.js'

describe('GET /api/directories', () => {
  let app: express.Express
  let server: ReturnType<typeof app.listen>
  let baseUrl: string
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `openfox-dir-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
    await mkdir(join(testDir, 'visible'), { recursive: true })
    await mkdir(join(testDir, '.hidden'), { recursive: true })
    await writeFile(join(testDir, 'visible', 'file.txt'), 'hello')
    await writeFile(join(testDir, '.hidden', 'secret.txt'), 'shh')

    app = express()
    app.use('/api/directories', createDirectoryRoutes())

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

  it('returns visible directories', async () => {
    const res = await fetch(`${baseUrl}/api/directories?path=${encodeURIComponent(testDir)}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { directories: Array<{ name: string }> }
    const names = body.directories.map((d) => d.name)
    expect(names).toContain('visible')
  })

  it('returns hidden directories (dotfiles)', async () => {
    const res = await fetch(`${baseUrl}/api/directories?path=${encodeURIComponent(testDir)}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { directories: Array<{ name: string }> }
    const names = body.directories.map((d) => d.name)
    expect(names).toContain('.hidden')
  })
})
