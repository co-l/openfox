import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
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

describe('context.checkDynamic', () => {
  let server: TestServerHandle
  let client: TestClient
  let project: TestProject
  const createdSkillIds: string[] = []

  beforeAll(async () => {
    server = await createTestServer()
  })

  afterAll(async () => {
    await server.close()
  })

  beforeEach(async () => {
    client = await createTestClient({ url: server.wsUrl })
    project = await createTestProject({ template: 'typescript' })
  })

  afterEach(async () => {
    await client.close()
    await project.cleanup()
    // Clean up any skill files created during the test
    for (const skillId of createdSkillIds) {
      try {
        await fetch(`${server.url}/api/skills/${skillId}?workdir=${encodeURIComponent(project.path)}`, {
          method: 'DELETE',
        })
      } catch {
        // Ignore cleanup errors
      }
    }
    createdSkillIds.length = 0
  })

  async function fetchContextState(sessionId: string) {
    const res = await fetch(`${server.url}/api/sessions/${sessionId}`)
    const data = (await res.json()) as { contextState: { dynamicContextChanged: boolean } }
    return data.contextState
  }

  it('does nothing when no cached prompt exists', async () => {
    const restProject = await createProject(server.url, { name: 'test', workdir: project.path })
    const restSession = await createSession(server.url, { projectId: restProject.id })
    await client.send('session.load', { sessionId: restSession.id })

    // No message sent — no cached prompt, so checkDynamic should be a no-op
    client.clearEvents()
    const ack = await client.send('context.checkDynamic', {})
    expect(ack.type).toBe('ack')
    // No context.state should be sent since there's no cached prompt to compare
    const ctxEvents = client.allEvents().filter((e) => e.type === 'context.state')
    expect(ctxEvents).toHaveLength(0)
  })

  it('detects skill changes after checkDynamic', async () => {
    const restProject = await createProject(server.url, { name: 'test', workdir: project.path })
    const restSession = await createSession(server.url, { projectId: restProject.id })
    await client.send('session.load', { sessionId: restSession.id })

    // First message — caches the system prompt
    await client.send('chat.send', { content: 'Hello' })
    await client.waitForChatDone()

    // Verify cache is established
    let state = await fetchContextState(restSession.id)
    expect(state.dynamicContextChanged).toBe(false)

    // Add a skill via the skills API (same payload as the UI: SkillFull + destination)
    const skillId = `test-skill-${Date.now()}`
    const skillRes = await fetch(`${server.url}/api/skills?workdir=${encodeURIComponent(project.path)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        metadata: { id: skillId, name: 'Test Skill', description: 'A test skill', version: '1.0.0' },
        prompt: 'Do something',
        destination: 'project',
      }),
    })
    expect(skillRes.ok).toBe(true)
    createdSkillIds.push(skillId)

    // Clear stale events from session.load, then send context.checkDynamic
    client.clearEvents()
    await client.send('context.checkDynamic', {})
    const ctxEvent = await client.waitFor('context.state')
    const ctxPayload = ctxEvent.payload as { context: { dynamicContextChanged: boolean } }
    expect(ctxPayload.context.dynamicContextChanged).toBe(true)

    // Also verify via REST
    state = await fetchContextState(restSession.id)
    expect(state.dynamicContextChanged).toBe(true)
  })
})
