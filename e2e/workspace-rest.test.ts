/**
 * Git Workspace REST API E2E Tests
 *
 * Tests session-scoped workspace endpoints.
 * Workspaces are created per-session, not per-project.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createTestServer, type TestServerHandle } from './utils/index.js'
import { createTestProject, type TestProject } from './utils/index.js'

describe('Session Workspace REST API', () => {
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
      body: JSON.stringify({ projectId, title: 'Workspace Test Session' }),
    })
    const sessionData: any = await sessionRes.json()
    sessionId = sessionData.session.id
  })

  afterEach(async () => {
    await testProject.cleanup()
  })

  it('session starts without workspace', async () => {
    const res = await fetch(`${server.url}/api/sessions/${sessionId}`)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.session.workspace).toBeUndefined()
  })

  it('switches to a new workspace', async () => {
    const res = await fetch(`${server.url}/api/sessions/${sessionId}/switch-workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'test-workspace' }),
    })
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.session.workspace).toBeDefined()
    expect(data.session.workspace).toContain('test-workspace')
    expect(data.session.workdir).toBe(testProject.path)
  })

  it('switches to a new workspace with optional branch', async () => {
    const res = await fetch(`${server.url}/api/sessions/${sessionId}/switch-workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'branch-test', branch: 'main' }),
    })
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.session.workspace).toBeDefined()
    expect(data.session.workspace).toContain('branch-test')
  })

  it('switches to original', async () => {
    // Switch to a workspace first
    await fetch(`${server.url}/api/sessions/${sessionId}/switch-workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'to-switch-back' }),
    })

    // Switch back to original
    const res = await fetch(`${server.url}/api/sessions/${sessionId}/switch-workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'original' }),
    })
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.session.workspace).toBeUndefined()
    expect(data.session.workdir).toBe(testProject.path)
  })

  it('rejects missing target', async () => {
    const res = await fetch(`${server.url}/api/sessions/${sessionId}/switch-workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('rejects workspace on non-existent session', async () => {
    const res = await fetch(`${server.url}/api/sessions/nonexistent/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'feature/foo' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('Workspace Config REST API', () => {
  let server: TestServerHandle
  let testProject: TestProject

  beforeAll(async () => {
    server = await createTestServer()
  })

  afterAll(async () => {
    await server.close()
  })

  beforeEach(async () => {
    testProject = await createTestProject({ template: 'git-repo' })
  })

  afterEach(async () => {
    await testProject.cleanup()
  })

  it('GET /api/workspace/config returns null when no config exists', async () => {
    const res = await fetch(`${server.url}/api/workspace/config?workdir=${encodeURIComponent(testProject.path)}`)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.config).toBeNull()
  })

  it('POST /api/workspace/config saves and returns config', async () => {
    const res = await fetch(`${server.url}/api/workspace/config?workdir=${encodeURIComponent(testProject.path)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setup: ['npm install --prefer-offline'] }),
    })
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.config.setup).toEqual(['npm install --prefer-offline'])
  })

  it('GET /api/workspace/config reads back saved config', async () => {
    await fetch(`${server.url}/api/workspace/config?workdir=${encodeURIComponent(testProject.path)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setup: ['npm install --prefer-offline'] }),
    })
    const res = await fetch(`${server.url}/api/workspace/config?workdir=${encodeURIComponent(testProject.path)}`)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.config.setup).toEqual(['npm install --prefer-offline'])
  })

  it('rejects non-array setup', async () => {
    const res = await fetch(`${server.url}/api/workspace/config?workdir=${encodeURIComponent(testProject.path)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setup: 'not-an-array' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects missing workdir', async () => {
    const res = await fetch(`${server.url}/api/workspace/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setup: ['npm install --prefer-offline'] }),
    })
    expect(res.status).toBe(400)
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

describe('Session Branch REST API', () => {
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
    const createRes = await fetch(`${server.url}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Session Branch', workdir: testProject.path }),
    })
    const data: any = await createRes.json()
    projectId = data.project.id
    const sessionRes = await fetch(`${server.url}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, title: 'Branch Test Session' }),
    })
    const sessionData: any = await sessionRes.json()
    sessionId = sessionData.session.id
  })

  afterEach(async () => {
    await testProject.cleanup()
  })

  it('GET /api/sessions/:id/branches lists branches for effective workdir', async () => {
    const res = await fetch(`${server.url}/api/sessions/${sessionId}/branches`)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(Array.isArray(data.branches)).toBe(true)
    const main = data.branches.find((b: any) => b.name === 'main')
    expect(main).toBeDefined()
    expect(main.current).toBe(true)
  })

  it('POST /api/sessions/:id/checkout-new creates and switches branch in effective workdir', async () => {
    const res = await fetch(`${server.url}/api/sessions/${sessionId}/checkout-new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'feature/session-test' }),
    })
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.branch).toBe('feature/session-test')

    const branchesRes = await fetch(`${server.url}/api/sessions/${sessionId}/branches`)
    const branchesData: any = await branchesRes.json()
    const current = branchesData.branches.find((b: any) => b.current)
    expect(current.name).toBe('feature/session-test')
  })

  it('POST /api/sessions/:id/checkout switches to existing branch', async () => {
    await fetch(`${server.url}/api/sessions/${sessionId}/checkout-new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'feature/session-switch' }),
    })

    const res = await fetch(`${server.url}/api/sessions/${sessionId}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch: 'main' }),
    })
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.branch).toBe('main')

    const branchesRes = await fetch(`${server.url}/api/sessions/${sessionId}/branches`)
    const branchesData: any = await branchesRes.json()
    const current = branchesData.branches.find((b: any) => b.current)
    expect(current.name).toBe('main')
  })

  it('returns 404 for non-existent session', async () => {
    const res = await fetch(`${server.url}/api/sessions/nonexistent/branches`)
    expect(res.status).toBe(404)
  })

  it('rejects invalid branch ref on checkout', async () => {
    const res = await fetch(`${server.url}/api/sessions/${sessionId}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch: '../escape' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('Workspace Validation REST API', () => {
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
    const createRes = await fetch(`${server.url}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Validation Test', workdir: testProject.path }),
    })
    const data: any = await createRes.json()
    projectId = data.project.id
    const sessionRes = await fetch(`${server.url}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, title: 'Validation Session' }),
    })
    const sessionData: any = await sessionRes.json()
    sessionId = sessionData.session.id
  })

  afterEach(async () => {
    await testProject.cleanup()
  })

  it('rejects workspace name with path separators', async () => {
    const res = await fetch(`${server.url}/api/sessions/${sessionId}/switch-workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'a/b' }),
    })
    expect(res.status).toBe(400)
    const data: any = await res.json()
    expect(data.error).toContain('path separator')
  })

  it('rejects workspace name with absolute path', async () => {
    const res = await fetch(`${server.url}/api/sessions/${sessionId}/switch-workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: '/tmp/evil' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects "." as workspace name', async () => {
    const res = await fetch(`${server.url}/api/sessions/${sessionId}/switch-workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: '.' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects ".." as workspace name', async () => {
    const res = await fetch(`${server.url}/api/sessions/${sessionId}/switch-workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: '..' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects workspace delete with path traversal', async () => {
    const res = await fetch(`${server.url}/api/sessions/${sessionId}/delete-workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: '../escape' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects delete of original workspace', async () => {
    const res = await fetch(`${server.url}/api/sessions/${sessionId}/delete-workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'original' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects delete of non-existent workspace', async () => {
    const res = await fetch(`${server.url}/api/sessions/${sessionId}/delete-workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'does-not-exist' }),
    })
    expect(res.status).toBe(400)
  })

  it('accepts valid workspace name with hyphens', async () => {
    const res = await fetch(`${server.url}/api/sessions/${sessionId}/switch-workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'my-workspace' }),
    })
    expect(res.status).toBe(200)
  })

  it('session-scoped checkout does not affect project-scoped branches', async () => {
    const wsName = `isolation-${crypto.randomUUID().slice(0, 8)}`

    const wsRes = await fetch(`${server.url}/api/sessions/${sessionId}/switch-workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: wsName }),
    })
    expect(wsRes.status).toBe(200)

    const branchRes = await fetch(`${server.url}/api/sessions/${sessionId}/checkout-new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'workspace-only-branch' }),
    })
    expect(branchRes.status).toBe(200)

    const sessionBranchesRes = await fetch(`${server.url}/api/sessions/${sessionId}/branches`)
    const sessionBranchesData: any = await sessionBranchesRes.json()
    const wsBranch = sessionBranchesData.branches.find((b: any) => b.name === 'workspace-only-branch')
    expect(wsBranch).toBeDefined()

    const projectBranchesRes = await fetch(`${server.url}/api/projects/${projectId}/branches`)
    const projectBranchesData: any = await projectBranchesRes.json()
    const projectBranch = projectBranchesData.branches.find((b: any) => b.name === 'workspace-only-branch')
    expect(projectBranch).toBeUndefined()
  })
})
