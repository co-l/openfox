/**
 * Cross-window task board sync.
 *
 * When a task changes in one window, every other window's board must update
 * live — including windows with no session loaded (homepage) or sessions in
 * another project. The server broadcasts tasks.update to ALL clients.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { TasksUpdatePayload } from '@openfox/shared/protocol'
import {
  createTestClient,
  createTestProject,
  createTestServer,
  createProject,
  createSession,
  type TestClient,
  type TestProject,
  type TestServerHandle,
} from './utils/index.js'

describe('tasks cross-window sync', () => {
  let server: TestServerHandle
  let testProject: TestProject
  let windowA: TestClient
  let windowB: TestClient
  let projectId: string

  beforeAll(async () => {
    server = await createTestServer()
    testProject = await createTestProject({ template: 'typescript' })
    const restProject = await createProject(server.url, { name: 'cross-window-sync', workdir: testProject.path })
    projectId = restProject.id

    // Window A: inside a session of the project (sets activeSessionId).
    windowA = await createTestClient({ url: server.wsUrl })
    const session = await createSession(server.url, { projectId })
    await windowA.send('session.load', { sessionId: session.id })

    // Window B: homepage — connected, no session loaded.
    windowB = await createTestClient({ url: server.wsUrl })
  })

  afterAll(async () => {
    await windowA.close()
    await windowB.close()
    await testProject.cleanup()
    await server.close()
  })

  it('delivers tasks.update to a window with no active session', async () => {
    const createRes = await fetch(`${server.url}/api/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'first task' }),
    })
    expect(createRes.ok).toBe(true)
    const { task } = (await createRes.json()) as { task: { id: string } }

    const updateRes = await fetch(`${server.url}/api/projects/${projectId}/tasks/${task.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'updated prompt' }),
    })
    expect(updateRes.ok).toBe(true)

    const hasUpdated = (payload: TasksUpdatePayload) =>
      payload.projectId === projectId && payload.tasks.some((t) => t.prompt === 'updated prompt')

    const inSession = await windowA.waitFor<TasksUpdatePayload>('tasks.update', hasUpdated)
    const noSession = await windowB.waitFor<TasksUpdatePayload>('tasks.update', hasUpdated)

    expect(inSession.payload.tasks[0]?.prompt).toBe('updated prompt')
    expect(noSession.payload.tasks[0]?.prompt).toBe('updated prompt')
  })
})
