import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../config.js'
import { closeDatabase, initDatabase } from '../db/index.js'
import { createProject } from '../db/projects.js'
import { createTasksService, isTaskGateError, isTaskConflictError } from './service.js'
import type { TasksService } from './service.js'
import type { TasksUpdatePayload } from '../../shared/protocol.js'
import type { Attachment } from '../../shared/types.js'

interface FakeSession {
  id: string
  projectId: string
  title?: string
  messages?: unknown[]
  isRunning?: boolean
}

interface FakeExecution {
  workflowId: string
  status: string
}

interface FakeSessionManager {
  createdSessions: FakeSession[]
  reminders: { sessionId: string; content: string; metadata?: unknown }[]
  queued: { sessionId: string; content: string; attachments?: Attachment[] }[]
  sessions: Map<string, FakeSession>
  modes: Map<string, string>
  executions: Map<string, FakeExecution>
}

function makeSessionManager(): FakeSessionManager & {
  createSession: (projectId: string, ...rest: unknown[]) => FakeSession
  addMessage: (sessionId: string, message: unknown) => void
  queueMessage: (sessionId: string, mode: string, content?: string, attachments?: Attachment[]) => void
  setMode: (sessionId: string, mode: string) => void
  getSession: (id: string) => FakeSession | null
  getLatestWorkflowExecution: (id: string) => FakeExecution | null
} {
  const mgr = {
    createdSessions: [] as FakeSession[],
    reminders: [] as { sessionId: string; content: string; metadata?: unknown }[],
    queued: [] as { sessionId: string; content: string; attachments?: Attachment[] }[],
    sessions: new Map<string, FakeSession>(),
    modes: new Map<string, string>(),
    executions: new Map<string, FakeExecution>(),
  }

  const counter = { n: 0 }

  return {
    ...mgr,
    createSession: (_pid: string, title?: unknown) => {
      counter.n += 1
      const session: FakeSession = { id: `sess-${counter.n}`, projectId: _pid }
      if (typeof title === 'string' && title.length > 0) session.title = title
      mgr.createdSessions.push(session)
      mgr.sessions.set(session.id, session)
      return session
    },
    addMessage: (sessionId: string, message: unknown) => {
      mgr.reminders.push({
        sessionId,
        content: (message as { content: string }).content,
        metadata: (message as { metadata?: unknown }).metadata,
      })
    },
    queueMessage: (sessionId: string, _mode: string, content?: string, attachments?: Attachment[]) => {
      mgr.queued.push({ sessionId, content: content ?? '', ...(attachments ? { attachments } : {}) })
    },
    setMode: (sessionId: string, mode: string) => {
      mgr.modes.set(sessionId, mode)
    },
    getSession: (id: string) => mgr.sessions.get(id) ?? null,
    getLatestWorkflowExecution: (id: string) => mgr.executions.get(id) ?? null,
  }
}

describe('project tasks service', () => {
  let root: string
  let projectId: string
  let service: TasksService
  let broadcasts: TasksUpdatePayload[]
  let sm: ReturnType<typeof makeSessionManager>
  let launchSpy: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)

    root = await mkdtemp(join(tmpdir(), 'openfox-tasks-'))
    await mkdir(join(root, 'nested'), { recursive: true })
    projectId = createProject('Tasks Test', root).id

    // Fixture slash config: a command and a workflow the service resolves at seed time.
    const configDir = join(root, 'config')
    await mkdir(join(configDir, 'commands'), { recursive: true })
    await mkdir(join(configDir, 'workflows'), { recursive: true })
    await writeFile(
      join(configDir, 'commands', 'fixme.command.md'),
      '---\nid: fixme\nname: Fix me\nagentMode: builder\n---\n\nFix the {{issue}} bug in {{file}}.',
    )
    await writeFile(
      join(configDir, 'workflows', 'fixit.workflow.json'),
      JSON.stringify({
        metadata: {
          id: 'fixit',
          name: 'Fix it',
          description: 'fixture',
          version: '1.0.0',
          parameters: [
            { id: 'issue', label: 'Issue', position: 0 },
            { id: 'file', label: 'File', position: 1 },
          ],
        },
        entryStep: 'do_it',
        settings: { maxIterations: 5 },
        steps: [
          {
            id: 'do_it',
            name: 'Do it',
            type: 'agent',
            phase: 'build',
            prompt: 'Fix {{issue}} in {{file}}',
            transitions: [{ when: { type: 'always' }, goto: '$done' }],
          },
        ],
        startCondition: { type: 'always' },
      }),
    )
    await writeFile(
      join(configDir, 'workflows', 'reqwf.workflow.json'),
      JSON.stringify({
        metadata: {
          id: 'reqwf',
          name: 'Req WF',
          description: 'fixture',
          version: '1.0.0',
          parameters: [{ id: 'issue', label: 'Issue', position: 0, required: true }],
        },
        entryStep: 'do_it',
        settings: { maxIterations: 5 },
        steps: [
          {
            id: 'do_it',
            name: 'Do it',
            type: 'agent',
            phase: 'build',
            prompt: 'Fix {{issue}}',
            transitions: [{ when: { type: 'always' }, goto: '$done' }],
          },
        ],
        startCondition: { type: 'always' },
      }),
    )

    broadcasts = []
    sm = makeSessionManager()
    launchSpy = vi.fn()
    const configWithDefault = loadConfig()
    service = createTasksService({
      sessionManager: sm as unknown as import('../session/manager.js').SessionManager,
      config: configWithDefault,
      broadcast: (_pid, payload) => broadcasts.push(payload),
      configDir,
      launchWorkflow: launchSpy as never,
    })
  })

  afterEach(async () => {
    closeDatabase()
    await rm(root, { recursive: true, force: true })
  })

  const create = (prompt: string, extra: Record<string, unknown> = {}) =>
    service.create(projectId, { prompt, ...extra }, { actor: 'human' })

  it('creates a task in Backlog and broadcasts', () => {
    const task = create('Fix the login flow\nIt is broken')
    expect(task.status).toBe('backlog')
    expect(task.prompt).toBe('Fix the login flow\nIt is broken')
    expect(task.auditTrail[0]?.action).toBe('create')
    expect(broadcasts.at(-1)?.tasks).toHaveLength(1)
  })

  it('assigns compact hexadecimal ids', () => {
    const task = create('Compact id task')
    expect(task.id).toMatch(/^[0-9a-f]{16}$/)
    expect(task.id.length).toBeLessThan(36)
  })

  it('rejects a task with neither text nor attachments', () => {
    expect(() => service.create(projectId, { prompt: '   ' }, { actor: 'human' })).toThrow(/prompt or an attachment/)
  })

  it('accepts an attachment-only task', () => {
    const att: Attachment = {
      id: 'a1',
      filename: 'pic.png',
      mimeType: 'image/png',
      size: 10,
      data: 'data:image/png;base64,x',
    }
    const task = create('', { attachments: [att] })
    expect(task.attachments).toHaveLength(1)
  })

  it('duplicates a task into Backlog', () => {
    const task = create('Original prompt')
    const copy = service.duplicate(projectId, task.id, { actor: 'human' })
    expect(copy.id).not.toBe(task.id)
    expect(copy.status).toBe('backlog')
    expect(copy.prompt).toBe('Original prompt')
  })

  describe('launch & slots', () => {
    it('breaks In Progress counts into running and queued', async () => {
      const first = create('First')
      const second = create('Second')
      await service.move(projectId, first.id, 'in_progress', { actor: 'human' })
      await service.move(projectId, second.id, 'in_progress', { actor: 'human' }) // queued

      const snapshot = service.snapshot(projectId)
      expect(snapshot.counts).toMatchObject({ todo: 0, inProgress: 2, running: 1, queued: 1, done: 0 })
    })

    it('human move to In Progress creates + seeds a session, runs when a slot is free', async () => {
      const task = create('Do the thing')
      const result = await service.move(projectId, task.id, 'in_progress', { actor: 'human' })

      expect(sm.createdSessions).toHaveLength(1)
      const session = sm.createdSessions[0]!
      expect(result.sessionId).toBe(session.id)
      expect(result.task.status).toBe('in_progress')
      expect(result.task.runState).toBe('running')
      expect(result.task.activeSessionId).toBe(session.id)
      // Reminder precedes the prompt, wrapped in <system-reminder>
      expect(sm.reminders[0]?.sessionId).toBe(session.id)
      expect(sm.reminders[0]?.content).toContain('<system-reminder>')
      expect(sm.reminders[0]?.metadata).toMatchObject({ type: 'task' })
      // No plan yet: the session starts through the bundled plan workflow,
      // seeded with the task prompt as user content.
      expect(launchSpy).toHaveBeenCalledTimes(1)
      expect(launchSpy.mock.calls[0]![1]).toMatchObject({ workflowId: 'plan', content: 'Do the thing' })
    })

    it('seeds the session without a prompt-derived title so auto-naming applies', async () => {
      const task = create('Investigate and fix the flaky test in CI')
      await service.move(projectId, task.id, 'in_progress', { actor: 'human' })

      expect(sm.createdSessions).toHaveLength(1)
      expect(sm.createdSessions[0]!.title).toBeUndefined()
    })

    it('second task queues when the single slot is busy', async () => {
      const first = create('First')
      const second = create('Second')
      await service.move(projectId, first.id, 'in_progress', { actor: 'human' })
      const result = await service.move(projectId, second.id, 'in_progress', { actor: 'human' })

      expect(result.task.runState).toBe('queued')
      expect(sm.createdSessions).toHaveLength(1) // no new session for queued
    })

    it('human move to In Progress parks in the queue when auto-launch is paused', async () => {
      const task = create('Paused arrival')
      service.setSettings(projectId, { queuePaused: true })
      const result = await service.move(projectId, task.id, 'in_progress', { actor: 'human' })

      expect(result.task.status).toBe('in_progress')
      expect(result.task.runState).toBe('queued')
      // Paused queue: the task parks without seeding or launching anything.
      expect(sm.createdSessions).toHaveLength(0)
      expect(launchSpy).not.toHaveBeenCalled()
    })

    it('surfaces the FIFO queue position server-side (1-based)', async () => {
      const first = create('First')
      const second = create('Second')
      const third = create('Third')
      await service.move(projectId, first.id, 'in_progress', { actor: 'human' })
      await service.move(projectId, second.id, 'in_progress', { actor: 'human' })
      await service.move(projectId, third.id, 'in_progress', { actor: 'human' })

      expect(service.get(projectId, second.id)!.queuePosition).toBe(1)
      expect(service.get(projectId, third.id)!.queuePosition).toBe(2)
      // Running tasks have no queue position
      expect(service.get(projectId, first.id)!.queuePosition).toBeUndefined()
    })

    it('human move with an explicit project sessionId binds to it instead of seeding a new session', async () => {
      const task = create('Start me here')
      sm.sessions.set('sess-current', { id: 'sess-current', projectId, messages: [] })

      const result = await service.move(projectId, task.id, 'in_progress', {
        actor: 'human',
        sessionId: 'sess-current',
      })

      expect(sm.createdSessions).toHaveLength(0)
      expect(result.sessionId).toBe('sess-current')
      expect(result.task.status).toBe('in_progress')
      expect(result.task.runState).toBe('running')
      expect(result.task.activeSessionId).toBe('sess-current')
      // Reminder + queued prompt land in the bound session, like a seeded one.
      expect(sm.reminders[0]?.sessionId).toBe('sess-current')
      expect(sm.reminders[0]?.content).toContain('<system-reminder>')
      expect(launchSpy.mock.calls[0]![0]).toBe('sess-current')
      expect(launchSpy.mock.calls[0]![1]).toMatchObject({ workflowId: 'plan', content: 'Start me here' })
    })

    it('falls back to seeding a new session when the supplied sessionId is foreign', async () => {
      const task = create('Foreign target')
      sm.sessions.set('sess-foreign', { id: 'sess-foreign', projectId: 'another-project', messages: [] })

      const result = await service.move(projectId, task.id, 'in_progress', {
        actor: 'human',
        sessionId: 'sess-foreign',
      })

      expect(sm.createdSessions).toHaveLength(1)
      const seeded = sm.createdSessions[0]!
      expect(result.sessionId).toBe(seeded.id)
      expect(result.task.activeSessionId).toBe(seeded.id)
      expect(sm.reminders[0]?.sessionId).toBe(seeded.id)
    })

    it('does not reuse a target session that already has messages (seeds fresh instead)', async () => {
      const task = create('Busy session')
      sm.sessions.set('sess-busy', { id: 'sess-busy', projectId, messages: [{ id: 'm1' }] })

      const result = await service.move(projectId, task.id, 'in_progress', {
        actor: 'human',
        sessionId: 'sess-busy',
      })

      expect(sm.createdSessions).toHaveLength(1)
      const seeded = sm.createdSessions[0]!
      expect(result.sessionId).toBe(seeded.id)
      expect(result.task.activeSessionId).toBe(seeded.id)
      expect(result.task.sessionIds).toEqual([seeded.id])
    })

    it('honors the earmarked session when a queued task auto-launches later', async () => {
      const first = create('Occupying the slot')
      const second = create('Queued with a home')
      sm.sessions.set('sess-home', { id: 'sess-home', projectId, messages: [] })

      await service.move(projectId, first.id, 'in_progress', { actor: 'human' })
      const queued = await service.move(projectId, second.id, 'in_progress', {
        actor: 'human',
        sessionId: 'sess-home',
      })
      expect(queued.task.runState).toBe('queued')
      expect(queued.task.sessionIds).toEqual(['sess-home'])
      expect(sm.createdSessions).toHaveLength(1) // nothing seeded at queue time

      // Free the slot — the queued task launches INTO its earmarked session.
      await service.move(projectId, first.id, 'todo', { actor: 'human' })
      const launched = service.get(projectId, second.id)!
      expect(launched.runState).toBe('running')
      expect(launched.activeSessionId).toBe('sess-home')
      expect(sm.createdSessions).toHaveLength(1) // still no orphan session
      expect(sm.reminders.some((r) => r.sessionId === 'sess-home')).toBe(true)
      expect(launchSpy.mock.calls.some((c) => c[0] === 'sess-home')).toBe(true)
    })

    it('agent move binds the current session and never creates a new one', async () => {
      const task = create('Agent task')
      const agentSession = { id: 'sess-agent', projectId }
      sm.sessions.set('sess-agent', agentSession)

      const result = await service.move(projectId, task.id, 'in_progress', {
        actor: 'agent',
        sessionId: 'sess-agent',
      })
      expect(sm.createdSessions).toHaveLength(0)
      expect(result.task.activeSessionId).toBe('sess-agent')
      expect(result.task.runState).toBe('running')
      expect(sm.reminders[0]?.sessionId).toBe('sess-agent')
    })

    it('reverting a running task to To Do frees the slot and auto-launches the next queued task', async () => {
      const first = create('First')
      const second = create('Second')
      await service.move(projectId, first.id, 'in_progress', { actor: 'human' })
      await service.move(projectId, second.id, 'in_progress', { actor: 'human' })

      const result = await service.move(projectId, first.id, 'todo', { actor: 'human' })
      const secondFresh = service.get(projectId, second.id)!

      expect(secondFresh.status).toBe('in_progress')
      expect(secondFresh.runState).toBe('running')
      expect(sm.createdSessions).toHaveLength(2)
      expect(result.autoLaunched?.taskId).toBe(second.id)
      expect(result.autoLaunched?.projectId).toBe(projectId)
      expect(result.autoLaunched?.sessionId).toBeTruthy()
      // The reverted task keeps its session attached (link merely deactivated).
      expect(service.get(projectId, first.id)!.activeSessionId).toBeUndefined()
      expect(service.get(projectId, first.id)!.sessionIds).toHaveLength(1)
    })

    it('paused queue suppresses auto-launch', async () => {
      const first = create('First')
      const second = create('Second')
      await service.move(projectId, first.id, 'in_progress', { actor: 'human' })
      service.setSettings(projectId, { queuePaused: true })
      await service.move(projectId, second.id, 'in_progress', { actor: 'human' })
      expect(service.get(projectId, second.id)!.runState).toBe('queued')

      await service.move(projectId, first.id, 'todo', { actor: 'human' })
      expect(service.get(projectId, second.id)!.runState).toBe('queued')
      expect(sm.createdSessions).toHaveLength(1)

      // Unpausing kicks the queue
      service.setSettings(projectId, { queuePaused: false })
      expect(service.get(projectId, second.id)!.runState).toBe('running')
      expect(sm.createdSessions).toHaveLength(2)
    })
  })

  describe('gates (definition of done)', () => {
    const configureDoneGate = () =>
      service.setGateConfig(
        projectId,
        [
          {
            id: 'commit',
            name: 'Commit',
            description: 'work committed with a commit reference',
            required: true,
            variant: 'done',
          },
        ],
        { actor: 'human' },
      )

    it('blocks Review until required gates carry a value, with an actionable error', async () => {
      configureDoneGate()
      const task = create('Ship it')
      await service.move(projectId, task.id, 'in_progress', { actor: 'human' })

      const promise = service.move(projectId, task.id, 'review', { actor: 'human' })
      await expect(promise).rejects.toSatisfy(isTaskGateError)
      await promise.catch((err: unknown) => {
        if (isTaskGateError(err)) {
          expect(err.missing.map((m) => m.gateId)).toContain('commit')
          expect(err.task.status).toBe('in_progress')
        } else {
          throw err
        }
      })
      expect(service.get(projectId, task.id)!.status).toBe('in_progress')
    })

    it('records gate value actor + timestamp, then permits Review', async () => {
      configureDoneGate()
      const task = create('Ship it')
      await service.move(projectId, task.id, 'in_progress', { actor: 'human' })
      await service.setGateValue(
        projectId,
        task.id,
        'commit',
        'abc123',
        { actor: 'agent', actorName: 'builder' },
        'sess-agent',
      )

      const withValue = service.get(projectId, task.id)!
      expect(withValue.gateValues[0]).toMatchObject({ gateId: 'commit', value: 'abc123', actor: 'agent' })
      expect(withValue.gateValues[0]?.timestamp).toBeTruthy()

      const result = await service.move(projectId, task.id, 'review', { actor: 'agent', sessionId: 'sess-agent' })
      expect(result.task.status).toBe('review')
      // Review reminder landed in the bound session with gate evidence
      const doneReminder = sm.reminders.find((r) => r.content.includes('moved to Review'))
      expect(doneReminder).toBeTruthy()
      expect(doneReminder?.content).toContain('abc123')
    })

    it('reopening a Done task creates a fresh session and keeps history links', async () => {
      configureDoneGate()
      const task = create('Iterate')
      await service.move(projectId, task.id, 'in_progress', { actor: 'human' })
      const firstSession = sm.createdSessions[0]!.id
      await service.setGateValue(projectId, task.id, 'commit', 'aaa', { actor: 'human' })
      await service.move(projectId, task.id, 'done', { actor: 'human' })

      const reopened = await service.move(projectId, task.id, 'in_progress', { actor: 'human' })
      expect(reopened.task.runState).toBe('running')
      expect(reopened.task.activeSessionId).not.toBe(firstSession)
      expect(reopened.task.sessionIds).toContain(firstSession)
      expect(reopened.task.sessionIds).toContain(reopened.task.activeSessionId)
      expect(sm.createdSessions).toHaveLength(2)
    })

    it('reverting Done to To Do records the reason in the audit trail', async () => {
      configureDoneGate()
      const task = create('Ship it')
      await service.move(projectId, task.id, 'in_progress', { actor: 'human' })
      await service.setGateValue(projectId, task.id, 'commit', 'abc', { actor: 'human' })
      await service.move(projectId, task.id, 'done', { actor: 'human' })

      await service.move(projectId, task.id, 'todo', { actor: 'human', reason: 'customer rejected the change' })
      const reverted = service.get(projectId, task.id)!
      expect(reverted.status).toBe('todo')
      expect(reverted.auditTrail.at(-1)?.detail).toContain('customer rejected the change')
    })

    it('reconfiguring gates prunes values for removed gates', async () => {
      service.setGateConfig(
        projectId,
        [{ id: 'commit', name: 'Commit', description: 'need a sha', required: true, variant: 'done' }],
        { actor: 'human' },
      )
      const task = create('Prune me')
      await service.setGateValue(projectId, task.id, 'commit', 'abc', { actor: 'human' })
      expect(service.get(projectId, task.id)!.gateValues).toHaveLength(1)

      // Drop the gate — its values must disappear with it.
      service.setGateConfig(
        projectId,
        [{ id: 'green', name: 'All green', description: '', required: true, variant: 'done' }],
        {
          actor: 'human',
        },
      )
      const pruned = service.get(projectId, task.id)!
      expect(pruned.gateValues).toHaveLength(0)
    })

    it('reports the blocked transition when a ready gate blocks In Progress', async () => {
      service.setGateConfig(
        projectId,
        [
          {
            id: 'design',
            name: 'Design approved',
            description: 'sign-off before work',
            required: true,
            variant: 'ready',
          },
        ],
        { actor: 'human' },
      )
      const task = create('Needs approval')
      const promise = service.move(projectId, task.id, 'in_progress', { actor: 'human' })
      await expect(promise).rejects.toSatisfy(isTaskGateError)
      await promise.catch((err: unknown) => {
        if (isTaskGateError(err)) {
          expect(err.message).toContain('In Progress')
          expect(err.missing.map((m) => m.gateId)).toContain('design')
        } else {
          throw err
        }
      })
      expect(service.get(projectId, task.id)!.status).toBe('backlog')
    })
  })

  describe('review flow & planning', () => {
    it('refuses an agent move to Done — only the user closes a task', async () => {
      const task = create('Agent done attempt')
      await service.move(projectId, task.id, 'in_progress', { actor: 'agent', sessionId: 'sess-x' })
      await expect(service.move(projectId, task.id, 'done', { actor: 'agent', sessionId: 'sess-x' })).rejects.toThrow(
        /Only the user can move a task to Done/,
      )
      expect(service.get(projectId, task.id)!.status).toBe('in_progress')
    })

    it('lets the human move a Review task to Done manually', async () => {
      const task = create('Human closes it')
      await service.move(projectId, task.id, 'in_progress', { actor: 'human' })
      await service.move(projectId, task.id, 'review', { actor: 'human' })
      const closed = await service.move(projectId, task.id, 'done', { actor: 'human' })
      expect(closed.task.status).toBe('done')
    })

    it('moves Backlog to To Do without creating a session until Start plan is clicked', async () => {
      const task = create('Plan me later')
      const result = await service.move(projectId, task.id, 'todo', { actor: 'human' })

      expect(result.task.status).toBe('todo')
      // No planner session is prepared on the move — only "Start plan" creates one.
      expect(sm.createdSessions).toHaveLength(0)
      expect(result.sessionId).toBeUndefined()
      expect(result.task.runState).toBeUndefined()
      expect(result.task.activeSessionId).toBeUndefined()
      expect(sm.queued).toHaveLength(0)
      expect(launchSpy).not.toHaveBeenCalled()
    })

    describe('start plan', () => {
      it('launches the plan workflow in the bound planner session without touching slots', async () => {
        const occupying = create('Occupying the only slot')
        await service.move(projectId, occupying.id, 'in_progress', { actor: 'human' })

        const task = create('Plan me now')
        await service.move(projectId, task.id, 'todo', { actor: 'human' })

        const result = await service.startPlan(projectId, task.id)
        const plannerSession = result.sessionId

        expect(result.sessionId).toBe(plannerSession)
        const planCalls = launchSpy.mock.calls.filter((c) => c[0] === plannerSession)
        expect(planCalls).toHaveLength(1)
        expect(planCalls[0]![1]).toMatchObject({ workflowId: 'plan' })
        const fresh = service.get(projectId, task.id)!
        expect(fresh.status).toBe('todo')
        expect(fresh.runState).toBeUndefined()
        expect(fresh.activeSessionId).toBe(plannerSession)
      })

      it('skips the plan when the linked session already carries criteria', async () => {
        const task = create('Already planned')
        await service.move(projectId, task.id, 'todo', { actor: 'human' })
        await service.startPlan(projectId, task.id)
        const plannerSession = sm.createdSessions.at(-1)!
        ;(plannerSession as { metadataEntries?: Record<string, unknown> }).metadataEntries = {
          criteria: [{ id: 'c1', description: 'x', status: { type: 'pending' } }],
        }
        sm.executions.set(plannerSession.id, { workflowId: 'plan', status: 'completed' })

        const result = await service.move(projectId, task.id, 'in_progress', { actor: 'human' })

        expect(result.task.status).toBe('in_progress')
        expect(result.task.runState).toBe('running')
        expect(result.task.activeSessionId).toBe(plannerSession.id)
        // No extra session — the planner session is resumed into the build.
        expect(sm.createdSessions).toHaveLength(1)
        const buildCalls = launchSpy.mock.calls.filter((c) => c[0] === plannerSession.id)
        expect(buildCalls.at(-1)![1]).toMatchObject({ workflowId: 'default' })
      })

      it('does not resume a finished build session when re-opening — fresh attempt', async () => {
        const task = create('Reopened after build')
        await service.move(projectId, task.id, 'todo', { actor: 'human' })
        await service.startPlan(projectId, task.id)
        const plannerSession = sm.createdSessions.at(-1)!
        ;(plannerSession as { metadataEntries?: Record<string, unknown> }).metadataEntries = {
          criteria: [{ id: 'c1', description: 'x', status: { type: 'pending' } }],
        }
        // The last run in that session was the build, not the plan.
        sm.executions.set(plannerSession.id, { workflowId: 'default', status: 'completed' })

        await service.move(projectId, task.id, 'review', { actor: 'human' })
        await service.move(projectId, task.id, 'done', { actor: 'human' })
        const reopened = await service.move(projectId, task.id, 'in_progress', { actor: 'human' })

        // A brand-new session carries the new attempt; the old one stays as history.
        expect(reopened.task.activeSessionId).not.toBe(plannerSession.id)
        expect(sm.createdSessions).toHaveLength(2)
        expect(reopened.task.sessionIds).toContain(plannerSession.id)
      })

      it('launches the picked workflow when resuming a planned session', async () => {
        const task = create('Picked build')
        await service.move(projectId, task.id, 'todo', { actor: 'human' })
        await service.startPlan(projectId, task.id)
        const plannerSession = sm.createdSessions.at(-1)!
        ;(plannerSession as { metadataEntries?: Record<string, unknown> }).metadataEntries = {
          criteria: [{ id: 'c1', description: 'x', status: { type: 'pending' } }],
        }
        sm.executions.set(plannerSession.id, { workflowId: 'plan', status: 'completed' })

        const picked = service.setWorkflowChoice(projectId, task.id, 'fixit')
        expect(picked.workflowChoice).toBe('fixit')

        await service.move(projectId, task.id, 'in_progress', { actor: 'human' })
        const buildCalls = launchSpy.mock.calls.filter((c) => c[0] === plannerSession.id)
        expect(buildCalls.at(-1)![1]).toMatchObject({ workflowId: 'fixit' })
      })

      it('refuses to start a second plan while one is already running', async () => {
        const task = create('Double click')
        await service.move(projectId, task.id, 'todo', { actor: 'human' })
        await service.startPlan(projectId, task.id)
        const planner = sm.createdSessions.at(-1)!
        planner.isRunning = true

        await expect(service.startPlan(projectId, task.id)).rejects.toThrow(/already running/)
        // Still exactly one plan launch in that session.
        expect(launchSpy.mock.calls.filter((c) => c[0] === planner.id)).toHaveLength(1)
      })

      it('keeps sessions attached across In Progress ↔ To Do round-trips', async () => {
        const task = create('Round tripper')
        await service.move(projectId, task.id, 'todo', { actor: 'human' })
        const first = await service.startPlan(projectId, task.id)
        const planner = sm.sessions.get(first.sessionId)!
        ;(planner as { metadataEntries?: Record<string, unknown> }).metadataEntries = {
          criteria: [{ id: 'c1', description: 'x', status: { type: 'pending' } }],
        }
        sm.executions.set(planner.id, { workflowId: 'plan', status: 'completed' })

        const launched = await service.move(projectId, task.id, 'in_progress', { actor: 'human' })
        expect(launched.task.activeSessionId).toBe(planner.id)

        // Revert to To Do: the link is deactivated but kept — never orphaned.
        await service.move(projectId, task.id, 'todo', { actor: 'human' })
        const parked = service.get(projectId, task.id)!
        expect(parked.activeSessionId).toBeUndefined()
        expect(parked.sessionIds).toEqual([planner.id])

        // Back to In Progress: the same session resumes, no duplicate created.
        const again = await service.move(projectId, task.id, 'in_progress', { actor: 'human' })
        expect(again.task.activeSessionId).toBe(planner.id)
        expect(again.task.sessionIds).toEqual([planner.id])
        expect(sm.createdSessions).toHaveLength(1)
      })

      it('reuses the planner session across Backlog round-trips', async () => {
        const task = create('Ping-ponger')
        await service.move(projectId, task.id, 'todo', { actor: 'human' })
        const first = await service.startPlan(projectId, task.id)
        const planner = first.sessionId

        await service.move(projectId, task.id, 'backlog', { actor: 'human' })
        await service.move(projectId, task.id, 'todo', { actor: 'human' })
        // Start plan on the way back reuses the kept session instead of piling up orphans.
        const second = await service.startPlan(projectId, task.id)

        expect(second.sessionId).toBe(planner)
        expect(sm.createdSessions).toHaveLength(1)
      })
    })

    it('runs a To Do plan without consuming a slot, even when the queue is paused', async () => {
      const task = create('Paused-queue plan')
      service.setSettings(projectId, { queuePaused: true })
      await service.move(projectId, task.id, 'todo', { actor: 'human' })

      const result = await service.startPlan(projectId, task.id)
      expect(result.task.status).toBe('todo')
      expect(result.task.runState).toBeUndefined()
      expect(launchSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('concurrency', () => {
    it('rejects a stale write with a CONFLICT error', async () => {
      const task = create('Race me')
      const staleVersion = task.version
      await service.update(projectId, task.id, { prompt: 'Renamed' }, { actor: 'human' })

      const promise = service.update(projectId, task.id, { prompt: 'other' }, { actor: 'human' }, staleVersion)
      await expect(promise).rejects.toSatisfy(isTaskConflictError)
      await promise.catch((err: unknown) => {
        if (!isTaskConflictError(err)) throw err
      })
    })
  })

  describe('lifecycle', () => {
    it('deleting a running task unlinks sessions and frees its slot', async () => {
      const first = create('First')
      const second = create('Second')
      await service.move(projectId, first.id, 'in_progress', { actor: 'human' })
      await service.move(projectId, second.id, 'in_progress', { actor: 'human' })
      const linkedSession = sm.createdSessions[0]!.id

      await service.remove(projectId, first.id, { actor: 'human' })
      expect(service.get(projectId, first.id)).toBeNull()
      // Next queued task auto-launched
      expect(service.get(projectId, second.id)!.runState).toBe('running')
      expect(sm.createdSessions).toHaveLength(2)
      // The linked session itself is untouched (still tracked by our fake)
      expect(sm.sessions.has(linkedSession)).toBe(true)
    })

    it('reorder moves a task within its column', async () => {
      const a = create('A')
      const b = create('B')
      const c = create('C')
      service.reorder(projectId, c.id, 'backlog', 0)
      const ids = service
        .list(projectId)
        .filter((t) => t.status === 'backlog')
        .map((t) => t.id)
      expect(ids).toEqual([c.id, a.id, b.id])
    })
  })

  describe('reminders', () => {
    it('emits a system reminder with task metadata for each transition', async () => {
      const task = create('Reminder task')
      await service.move(projectId, task.id, 'in_progress', { actor: 'human' })
      const sessionId = sm.createdSessions[0]!.id

      await service.move(projectId, task.id, 'todo', { actor: 'human' })
      const reminders = sm.reminders.filter((r) => r.sessionId === sessionId)
      expect(reminders).toHaveLength(2)
      expect(reminders[1]?.content).toContain('no longer active')
      expect(reminders.every((r) => (r.metadata as { type: string }).type === 'task')).toBe(true)
    })

    it('reports the real previous state in launch reminders (auto-launch from queue)', async () => {
      const first = create('First')
      const second = create('Second')
      await service.move(projectId, first.id, 'in_progress', { actor: 'human' })
      // Human launch from Backlog
      expect(sm.reminders[0]!.content).toContain('Backlog → In Progress')

      // Second queues; freeing the slot auto-launches it into a fresh session.
      await service.move(projectId, second.id, 'in_progress', { actor: 'human' })
      const reminderCount = sm.reminders.length
      await service.move(projectId, first.id, 'todo', { actor: 'human' }) // frees the slot

      const autoReminder = sm.reminders.at(-1)!
      expect(sm.reminders.length).toBeGreaterThan(reminderCount)
      // The opening context must reflect the queued → running transition,
      // not a made-up "todo → In Progress".
      expect(autoReminder.content).toContain('Queued → In Progress')
      expect(autoReminder.content).not.toContain('Backlog → In Progress')
    })

    it('instructs the agent not to move the task or fill gates without approval', async () => {
      const task = create('Reminder task')
      await service.move(projectId, task.id, 'in_progress', { actor: 'human' })
      const sessionId = sm.createdSessions[0]!.id

      const reminder = sm.reminders.find((r) => r.sessionId === sessionId)!
      expect(reminder.content).toContain(
        'Do not move the task, fill gate values, or commit changes without explicit user approval or a system instruction.',
      )
    })

    it('labels a Done re-open reminder with the true previous state', async () => {
      const task = create('Iterate')
      await service.move(projectId, task.id, 'in_progress', { actor: 'human' })
      await service.move(projectId, task.id, 'done', { actor: 'human' })
      await service.move(projectId, task.id, 'in_progress', { actor: 'human' }) // re-open → fresh session

      const reopenReminder = sm.reminders.at(-1)!
      expect(reopenReminder.content).toContain('Done → In Progress')
      expect(reopenReminder.content).not.toContain('To Do → In Progress')
    })
  })

  describe('slash-command seeding', () => {
    it('launches a workflow instead of queueing the raw prompt', async () => {
      const task = create('/fixit crash src/a.ts')
      const result = await service.move(projectId, task.id, 'in_progress', { actor: 'human' })

      expect(launchSpy).toHaveBeenCalledTimes(1)
      expect(launchSpy.mock.calls[0]![0]).toBe(result.sessionId)
      expect(launchSpy.mock.calls[0]![1]).toEqual({
        workflowId: 'fixit',
        params: { issue: 'crash', file: 'src/a.ts' },
        scope: 'auto',
      })
      // No plain chat message queued — the workflow IS the task.
      expect(sm.queued).toHaveLength(0)
      // The situational reminder still opens the session.
      expect(sm.reminders[0]?.sessionId).toBe(result.sessionId)
      expect(sm.reminders[0]?.content).toContain('<system-reminder>')
    })

    it('launches a bundled default workflow with no params', async () => {
      const task = create('/default')
      await service.move(projectId, task.id, 'in_progress', { actor: 'human' })
      expect(launchSpy).toHaveBeenCalledTimes(1)
      expect(launchSpy.mock.calls[0]![1]).toEqual({ workflowId: 'default', params: {}, scope: 'auto' })
    })

    it('expands a command prompt and queues the expanded text instead of the slash line', async () => {
      const task = create('/fixme crash src/a.ts')
      const result = await service.move(projectId, task.id, 'in_progress', { actor: 'human' })

      expect(launchSpy).not.toHaveBeenCalled()
      expect(sm.queued).toHaveLength(1)
      expect(sm.queued[0]?.sessionId).toBe(result.sessionId)
      expect(sm.queued[0]?.content).toBe('Fix the crash bug in src/a.ts.')
      expect(sm.queued[0]?.content).not.toContain('/fixme')
    })

    it('switches the seeded session to the command agentMode', async () => {
      const task = create('/fixme crash src/a.ts')
      const result = await service.move(projectId, task.id, 'in_progress', { actor: 'human' })
      expect(sm.modes.get(result.sessionId!)).toBe('builder')
    })

    it('keeps a task-selected agent when the command declares no agentMode', async () => {
      await writeFile(
        join(root, 'config', 'commands', 'plaincmd.command.md'),
        '---\nid: plaincmd\nname: Plain\n---\n\nDo {{thing}} now',
      )
      const task = create('/plaincmd stuff', { agentId: 'explorer' })
      const result = await service.move(projectId, task.id, 'in_progress', { actor: 'human' })
      expect(sm.modes.get(result.sessionId!)).toBe('explorer')
      expect(sm.queued[0]?.content).toBe('Do stuff now')
    })

    it('plans instead of queuing the raw prompt when a command leaves params unfilled', async () => {
      const task = create('/fixme crash')
      await service.move(projectId, task.id, 'in_progress', { actor: 'human' })
      expect(launchSpy).toHaveBeenCalledTimes(1)
      expect(launchSpy.mock.calls[0]![1]).toMatchObject({ workflowId: 'plan', content: '/fixme crash' })
    })

    it('plans instead of queuing the raw prompt for an unknown slash id', async () => {
      const task = create('/definitely-not-a-thing some args')
      await service.move(projectId, task.id, 'in_progress', { actor: 'human' })
      expect(launchSpy).toHaveBeenCalledTimes(1)
      expect(launchSpy.mock.calls[0]![1]).toMatchObject({
        workflowId: 'plan',
        content: '/definitely-not-a-thing some args',
      })
    })

    it('plans plain prompts, seeded as user content of the plan workflow', async () => {
      const task = create('Just a regular task')
      await service.move(projectId, task.id, 'in_progress', { actor: 'human' })
      expect(launchSpy).toHaveBeenCalledTimes(1)
      expect(launchSpy.mock.calls[0]![1]).toMatchObject({ workflowId: 'plan', content: 'Just a regular task' })
    })

    it('auto-launched queued tasks resolve slash commands too', async () => {
      const first = create('First')
      const second = create('/fixme crash src/a.ts')
      await service.move(projectId, first.id, 'in_progress', { actor: 'human' })
      await service.move(projectId, second.id, 'in_progress', { actor: 'human' })

      // Free the slot — second auto-launches and must seed with the expanded command.
      await service.move(projectId, first.id, 'todo', { actor: 'human' })
      expect(sm.queued.at(-1)?.content).toBe('Fix the crash bug in src/a.ts.')
      expect(sm.queued.at(-1)?.content).not.toContain('/fixme')
    })

    it('forwards task attachments to a launched workflow', async () => {
      const att: Attachment = { id: 'a1', filename: 'note.txt', mimeType: 'text/plain', size: 10, data: 'hi' }
      const task = create('/fixit crash src/a.ts', { attachments: [att] })
      await service.move(projectId, task.id, 'in_progress', { actor: 'human' })
      expect(launchSpy.mock.calls[0]![1].attachments).toEqual([att])
    })

    it('degrades a workflow with a missing required param to the plan instead of wedging a slot', async () => {
      const task = create('/reqwf')
      const result = await service.move(projectId, task.id, 'in_progress', { actor: 'human' })

      // The task still launches (planning first) so no slot is wedged on a dead run.
      expect(result.task.runState).toBe('running')
      expect(launchSpy).toHaveBeenCalledTimes(1)
      expect(launchSpy.mock.calls[0]![1]).toMatchObject({ workflowId: 'plan', content: '/reqwf' })
    })
  })
})
