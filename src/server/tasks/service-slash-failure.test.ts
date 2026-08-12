import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../config.js'
import { closeDatabase, initDatabase } from '../db/index.js'
import { createProject } from '../db/projects.js'
import type { TasksService } from './service.js'

const resolveSlashLaunchMock = vi.fn()

vi.mock('./slash.js', () => ({
  resolveSlashLaunch: (...args: unknown[]) => resolveSlashLaunchMock(...args),
}))

interface FakeSM {
  createdSessions: { id: string; projectId: string }[]
  queued: { sessionId: string; content: string }[]
  modes: Map<string, string>
}

function makeSM(): FakeSM & {
  createSession: (projectId: string) => { id: string; projectId: string }
  setMode: (id: string, mode: string) => void
  queueMessage: (sessionId: string, mode: string, content?: string) => void
  addMessage: () => void
  getSession: () => null
} {
  const sm: FakeSM = { createdSessions: [], queued: [], modes: new Map() }
  const counter = { n: 0 }
  return {
    ...sm,
    createSession: (projectId: string) => {
      counter.n += 1
      const s = { id: `s-${counter.n}`, projectId }
      sm.createdSessions.push(s)
      return s
    },
    setMode: (id: string, mode: string) => sm.modes.set(id, mode),
    queueMessage: (sessionId: string, _mode: string, content?: string) => {
      sm.queued.push({ sessionId, content: content ?? '' })
    },
    addMessage: () => undefined,
    getSession: () => null,
  }
}

describe('project tasks service — slash resolver failure handling', () => {
  let root: string
  let projectId: string
  let service: TasksService
  let sm: ReturnType<typeof makeSM>
  let launchWorkflow: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
    root = await mkdtemp(join(tmpdir(), 'openfox-tasks-slashfail-'))
    await mkdir(join(root, 'nested'), { recursive: true })
    projectId = createProject('Slash Fail', root).id

    sm = makeSM()
    launchWorkflow = vi.fn()
    resolveSlashLaunchMock.mockReset()
    const { createTasksService } = await import('./service.js')
    service = createTasksService({
      sessionManager: sm as never,
      config: loadConfig(),
      broadcast: () => undefined,
      configDir: join(root, 'config'),
      launchWorkflow: launchWorkflow as never,
    })
  })

  afterEach(async () => {
    closeDatabase()
    await rm(root, { recursive: true, force: true })
  })

  it('degrades to the raw prompt when resolution throws', async () => {
    resolveSlashLaunchMock.mockRejectedValue(new Error('corrupt config'))
    const task = service.create(projectId, { prompt: '/broken cmd' }, { actor: 'human' })
    const result = await service.move(projectId, task.id, 'in_progress', { actor: 'human' })

    expect(result.task.status).toBe('in_progress')
    expect(launchWorkflow).not.toHaveBeenCalled()
    expect(sm.queued).toHaveLength(1)
    expect(sm.queued[0]?.content).toBe('/broken cmd')
  })

  it('launches a workflow when resolution succeeds', async () => {
    resolveSlashLaunchMock.mockResolvedValue({ kind: 'workflow', workflowId: 'wf', params: { a: '1' } })
    const task = service.create(projectId, { prompt: '/wf hi' }, { actor: 'human' })
    const result = await service.move(projectId, task.id, 'in_progress', { actor: 'human' })

    expect(launchWorkflow).toHaveBeenCalledTimes(1)
    expect(launchWorkflow.mock.calls[0]![0]).toBe(result.sessionId)
    expect(launchWorkflow.mock.calls[0]![1]).toMatchObject({ workflowId: 'wf', params: { a: '1' } })
    expect(sm.queued).toHaveLength(0)
  })
})
