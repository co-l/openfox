/**
 * Pause (cooperative) E2E Tests
 *
 * Verifies the pause REST endpoints and the session pause state machine
 * wired into a real (in-process) server. The agent-loop gate timing
 * (blocking before the next LLM request, resuming, aborting) is covered by
 * src/server/chat/agent-loop-pause.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createTestServer, type TestServerHandle } from './utils/index.js'
import { createTestProject, type TestProject } from './utils/index.js'

describe('Pause (cooperative)', () => {
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
    testProject = await createTestProject({ template: 'empty' })
    const createRes = await fetch(`${server.url}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Pause Project', workdir: testProject.path }),
    })
    const data: any = await createRes.json()
    projectId = data.project.id
  })

  afterEach(async () => {
    await testProject.cleanup()
  })

  async function createSessionId(): Promise<string> {
    const res = await fetch(`${server.url}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, title: 'Pause Session' }),
    })
    const data: any = await res.json()
    return data.session.id as string
  }

  describe('REST contract', () => {
    it('returns 404 for pause/resume on an unknown session', async () => {
      const pauseRes = await fetch(`${server.url}/api/sessions/does-not-exist/pause`, { method: 'POST' })
      expect(pauseRes.status).toBe(404)
      const resumeRes = await fetch(`${server.url}/api/sessions/does-not-exist/resume`, { method: 'POST' })
      expect(resumeRes.status).toBe(404)
    })

    it('returns 409 when pausing a session that is not running', async () => {
      const sessionId = await createSessionId()
      const res = await fetch(`${server.url}/api/sessions/${sessionId}/pause`, { method: 'POST' })
      expect(res.status).toBe(409)
    })

    it('returns 409 when resuming with nothing to resume', async () => {
      const sessionId = await createSessionId()
      const res = await fetch(`${server.url}/api/sessions/${sessionId}/resume`, { method: 'POST' })
      expect(res.status).toBe(409)
    })
  })

  describe('REST + state machine on a running session', () => {
    it('pause → pending, double-pause rejected, resume → none', async () => {
      const sm = server.ctx.sessionManager
      const sessionId = await createSessionId()
      sm.setRunning(sessionId, true)
      try {
        const pauseRes = await fetch(`${server.url}/api/sessions/${sessionId}/pause`, { method: 'POST' })
        expect(pauseRes.status).toBe(200)
        const pauseBody: any = await pauseRes.json()
        expect(pauseBody.success).toBe(true)
        expect(pauseBody.pauseState).toBe('pending')

        // The session object reflects the state (streaming/fetch parity)
        expect(sm.getSession(sessionId)?.pauseState).toBe('pending')

        // A second pause is rejected
        const doubleRes = await fetch(`${server.url}/api/sessions/${sessionId}/pause`, { method: 'POST' })
        expect(doubleRes.status).toBe(409)

        // Resume cancels the pending pause
        const resumeRes = await fetch(`${server.url}/api/sessions/${sessionId}/resume`, { method: 'POST' })
        expect(resumeRes.status).toBe(200)
        const resumeBody: any = await resumeRes.json()
        expect(resumeBody.success).toBe(true)
        expect(resumeBody.pauseState).toBe('none')
        expect(sm.getPauseState(sessionId)).toBe('none')
      } finally {
        sm.setRunning(sessionId, false)
      }
    })

    it('setRunning(false) clears a stale pending pause', () => {
      const sm = server.ctx.sessionManager
      const sessionId = sm.createSession(projectId).id
      sm.setRunning(sessionId, true)
      sm.requestPause(sessionId)
      expect(sm.getPauseState(sessionId)).toBe('pending')
      sm.setRunning(sessionId, false)
      expect(sm.getPauseState(sessionId)).toBe('none')
    })
  })
})
