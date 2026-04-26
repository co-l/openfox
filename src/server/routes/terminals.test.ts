import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import express from 'express'
import { terminalManager } from '../terminal/manager.js'
import { createTerminalRoutes } from './terminals.js'

describe('Terminal Routes', () => {
  let app: express.Express
  let server: ReturnType<typeof app.listen>
  let baseUrl: string

  beforeEach(async () => {
    app = express()
    app.use(express.json())
    app.use('/api/terminals', createTerminalRoutes())
    
    return new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${(server.address() as any).port}`
        resolve()
      })
    })
  })

  afterEach(() => {
    server?.close()
    terminalManager.killAll()
  })

  async function json<T>(res: Response): Promise<T> {
    return (await res.json()) as T
  }

  describe('GET /api/terminals', () => {
    it('returns empty array when no sessions', async () => {
      const res = await fetch(`${baseUrl}/api/terminals`)
      expect(res.status).toBe(200)
      const body = await json<[]>(res)
      expect(body).toEqual([])
    })

    it('returns all sessions for a project', async () => {
      const s1 = terminalManager.create(undefined, 'project-a')
      const s2 = terminalManager.create('/tmp', 'project-a')
      
      const res = await fetch(`${baseUrl}/api/terminals?projectId=project-a`)
      expect(res.status).toBe(200)
      const body = await json<Array<{id: string; workdir: string; projectId: string}>>(res)
      expect(body).toHaveLength(2)
      expect(body.map(s => s.id)).toContain(s1.id)
      expect(body.map(s => s.id)).toContain(s2.id)
    })

    it('returns empty array when no projectId provided', async () => {
      terminalManager.create(undefined, 'project-a')
      
      const res = await fetch(`${baseUrl}/api/terminals`)
      expect(res.status).toBe(200)
      const body = await json<[]>(res)
      expect(body).toEqual([])
    })

    it('returns only sessions for the specified project', async () => {
      const s1 = terminalManager.create(undefined, 'project-a')
      terminalManager.create(undefined, 'project-b')
      
      const res = await fetch(`${baseUrl}/api/terminals?projectId=project-a`)
      expect(res.status).toBe(200)
      const body = await json<Array<{id: string; workdir: string; projectId: string}>>(res)
      expect(body).toHaveLength(1)
      expect(body[0]?.id).toBe(s1.id)
      expect(body[0]?.projectId).toBe('project-a')
    })
  })

  describe('POST /api/terminals', () => {
    it('creates a terminal without workdir', async () => {
      const res = await fetch(`${baseUrl}/api/terminals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'project-a' }),
      })
      expect(res.status).toBe(201)
      const body = await json<{id: string; workdir: string; projectId: string}>(res)
      expect(body.id).toMatch(/^term_/)
      expect(body.workdir).toBeDefined()
      expect(body.projectId).toBe('project-a')
    })

    it('creates a terminal with workdir', async () => {
      const res = await fetch(`${baseUrl}/api/terminals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workdir: '/tmp', projectId: 'project-b' }),
      })
      expect(res.status).toBe(201)
      const body = await json<{id: string; workdir: string; projectId: string}>(res)
      expect(body.workdir).toBe('/tmp')
      expect(body.projectId).toBe('project-b')
    })
  })

  describe('DELETE /api/terminals/:id', () => {
    it('kills a terminal', async () => {
      const session = terminalManager.create()
      
      const res = await fetch(`${baseUrl}/api/terminals/${session.id}`, {
        method: 'DELETE',
      })
      expect(res.status).toBe(204)
      
      expect(terminalManager.get(session.id)).toBeUndefined()
    })

    it('returns 404 for non-existent id', async () => {
      const res = await fetch(`${baseUrl}/api/terminals/nonexistent`, {
        method: 'DELETE',
      })
      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/terminals/:id', () => {
    it('returns terminal by id', async () => {
      const session = terminalManager.create('/home')
      
      const res = await fetch(`${baseUrl}/api/terminals/${session.id}`)
      expect(res.status).toBe(200)
      const body = await json<{id: string; workdir: string}>(res)
      expect(body.id).toBe(session.id)
      expect(body.workdir).toBe('/home')
    })

    it('returns 404 for non-existent id', async () => {
      const res = await fetch(`${baseUrl}/api/terminals/nonexistent`)
      expect(res.status).toBe(404)
    })
  })
})