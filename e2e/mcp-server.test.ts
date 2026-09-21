/**
 * MCP Server Endpoint E2E Tests
 *
 * Drives a full orchestrator loop THROUGH the in-process /mcp endpoint using
 * the @modelcontextprotocol/sdk client: create session -> send message ->
 * read status -> answer pending question -> confirm path -> read metadata ->
 * launch + stop a workflow.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  createTestServer,
  createTestProject,
  createProject,
  type TestServerHandle,
  type TestProject,
} from './utils/index.js'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('MCP server endpoint', () => {
  let server: TestServerHandle
  let testDir: TestProject
  let client: Client
  let sessionId: string

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mcpText = (result: any): string =>
    (Array.isArray(result?.content) ? result.content : [])
      .filter((c: any) => c?.type === 'text')
      .map((c: any) => c?.text ?? '')
      .join('\n')

  beforeAll(async () => {
    server = await createTestServer()
  }, 60000)

  afterAll(async () => {
    await server.close()
  })

  it('drives a full orchestrator loop through the MCP endpoint', async () => {
    testDir = await createTestProject({ template: 'typescript' })
    const project = await createProject(server.url, { name: 'MCP Server E2E', workdir: testDir.path })

    const transport = new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`))
    client = new Client({ name: 'openfox-mcp-e2e', version: '0.0.1' })
    await client.connect(transport as any)

    const call = async (name: string, args: Record<string, unknown> = {}): Promise<{ raw: any; json: any }> => {
      const raw = await client.callTool({ name, arguments: args })
      if (raw.isError) throw new Error(`MCP tool ${name} failed: ${mcpText(raw)}`)
      return { raw, json: JSON.parse(mcpText(raw)) }
    }

    const waitForStatus = async (pred: (status: any) => boolean, label: string, timeoutMs = 20000): Promise<any> => {
      const deadline = Date.now() + timeoutMs
      let last: any
      while (Date.now() < deadline) {
        const { json: status } = await call('openfox_session_status', { sessionId })
        last = status
        if (pred(status)) return status
        await sleep(150)
      }
      throw new Error(`Timed out waiting for: ${label}. Last status: ${JSON.stringify(last)}`)
    }

    // 1. List projects — the newly created one must be visible
    const projects = await call('openfox_projects')
    expect(projects.json).toContainEqual(expect.objectContaining({ id: project.id }))

    // 2. Create a session through MCP and select the builder agent at creation
    const created = await call('openfox_create_session', {
      projectId: project.id,
      title: 'MCP driven session',
      agentId: 'builder',
    })
    sessionId = created.json.sessionId
    expect(sessionId).toBeTypeOf('string')

    // 2b. Switch the session mode at any time (and back)
    const modeSwitch = await call('openfox_set_mode', { sessionId, mode: 'planner' })
    expect(modeSwitch.json).toMatchObject({ sessionId, mode: 'planner' })
    const modeBack = await call('openfox_set_mode', { sessionId, mode: 'builder' })
    expect(modeBack.json).toMatchObject({ sessionId, mode: 'builder' })

    // 2c. Manipulate acceptance criteria anytime: add -> read back -> remove
    const added = await call('openfox_session_metadata', {
      sessionId,
      action: 'add',
      key: 'criteria',
      description: 'The MCP orchestrator can edit criteria',
    })
    expect(added.json.added.id).toBeTypeOf('string')
    const criteriaList = await call('openfox_session_metadata', { sessionId, action: 'get', key: 'criteria' })
    expect(criteriaList.json.entries.some((c: any) => c.id === added.json.added.id)).toBe(true)
    const removed = await call('openfox_session_metadata', {
      sessionId,
      action: 'remove',
      key: 'criteria',
      id: added.json.added.id,
    })
    expect(removed.json.entries.some((c: any) => c.id === added.json.added.id)).toBe(false)

    // 3. Workflow catalog is listed with parameters
    const workflows = await call('openfox_workflows', { projectDir: testDir.path })
    expect(workflows.json.length).toBeGreaterThan(0)
    expect(workflows.json[0]).toHaveProperty('id')

    // 4. Send a message that triggers a pending question (mock LLM ask_user rule),
    // then block on openfox_wait until the session settles (no random sleeps)
    const sent = await call('openfox_send_message', {
      sessionId,
      content: 'Please ask the user a question before proceeding with the task.',
    })
    expect(sent.json.queued).toBe(true)

    const waited = await call('openfox_wait', { sessionId, timeout: 30 })
    expect(waited.json.settled).toBe(true)
    expect(waited.json.outcome).toBe('waiting')
    expect(waited.json.status.pending.questions.length).toBeGreaterThan(0)
    expect(waited.json.status.state).toBe('waiting')
    expect(waited.json.status.waitingForUser).toBe(true)

    // 5. List pending questions via the answer tool, then answer by callId
    const pendingQuestions = await call('openfox_answer', { sessionId })
    expect(pendingQuestions.json.questions.length).toBeGreaterThan(0)
    const questionCallId = pendingQuestions.json.questions[0].callId
    expect(pendingQuestions.json.questions[0]).toHaveProperty('question')

    const answered = await call('openfox_answer', {
      sessionId,
      callId: questionCallId,
      answer: 'Proceed with the task',
    })
    expect(answered.json.answered).toBe(true)

    await waitForStatus((s) => (s.pending?.questions?.length ?? 0) === 0, 'the question to be resolved')

    // 6. Path confirmation flow: write outside the workdir triggers a confirmation
    await call('openfox_send_message', {
      sessionId,
      content: 'Write to /home/test/secret.txt with content "data"',
    })
    const waitedConfirm = await call('openfox_wait', { sessionId, timeout: 30 })
    expect(waitedConfirm.json.settled).toBe(true)
    expect(waitedConfirm.json.outcome).toBe('waiting')
    expect(waitedConfirm.json.status.pending.confirmations.length).toBeGreaterThan(0)
    expect(waitedConfirm.json.status.state).toBe('waiting')

    const pendingConfirms = await call('openfox_confirm', { sessionId })
    expect(pendingConfirms.json.confirmations.length).toBeGreaterThan(0)
    const confirmCallId = pendingConfirms.json.confirmations[0].callId

    const confirmed = await call('openfox_confirm', {
      sessionId,
      callId: confirmCallId,
      approved: true,
    })
    expect(confirmed.json.confirmed).toBe(true)

    await waitForStatus((s) => (s.pending?.confirmations?.length ?? 0) === 0, 'the confirmation to be resolved')

    // 7. Read progress without a live WebSocket
    const detail = await call('openfox_session_detail', { sessionId, limit: 50 })
    expect(detail.json.messages.length).toBeGreaterThan(0)
    expect(detail.json.messages[0]).toHaveProperty('role')

    const shortDetail = await call('openfox_session_detail', { sessionId, limit: 50, maxContentLength: 100 })
    expect(shortDetail.json.messages.length).toBeGreaterThan(0)
    for (const message of shortDetail.json.messages) {
      expect(message.content.length).toBeLessThanOrEqual(103)
    }

    const metadata = await call('openfox_session_metadata', { sessionId, action: 'get', key: 'criteria' })
    expect(metadata.json.key).toBe('criteria')
    expect(Array.isArray(metadata.json.entries)).toBe(true)

    // 8. Launch the default workflow: it pauses at its first user step, and the
    // paused step + its choices must surface in the status
    await waitForStatus((s) => s.isRunning === false, 'the session to go idle')
    const launch = await call('openfox_launch_workflow', {
      sessionId,
      workflowId: 'default',
    })
    expect(launch.json.launched).toBe(true)

    const paused = await waitForStatus(
      (s) => s.workflowStep === 'Where to work',
      'the workflow to pause at its first user step',
    )
    expect(paused.state).toBe('waiting')
    expect(paused.workflow).toBeDefined()
    expect(paused.workflow.status).toBe('waiting')
    expect(paused.workflow.currentStepId).toBe('work_location')
    expect(paused.workflow.pendingChoices.length).toBeGreaterThanOrEqual(2)
    expect(paused.workflow.pendingChoices[0].id).toBe('Work in current workspace')
    expect(paused.workflow.pendingChoices[1].id).toBe('Start a new workspace')
    expect(paused.workflow.resumeHint).toContain('openfox_resume_workflow')

    // 9. Resume it by picking a choice through the dedicated resume tool — the
    // flow a real agent would follow. The mock run then advances past the
    // paused user step and settles on its own.
    const resumed = await call('openfox_resume_workflow', {
      sessionId,
      choice: 'Work in current workspace',
    })
    expect(resumed.json).toMatchObject({ resumed: true, choice: 'Work in current workspace', step: 'Where to work' })

    const settled = await call('openfox_wait', { sessionId, timeout: 60 })
    expect(settled.json.settled).toBe(true)
    expect(['completed', 'blocked']).toContain(settled.json.outcome)
    expect(settled.json.status.state).toBe(settled.json.outcome)

    // 10. A wait on the already-finished session must settle immediately,
    // not stall until timeout
    const rewait = await call('openfox_wait', { sessionId, timeout: 10 })
    expect(rewait.json.settled).toBe(true)
    expect(rewait.json.outcome).toBe(settled.json.outcome)

    // 11. A stop on a settled session reports no active run with a clear
    // reason; the abort of a live run is covered deterministically in the unit tests
    const stoppedRaw = await client.callTool({ name: 'openfox_stop_workflow', arguments: { sessionId } })
    expect(stoppedRaw.isError).toBe(true)
    expect(mcpText(stoppedRaw)).toContain('No active workflow run to stop')

    await client.close()
  }, 120000)

  it('lists sessions for the project with pending counts', async () => {
    const { json } = await listSessions()
    expect(json.sessions.some((s: any) => s.id === sessionId)).toBe(true)
    const entry = json.sessions.find((s: any) => s.id === sessionId)
    expect(entry).toHaveProperty('pendingQuestionCount')
    expect(entry).toHaveProperty('pendingConfirmationCount')

    async function listSessions() {
      const transport = new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`))
      const c = new Client({ name: 'openfox-mcp-e2e-list', version: '0.0.1' })
      await c.connect(transport as any)
      try {
        const raw = await c.callTool({ name: 'openfox_sessions', arguments: {} })
        return { json: JSON.parse(mcpText(raw)) }
      } finally {
        await c.close()
      }
    }
  }, 30000)

  it('creates and deletes a project through the MCP endpoint', async () => {
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { mkdtemp, rm } = await import('node:fs/promises')
    const workdir = await mkdtemp(join(tmpdir(), 'openfox-mcp-project-'))
    const name = `mcp-project-${Date.now()}`

    const transport = new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`))
    const c = new Client({ name: 'openfox-mcp-e2e-project', version: '0.0.1' })
    await c.connect(transport as any)
    try {
      const created = await c.callTool({ name: 'openfox_create_project', arguments: { name, workdir } })
      expect(created.isError).toBeFalsy()
      const project = JSON.parse(mcpText(created)).project
      expect(project).toMatchObject({ name, workdir })
      expect(project.id).toBeTypeOf('string')

      const listed = await c.callTool({ name: 'openfox_projects', arguments: {} })
      expect(JSON.parse(mcpText(listed)).some((p: any) => p.id === project.id)).toBe(true)

      const deleted = await c.callTool({ name: 'openfox_delete_project', arguments: { projectId: project.id } })
      expect(JSON.parse(mcpText(deleted)).deleted).toBe(true)

      const relisted = await c.callTool({ name: 'openfox_projects', arguments: {} })
      expect(JSON.parse(mcpText(relisted)).some((p: any) => p.id === project.id)).toBe(false)

      const again = await c.callTool({ name: 'openfox_delete_project', arguments: { projectId: project.id } })
      expect(JSON.parse(mcpText(again)).deleted).toBe(false)
    } finally {
      await c.close()
      await rm(workdir, { recursive: true, force: true })
    }
  }, 60000)

  it('rejects cross-session answers', async () => {
    const crossDir = await createTestProject({ template: 'typescript' })
    const crossProject = await createProject(server.url, {
      name: 'MCP Cross-Session',
      workdir: crossDir.path,
    })

    const transport = new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`))
    const c = new Client({ name: 'openfox-mcp-e2e-x', version: '0.0.1' })
    await c.connect(transport as any)
    const callX = (name: string, args: Record<string, unknown> = {}) => c.callTool({ name, arguments: args })
    try {
      // Session B drives its own pending question
      const created = JSON.parse(mcpText(await callX('openfox_create_session', { projectId: crossProject.id })))
      const sessionB = created.sessionId as string
      await callX('openfox_send_message', {
        sessionId: sessionB,
        content: 'Please ask the user a question before proceeding with the task.',
      })

      let callIdB: string | null = null
      const deadline = Date.now() + 20000
      while (Date.now() < deadline && !callIdB) {
        const raw = await callX('openfox_answer', { sessionId: sessionB })
        const questions = JSON.parse(mcpText(raw)).questions ?? []
        if (questions.length > 0) callIdB = questions[0].callId
        else await sleep(150)
      }
      expect(callIdB).toBeTruthy()

      // Answering B's pending question from the main session A must be rejected
      const raw = await callX('openfox_answer', { sessionId, callId: callIdB, answer: 'x' })
      expect(raw.isError).toBe(true)
    } finally {
      await c.close()
    }
  }, 60000)
})
