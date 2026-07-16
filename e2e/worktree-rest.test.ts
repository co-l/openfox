/**
 * Git Worktree REST API E2E Tests
 *
 * Tests session-scoped worktree endpoints.
 * Worktrees are created per-session, not per-project.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createTestServer, type TestServerHandle } from './utils/index.js'
import { createTestProject, type TestProject } from './utils/index.js'

describe('Session Worktree REST API', () => {
  let server: TestServerHandle
  let testProject: TestProject
  let projectId: string
  let sessionId: string

  beforeAll(async () => {
    server = await createTestServer()
  })

  afterAll(async () => {
    await server.close()
  })

  beforeEach(async () => {
    testProject = await createTestProject({ template: 'git-repo' })
    // Create a project via REST
    const createRes = await fetch(`${server.url}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Git Project', workdir: testProject.path }),
    })
    const projectData: any = await createRes.json()
    projectId = projectData.project.id

    // Create a session
    const sessionRes = await fetch(`${server.url}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, title: 'Worktree Test Session' }),
    })
    const sessionData: any = await sessionRes.json()
    sessionId = sessionData.session.id
  })

  afterEach(async () => {
    await testProject.cleanup()
  })

  it('session starts without worktree', async () => {
    const res = await fetch(`${server.url}/api/sessions/${sessionId}`)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.session.worktree).toBeUndefined()
  })

  it('creates worktree for session', async () => {
    const res = await fetch(`${server.url}/api/sessions/${sessionId}/worktree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'feature/test-worktree' }),
    })
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.session.worktree).toBeDefined()
    expect(data.session.worktree).toContain('worktrees/feature-test-worktree')
    // workdir stays as project root — only worktree changes
    expect(data.session.workdir).toBe(testProject.path)
  })

  it('closes worktree and returns session to project root', async () => {
    // Create worktree first
    await fetch(`${server.url}/api/sessions/${sessionId}/worktree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'feature/to-close' }),
    })

    // Close worktree
    const res = await fetch(`${server.url}/api/sessions/${sessionId}/close-worktree`, {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.session.worktree).toBeUndefined()
    expect(data.session.workdir).toBe(testProject.path)
  })

  it('rejects creating worktree when session already has one', async () => {
    await fetch(`${server.url}/api/sessions/${sessionId}/worktree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'feature/first' }),
    })

    const res = await fetch(`${server.url}/api/sessions/${sessionId}/worktree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'feature/second' }),
    })
    expect(res.status).toBe(400)
    const data: any = await res.json()
    expect(data.error).toMatch(/already has a worktree/i)
  })

  it('rejects closing worktree when session has none', async () => {
    const res = await fetch(`${server.url}/api/sessions/${sessionId}/close-worktree`, {
      method: 'POST',
    })
    expect(res.status).toBe(400)
    const data: any = await res.json()
    expect(data.error).toMatch(/does not have a worktree/i)
  })

  it('rejects missing name', async () => {
    const res = await fetch(`${server.url}/api/sessions/${sessionId}/worktree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('rejects invalid branch name', async () => {
    const res = await fetch(`${server.url}/api/sessions/${sessionId}/worktree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'bad name with spaces' }),
    })
    expect(res.status).toBe(400)
    const data: any = await res.json()
    expect(data.error).toMatch(/failed/)
  })

  it('rejects worktree on non-existent session', async () => {
    const res = await fetch(`${server.url}/api/sessions/nonexistent/worktree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'feature/foo' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('Project Branch REST API', () => {
  let server: TestServerHandle
  let testProject: TestProject
  let projectId: string

  beforeAll(async () => {
    server = await createTestServer()
  })

  afterAll(async () => {
    await server.close()
  })

  beforeEach(async () => {
    testProject = await createTestProject({ template: 'git-repo' })
    const createRes = await fetch(`${server.url}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Branch Test', workdir: testProject.path }),
    })
    const data: any = await createRes.json()
    projectId = data.project.id
  })

  afterEach(async () => {
    await testProject.cleanup()
  })

  it('GET /api/projects/:id/branches lists branches', async () => {
    const res = await fetch(`${server.url}/api/projects/${projectId}/branches`)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(Array.isArray(data.branches)).toBe(true)
    const main = data.branches.find((b: any) => b.name === 'main')
    expect(main).toBeDefined()
    expect(main.current).toBe(true)
  })

  it('POST /api/projects/:id/checkout-new creates and switches branch', async () => {
    const res = await fetch(`${server.url}/api/projects/${projectId}/checkout-new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'feature/e2e-test' }),
    })
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.branch).toBe('feature/e2e-test')

    // Verify we're on the new branch
    const branchesRes = await fetch(`${server.url}/api/projects/${projectId}/branches`)
    const branchesData: any = await branchesRes.json()
    const current = branchesData.branches.find((b: any) => b.current)
    expect(current.name).toBe('feature/e2e-test')
  })

  it('POST /api/projects/:id/checkout switches to existing branch', async () => {
    // Create a branch first
    await fetch(`${server.url}/api/projects/${projectId}/checkout-new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'feature/to-switch' }),
    })

    // Switch back to main
    const res = await fetch(`${server.url}/api/projects/${projectId}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch: 'main' }),
    })
    expect(res.status).toBe(200)
    const checkoutData: any = await res.json()
    expect(checkoutData.branch).toBe('main')

    // Verify we're on main
    const branchesRes = await fetch(`${server.url}/api/projects/${projectId}/branches`)
    const branchesData: any = await branchesRes.json()
    const current = branchesData.branches.find((b: any) => b.current)
    expect(current.name).toBe('main')
  })

  it('rejects checkout with missing branch name', async () => {
    const res = await fetch(`${server.url}/api/projects/${projectId}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('rejects checkout-new with missing name', async () => {
    const res = await fetch(`${server.url}/api/projects/${projectId}/checkout-new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('returns 404 for non-existent project', async () => {
    const res = await fetch(`${server.url}/api/projects/nonexistent/branches`)
    expect(res.status).toBe(404)
  })
})
