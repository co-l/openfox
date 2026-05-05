/**
 * Project Management REST API E2E Tests
 *
 * Tests project CRUD operations via REST API (not WebSocket).
 * Following TDD: these tests should FAIL initially before implementation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createTestServer, type TestServerHandle } from './utils/index.js'

describe('Project REST API', () => {
  let server: TestServerHandle

  beforeAll(async () => {
    // Clean up any leftover test directories
    const { rm } = await import('node:fs/promises')
    const dirs = [
      '/tmp/test-project',
      '/tmp/my-project',
      '/tmp/p1',
      '/tmp/p2',
      '/tmp/load-me',
      '/tmp/original',
      '/tmp/instructions',
      '/tmp/clear',
      '/tmp/delete-me',
    ]
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }).catch(() => {})))

    server = await createTestServer()
  })

  afterAll(async () => {
    await server.close()
  })

  describe('GET /api/projects', () => {
    it('returns empty array when no projects exist', async () => {
      const response = await fetch(`${server.url}/api/projects`)

      expect(response.status).toBe(200)
      const data: any = await response.json()
      expect(data.projects).toEqual([])
    })

    it('returns created projects', async () => {
      // Create a project first
      const createRes = await fetch(`${server.url}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Project', workdir: '/tmp/test-project' }),
      })
      expect(createRes.status).toBe(201)
      const created: any = await createRes.json()

      // List projects
      const response = await fetch(`${server.url}/api/projects`)
      expect(response.status).toBe(200)
      const data: any = await response.json()

      expect(Array.isArray(data.projects)).toBe(true)
      const found = data.projects.find((p: any) => p.id === created.project.id)
      expect(found).toBeDefined()
      expect(found.name).toBe('Test Project')
    })
  })

  describe('POST /api/projects', () => {
    it('creates a project with name and workdir', async () => {
      const response = await fetch(`${server.url}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Project', workdir: '/tmp/my-project' }),
      })

      expect(response.status).toBe(201)
      const data: any = await response.json()

      expect(data.project).toBeDefined()
      expect(data.project.name).toBe('My Project')
      expect(data.project.workdir).toBe('/tmp/my-project')
      expect(data.project.id).toBeDefined()
      expect(data.project.createdAt).toBeDefined()
    })

    it('returns 400 for missing required fields', async () => {
      const response = await fetch(`${server.url}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(response.status).toBe(400)
      const data: any = await response.json()
      expect(data.error).toBeDefined()
    })

    it('generates unique IDs for multiple projects', async () => {
      const res1 = await fetch(`${server.url}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Project 1', workdir: '/tmp/p1' }),
      })
      const project1: any = await res1.json()

      const res2 = await fetch(`${server.url}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Project 2', workdir: '/tmp/p2' }),
      })
      const project2: any = await res2.json()

      expect(project1.project.id).not.toBe(project2.project.id)
    })
  })

  describe('GET /api/projects/:id', () => {
    it('loads an existing project', async () => {
      // Create first
      const createRes = await fetch(`${server.url}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Load Me', workdir: '/tmp/load-me' }),
      })
      const created: any = await createRes.json()

      // Load it
      const response = await fetch(`${server.url}/api/projects/${created.project.id}`)

      expect(response.status).toBe(200)
      const data: any = await response.json()

      expect(data.project.id).toBe(created.project.id)
      expect(data.project.name).toBe('Load Me')
    })

    it('returns 404 for non-existent project', async () => {
      const response = await fetch(`${server.url}/api/projects/nonexistent-id`)

      expect(response.status).toBe(404)
      const data: any = await response.json()
      expect(data.error).toBe('Project not found')
    })
  })

  describe('PUT /api/projects/:id', () => {
    it('updates project name', async () => {
      // Create first
      const createRes = await fetch(`${server.url}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Original', workdir: '/tmp/original' }),
      })
      const created: any = await createRes.json()

      // Update
      const response = await fetch(`${server.url}/api/projects/${created.project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Name' }),
      })

      expect(response.status).toBe(200)
      const data: any = await response.json()

      expect(data.project.name).toBe('Updated Name')
      expect(data.project.id).toBe(created.project.id)
    })

    it('sets custom instructions', async () => {
      const createRes = await fetch(`${server.url}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Instructions Test', workdir: '/tmp/instructions' }),
      })
      const created: any = await createRes.json()

      const instructions = 'Always use dark theme. Prefer functional programming.'
      const response = await fetch(`${server.url}/api/projects/${created.project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customInstructions: instructions }),
      })

      expect(response.status).toBe(200)
      const data: any = await response.json()
      expect(data.project.customInstructions).toBe(instructions)
    })

    it('clears custom instructions with null', async () => {
      const createRes = await fetch(`${server.url}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Clear Test', workdir: '/tmp/clear' }),
      })
      const created: any = await createRes.json()

      // Set instructions
      await fetch(`${server.url}/api/projects/${created.project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customInstructions: 'Some instructions' }),
      })

      // Clear them
      const response = await fetch(`${server.url}/api/projects/${created.project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customInstructions: null }),
      })

      expect(response.status).toBe(200)
      const data: any = await response.json()
      // customInstructions is omitted when null (see rowToProject in db/projects.ts)
      expect(data.project.customInstructions).toBeUndefined()
    })

    it('returns 404 for non-existent project', async () => {
      const response = await fetch(`${server.url}/api/projects/nonexistent-id`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      })

      expect(response.status).toBe(404)
    })
  })

  describe('DELETE /api/projects/:id', () => {
    it('deletes a project', async () => {
      // Create first
      const createRes = await fetch(`${server.url}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Delete Me', workdir: '/tmp/delete-me' }),
      })
      const created: any = await createRes.json()

      // Delete
      const response = await fetch(`${server.url}/api/projects/${created.project.id}`, {
        method: 'DELETE',
      })

      expect(response.status).toBe(200)
      const data: any = await response.json()
      expect(data.success).toBe(true)

      // Verify it's gone
      const loadResponse = await fetch(`${server.url}/api/projects/${created.project.id}`)
      expect(loadResponse.status).toBe(404)
    })

    it('returns 404 for non-existent project', async () => {
      const response = await fetch(`${server.url}/api/projects/nonexistent-id`, {
        method: 'DELETE',
      })

      expect(response.status).toBe(404)
    })
  })
})
