import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('../db/settings.js', () => {
  const store = new Map<string, string>()
  return {
    getSetting: (key: string) => store.get(key) ?? null,
    setSetting: (key: string, value: string) => store.set(key, value),
    deleteSetting: (key: string) => store.delete(key),
    __store: store,
  }
})

import { createSkillRoutes } from './skills.js'

const settings = ((await import('../db/settings.js')) as unknown as { __store: Map<string, string> }).__store

describe('skill library routes', () => {
  let rootDir: string
  let server: ReturnType<express.Express['listen']>
  let baseUrl: string

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'openfox-skill-routes-'))
    settings.clear()
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/skills', createSkillRoutes(join(rootDir, 'config'), join(rootDir, 'project')))
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${(server.address() as { port: number }).port}`
        resolve()
      })
    })
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(rootDir, { recursive: true, force: true })
  })

  it('selects one external library and returns its skills', async () => {
    const library = join(rootDir, 'selected skills')
    await mkdir(join(library, 'portable'), { recursive: true })
    await writeFile(
      join(library, 'portable', 'SKILL.md'),
      '---\nname: portable\ndescription: Portable skill\n---\n\nDo portable work.',
    )

    const selected = await fetch(`${baseUrl}/api/skills/library`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: library }),
    })
    expect(selected.status).toBe(200)

    const response = await fetch(`${baseUrl}/api/skills`)
    const body = (await response.json()) as {
      selectedDirectory: { configuredPath: string; resolvedPath: string } | null
      items: Array<{ id: string; source: string; readOnly: boolean }>
      defaults: unknown[]
      userItems: unknown[]
      projectItems: unknown[]
    }
    expect(body.selectedDirectory?.configuredPath).toBe(library)
    expect(body.items).toContainEqual(expect.objectContaining({ id: 'portable', source: 'selected', readOnly: false }))
    expect(body).toMatchObject({ defaults: expect.any(Array), userItems: [], projectItems: [] })
  })

  it('edits portable skills from the shared folder', async () => {
    const library = join(rootDir, 'shared-edit')
    const skillPath = join(library, 'shared-portable', 'SKILL.md')
    await mkdir(join(library, 'shared-portable'), { recursive: true })
    await writeFile(skillPath, '---\nname: shared-portable\ndescription: Before\n---\n\nOld prompt.')
    await fetch(`${baseUrl}/api/skills/library`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: library }),
    })

    const response = await fetch(`${baseUrl}/api/skills/shared-portable`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        metadata: { id: 'shared-portable', name: 'Shared Portable', description: 'After', version: '2' },
        prompt: 'New shared prompt.',
      }),
    })

    expect(response.status).toBe(200)
    expect(await readFile(skillPath, 'utf-8')).toContain('New shared prompt.')
  })

  it('deletes the full portable package from the shared folder', async () => {
    const library = join(rootDir, 'shared-delete')
    const packageDir = join(library, 'shared-delete-package')
    await mkdir(join(packageDir, 'assets'), { recursive: true })
    await writeFile(
      join(packageDir, 'SKILL.md'),
      '---\nname: shared-delete-package\ndescription: Delete shared\n---\n\nInstructions.',
    )
    await writeFile(join(packageDir, 'assets', 'data.bin'), Buffer.from([1, 2, 3]))
    await fetch(`${baseUrl}/api/skills/library`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: library }),
    })

    const response = await fetch(`${baseUrl}/api/skills/shared-delete-package`, { method: 'DELETE' })

    expect(response.status).toBe(200)
    await expect(readFile(join(packageDir, 'SKILL.md'))).rejects.toThrow()
    await expect(readFile(join(packageDir, 'assets', 'data.bin'))).rejects.toThrow()
  })

  it('uses the global config skills folder when no custom library is selected', async () => {
    const response = await fetch(`${baseUrl}/api/skills`)
    const body = (await response.json()) as {
      selectedDirectory: { configuredPath: string; resolvedPath: string; available: boolean; custom: boolean }
    }

    expect(body.selectedDirectory).toEqual({
      configuredPath: join(rootDir, 'config', 'skills'),
      resolvedPath: join(rootDir, 'config', 'skills'),
      available: true,
      custom: false,
    })
  })

  it('installs a dropped package into global config without a custom library', async () => {
    const form = new FormData()
    form.append('packageName', 'global-drop')
    form.append('paths', JSON.stringify(['SKILL.md']))
    form.append(
      'files',
      new Blob(['---\nname: global-drop\ndescription: Global drop\n---\n\nGlobal instructions.']),
      'SKILL.md',
    )

    const response = await fetch(`${baseUrl}/api/skills/install`, { method: 'POST', body: form })

    expect(response.status).toBe(201)
    expect(await readFile(join(rootDir, 'config', 'skills', 'global-drop', 'SKILL.md'), 'utf-8')).toContain(
      'Global instructions.',
    )
  })

  it('edits legacy skills in place without converting them', async () => {
    const configDir = join(rootDir, 'config')
    const legacyPath = join(configDir, 'skills', 'legacy.skill.md')
    await mkdir(join(configDir, 'skills'), { recursive: true })
    await writeFile(legacyPath, '---\nid: legacy\nname: Legacy\ndescription: Before\nversion: "1"\n---\n\nOld prompt.')

    const response = await fetch(`${baseUrl}/api/skills/legacy`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        metadata: { id: 'legacy', name: 'Legacy edited', description: 'After', version: '2' },
        prompt: 'New prompt.',
      }),
    })

    expect(response.status).toBe(200)
    expect(await readFile(legacyPath, 'utf-8')).toContain('New prompt.')
    await expect(readFile(join(configDir, 'skills', 'legacy', 'SKILL.md'), 'utf-8')).rejects.toThrow()
  })

  it('edits user-owned portable skills in place', async () => {
    const skillPath = join(rootDir, 'config', 'skills', 'portable-owned', 'SKILL.md')
    await mkdir(join(rootDir, 'config', 'skills', 'portable-owned'), { recursive: true })
    await writeFile(
      skillPath,
      '---\nname: portable-owned\ndescription: Before\nmetadata:\n  version: "1"\n  custom: keep\n---\n\nOld prompt.',
    )

    const listResponse = await fetch(`${baseUrl}/api/skills`)
    const list = (await listResponse.json()) as { userItems: Array<{ id: string; readOnly: boolean }> }
    expect(list.userItems).toContainEqual(expect.objectContaining({ id: 'portable-owned', readOnly: false }))

    const response = await fetch(`${baseUrl}/api/skills/portable-owned`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        metadata: { id: 'portable-owned', name: 'Portable Owned', description: 'After', version: '2' },
        prompt: 'New portable prompt.',
      }),
    })

    expect(response.status).toBe(200)
    const updated = await readFile(skillPath, 'utf-8')
    expect(updated).toContain('description: After')
    expect(updated).toContain('displayName: Portable Owned')
    expect(updated).toContain('custom: keep')
    expect(updated).toContain('New portable prompt.')
  })

  it('deletes user-owned portable skill packages', async () => {
    const packageDir = join(rootDir, 'config', 'skills', 'delete-portable')
    await mkdir(packageDir, { recursive: true })
    await writeFile(
      join(packageDir, 'SKILL.md'),
      '---\nname: delete-portable\ndescription: Delete me\n---\n\nInstructions.',
    )
    settings.set('skill.enabled.delete-portable', 'false')

    const response = await fetch(`${baseUrl}/api/skills/delete-portable`, { method: 'DELETE' })

    expect(response.status).toBe(200)
    await expect(readFile(join(packageDir, 'SKILL.md'), 'utf-8')).rejects.toThrow()
    expect(settings.has('skill.enabled.delete-portable')).toBe(false)
  })

  it('stores activation outside SKILL.md', async () => {
    const skillPath = join(rootDir, 'config', 'skills', 'toggle-portable', 'SKILL.md')
    const original = '---\nname: toggle-portable\ndescription: Toggle me\n---\n\nInstructions.'
    await mkdir(join(rootDir, 'config', 'skills', 'toggle-portable'), { recursive: true })
    await writeFile(skillPath, original)

    const response = await fetch(`${baseUrl}/api/skills/toggle-portable/toggle`, { method: 'POST' })
    const body = (await response.json()) as { enabled: boolean }

    expect(response.status).toBe(200)
    expect(body.enabled).toBe(false)
    expect(settings.get('skill.enabled.toggle-portable')).toBe('false')
    expect(await readFile(skillPath, 'utf-8')).toBe(original)
  })

  it('keeps an unavailable selected directory visible for removal', async () => {
    const library = join(rootDir, 'temporary-library')
    await mkdir(library)
    await fetch(`${baseUrl}/api/skills/library`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: library }),
    })
    await rm(library, { recursive: true })

    const response = await fetch(`${baseUrl}/api/skills`)
    const body = (await response.json()) as {
      selectedDirectory: { configuredPath: string; resolvedPath: string | null; available: boolean }
    }
    expect(body.selectedDirectory).toEqual({
      configuredPath: library,
      resolvedPath: null,
      available: false,
      custom: true,
    })
  })

  it('installs a dropped multipart package into the selected library', async () => {
    const library = join(rootDir, 'drop-library')
    await mkdir(library)
    await fetch(`${baseUrl}/api/skills/library`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: library }),
    })
    const form = new FormData()
    form.append('packageName', 'dropped-skill')
    form.append('paths', JSON.stringify(['SKILL.md', 'assets/data.bin']))
    form.append(
      'files',
      new Blob(['---\nname: dropped-skill\ndescription: Dropped\n---\n\nUse assets/data.bin.']),
      'SKILL.md',
    )
    form.append('files', new Blob([new Uint8Array([1, 2, 3])]), 'data.bin')

    const response = await fetch(`${baseUrl}/api/skills/install`, { method: 'POST', body: form })

    expect(response.status).toBe(201)
    expect(await readFile(join(library, 'dropped-skill', 'assets', 'data.bin'))).toEqual(Buffer.from([1, 2, 3]))
  })

  it('rejects creation without portable description', async () => {
    const response = await fetch(`${baseUrl}/api/skills`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        metadata: { id: 'missing-description', name: 'Missing Description', version: '' },
        prompt: 'Instructions.',
      }),
    })

    expect(response.status).toBe(400)
  })
})
