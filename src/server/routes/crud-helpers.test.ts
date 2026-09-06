import { describe, expect, it } from 'vitest'
import { resolveProjectDir, resolveScope, createCrudRoutes, type CrudRouteConfig } from './crud-helpers.js'
import express, { type Router } from 'express'
import type { AddressInfo } from 'node:net'

function req(query: Record<string, unknown>): { query: Record<string, unknown> } {
  return { query }
}

describe('resolveProjectDir', () => {
  it('falls back to the configured project dir when no workdir query is present', () => {
    expect(resolveProjectDir(req({}), '/configured/project')).toBe('/configured/project')
  })

  it('falls back when workdir query is empty or whitespace', () => {
    expect(resolveProjectDir(req({ workdir: '' }), '/configured/project')).toBe('/configured/project')
    expect(resolveProjectDir(req({ workdir: '   ' }), '/configured/project')).toBe('/configured/project')
  })

  it('falls back when workdir query is not a string', () => {
    expect(resolveProjectDir(req({ workdir: ['/a', '/b'] }), '/configured/project')).toBe('/configured/project')
    expect(resolveProjectDir(req({ workdir: 42 }), '/configured/project')).toBe('/configured/project')
  })

  it('returns the workdir query trimmed of surrounding whitespace', () => {
    expect(resolveProjectDir(req({ workdir: '  /session/project  ' }), '/configured/project')).toBe('/session/project')
  })

  it('returns undefined when no query and no fallback', () => {
    expect(resolveProjectDir(req({}))).toBeUndefined()
  })
})

describe('resolveScope', () => {
  it('accepts each concrete scope and auto', () => {
    expect(resolveScope(req({ scope: 'builtin' }))).toBe('builtin')
    expect(resolveScope(req({ scope: 'user' }))).toBe('user')
    expect(resolveScope(req({ scope: 'project' }))).toBe('project')
    expect(resolveScope(req({ scope: 'auto' }))).toBe('auto')
  })

  it('falls back to auto for missing, non-string, or unknown scope', () => {
    expect(resolveScope(req({}))).toBe('auto')
    expect(resolveScope(req({ scope: 42 }))).toBe('auto')
    expect(resolveScope(req({ scope: ['user'] }))).toBe('auto')
    expect(resolveScope(req({ scope: 'system' }))).toBe('auto')
  })
})

interface StubItem {
  metadata: { id: string; name: string }
}

interface StubCalls {
  save: string[]
  delete: string[]
  saveProject: string[]
  deleteProject: string[]
}

function makeStubConfig(calls: StubCalls, opts: { annotateScope?: boolean } = {}): CrudRouteConfig<StubItem> {
  const defaults: StubItem[] = [{ metadata: { id: 'review', name: 'Built-in Review' } }]
  const userItems: StubItem[] = [{ metadata: { id: 'review', name: 'Global Review' } }]
  const projectItems: StubItem[] = [{ metadata: { id: 'review', name: 'Project Review' } }]

  return {
    dirName: 'workflows',
    ext: '.workflow.json',
    loadDefaults: async () => defaults,
    loadUser: async () => userItems,
    loadProject: async () => projectItems,
    loadAll: async () => {
      const map = new Map<string, StubItem>()
      for (const i of [defaults[0]!, userItems[0]!, projectItems[0]!]) map.set(i.metadata.id, i)
      return Array.from(map.values())
    },
    findById: (id, items) => items.find((i) => i.metadata.id === id),
    save: async (_, item) => {
      calls.save.push(item.metadata.id)
    },
    saveToProject: async (_, item) => {
      calls.saveProject.push(item.metadata.id)
    },
    delete: async (_, id) => {
      calls.delete.push(id)
      return { success: true }
    },
    deleteProject: async (_, id) => {
      calls.deleteProject.push(id)
      return { success: true }
    },
    exists: async () => false,
    isDefault: async (id) => defaults.some((d) => d.metadata.id === id),
    mapToResponse: (item) => ({ ...item.metadata }),
    ...(opts.annotateScope ? { annotateScope: true } : {}),
  }
}

async function mountRouter(
  calls: StubCalls,
  opts: {
    annotateScope?: boolean
    extraRoutes?: (router: Router) => void
    afterDelete?: (id: string, ctx: { configDir: string; projectDir?: string }) => void
  } = {},
) {
  const app = express()
  app.use(express.json())
  app.use(
    '/api/items',
    createCrudRoutes(
      {
        ...makeStubConfig(calls, opts),
        ...(opts.extraRoutes ? { extraRoutes: opts.extraRoutes } : {}),
        ...(opts.afterDelete ? { afterDelete: opts.afterDelete } : {}),
      },
      '/config',
      '/project',
    ),
  )
  const server = await new Promise<ReturnType<express.Express['listen']>>((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`
  return { server, baseUrl }
}

describe('createCrudRoutes scope support', () => {
  it('extraRoutes are matched before the /:id bucket route (template-variables must not 404)', async () => {
    const calls: StubCalls = { save: [], delete: [], saveProject: [], deleteProject: [] }
    const { server, baseUrl } = await mountRouter(calls, {
      extraRoutes: (router) => {
        router.get('/template-variables', (_req, res) => {
          res.json({ variables: ['topic', 'stepOutput'] })
        })
      },
    })
    try {
      const res = await fetch(`${baseUrl}/api/items/template-variables`)
      expect(res.status).toBe(200)
      const data = (await res.json()) as { variables: string[] }
      expect(data.variables).toEqual(['topic', 'stepOutput'])
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('annotates every item with its scope in GET / when annotateScope is enabled', async () => {
    const calls: StubCalls = { save: [], delete: [], saveProject: [], deleteProject: [] }
    const { server, baseUrl } = await mountRouter(calls, { annotateScope: true })
    try {
      const res = await fetch(`${baseUrl}/api/items?workdir=/project`)
      const data = (await res.json()) as {
        defaults: Array<{ id: string; scope: string }>
        userItems: Array<{ id: string; scope: string }>
        projectItems: Array<{ id: string; scope: string }>
      }
      expect(data.defaults[0]).toMatchObject({ id: 'review', scope: 'builtin' })
      expect(data.userItems[0]).toMatchObject({ id: 'review', scope: 'user' })
      expect(data.projectItems[0]).toMatchObject({ id: 'review', scope: 'project' })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('GET /:id?scope=user resolves from the user bucket, not project precedence', async () => {
    const calls: StubCalls = { save: [], delete: [], saveProject: [], deleteProject: [] }
    const { server, baseUrl } = await mountRouter(calls, { annotateScope: true })
    try {
      const res = await fetch(`${baseUrl}/api/items/review?scope=user&workdir=/project`)
      const data = (await res.json()) as { metadata: { name: string } }
      expect(data.metadata.name).toBe('Global Review')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('GET /:id with no scope falls back to precedence (project wins)', async () => {
    const calls: StubCalls = { save: [], delete: [], saveProject: [], deleteProject: [] }
    const { server, baseUrl } = await mountRouter(calls, { annotateScope: true })
    try {
      const res = await fetch(`${baseUrl}/api/items/review?workdir=/project`)
      const data = (await res.json()) as { metadata: { name: string } }
      expect(data.metadata.name).toBe('Project Review')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('DELETE /:id?scope=user deletes the user item, not the project one', async () => {
    const calls: StubCalls = { save: [], delete: [], saveProject: [], deleteProject: [] }
    const { server, baseUrl } = await mountRouter(calls, { annotateScope: true })
    try {
      const res = await fetch(`${baseUrl}/api/items/review?scope=user&workdir=/project`, { method: 'DELETE' })
      expect(res.status).toBe(200)
      expect(calls.delete).toEqual(['review'])
      expect(calls.deleteProject).toEqual([])
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('DELETE /:id?scope=project deletes the project item, not the user one', async () => {
    const calls: StubCalls = { save: [], delete: [], saveProject: [], deleteProject: [] }
    const { server, baseUrl } = await mountRouter(calls, { annotateScope: true })
    try {
      const res = await fetch(`${baseUrl}/api/items/review?scope=project&workdir=/project`, { method: 'DELETE' })
      expect(res.status).toBe(200)
      expect(calls.deleteProject).toEqual(['review'])
      expect(calls.delete).toEqual([])
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('runs afterDelete with the deleted id and dirs after a successful delete', async () => {
    const calls: StubCalls = { save: [], delete: [], saveProject: [], deleteProject: [] }
    const seen: Array<[string, string, string | undefined]> = []
    const { server, baseUrl } = await mountRouter(calls, {
      annotateScope: true,
      afterDelete: (id, ctx) => seen.push([id, ctx.configDir, ctx.projectDir]),
    })
    try {
      const res = await fetch(`${baseUrl}/api/items/review?scope=project&workdir=/other`, { method: 'DELETE' })
      expect(res.status).toBe(200)
      expect(seen).toEqual([['review', '/config', '/other']])
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('still answers 403 without running afterDelete when the delete fails', async () => {
    const calls: StubCalls = { save: [], delete: [], saveProject: [], deleteProject: [] }
    let ran = false
    const app = express()
    app.use(express.json())
    app.use(
      '/api/items',
      createCrudRoutes(
        {
          ...makeStubConfig(calls),
          delete: async () => ({ success: false, reason: 'Cannot delete built-in defaults' }),
          afterDelete: () => {
            ran = true
          },
        },
        '/config',
        '/project',
      ),
    )
    const server = await new Promise<ReturnType<express.Express['listen']>>((resolve) => {
      const s = app.listen(0, () => resolve(s))
    })
    try {
      const res = await fetch(`http://localhost:${(server.address() as AddressInfo).port}/api/items/defaults-only`, {
        method: 'DELETE',
      })
      expect(res.status).toBe(403)
      expect(ran).toBe(false)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('PUT /:id?scope=user saves the user item, not the project one', async () => {
    const calls: StubCalls = { save: [], delete: [], saveProject: [], deleteProject: [] }
    const { server, baseUrl } = await mountRouter(calls, { annotateScope: true })
    try {
      const res = await fetch(`${baseUrl}/api/items/review?scope=user&workdir=/project`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata: { name: 'Edited Global' } }),
      })
      expect(res.status).toBe(200)
      expect(calls.save).toEqual(['review'])
      expect(calls.saveProject).toEqual([])
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('leaves other resources untouched when annotateScope is not enabled', async () => {
    const calls: StubCalls = { save: [], delete: [], saveProject: [], deleteProject: [] }
    const { server, baseUrl } = await mountRouter(calls)
    try {
      const list = (await (await fetch(`${baseUrl}/api/items`)).json()) as {
        defaults: Array<Record<string, unknown>>
        userItems: Array<Record<string, unknown>>
      }
      expect(list.defaults[0]).not.toHaveProperty('scope')
      expect(list.userItems[0]).not.toHaveProperty('scope')

      // ?scope= is ignored: project item still wins via precedence, not the user bucket.
      const res = await fetch(`${baseUrl}/api/items/review?scope=user&workdir=/project`)
      const data = (await res.json()) as { metadata: { name: string } }
      expect(data.metadata.name).toBe('Project Review')

      const del = await fetch(`${baseUrl}/api/items/review?scope=user&workdir=/project`, { method: 'DELETE' })
      expect(del.status).toBe(200)
      // Falls back to the existing auto-detection path: no project file on disk → user delete.
      expect(calls.delete).toEqual(['review'])
      expect(calls.deleteProject).toEqual([])
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
