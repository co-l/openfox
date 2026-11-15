/**
 * Session Manager — Workflow Notifications & Scope
 *
 * AC12 — a workflow counter/step update must not trigger a full
 * `session_updated` broadcast (it would rebuild and rebroadcast the whole
 * message list on every iteration).
 * AC11 — the execution carries the scope the running definition came from.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { loadConfig } from '../config.js'
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js'
import { createProject } from '../db/projects.js'
import { createSession } from '../db/sessions.js'
import { initEventStore, getEventStore } from '../events/index.js'
import { SessionManager } from './manager.js'

describe('SessionManager — workflow notifications', () => {
  let manager: SessionManager
  let sessionId: string

  // The manager resolves the model context when it builds a session; a stub
  // keeps this test focused on the notification behaviour.
  const providerManagerStub = {
    getCurrentModelContext: vi.fn(() => ({ maxTokens: 128000 })),
    getModel: vi.fn(() => 'test-model'),
  } as never

  beforeEach(() => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
    initEventStore(getDatabase())
    const project = createProject('Project', '/tmp/wf-notify')
    sessionId = createSession(project.id, '/tmp/wf-notify').id
    manager = new SessionManager(providerManagerStub)
  })

  afterEach(() => {
    closeDatabase()
  })

  it('emits no session_updated when the counters are updated', () => {
    const events: unknown[] = []
    const unsubscribe = manager.subscribe((event) => {
      if (event.type === 'session_updated') events.push(event)
    })
    try {
      manager.startWorkflow(sessionId, 'exec-1', 'wf', 'WF', undefined, {}, undefined, 50, 'project')

      const before = events.length
      manager.updateWorkflowIterations(sessionId, 'exec-1', {
        iterations: 3,
        totalIterations: 3,
        maxIterations: 50,
        stepIterations: { build: 3 },
      })

      // The counter update must not add a full session broadcast.
      expect(events.length).toBe(before)
    } finally {
      unsubscribe()
    }
  })

  it('emits no session_updated when the current step is updated', () => {
    const events: unknown[] = []
    const unsubscribe = manager.subscribe((event) => {
      if (event.type === 'session_updated') events.push(event)
    })
    try {
      manager.startWorkflow(sessionId, 'exec-1', 'wf', 'WF', undefined, {}, undefined, 50, 'project')

      const before = events.length
      manager.updateWorkflowStep(sessionId, 'exec-1', 'build', 'Builder', 'wf', 'WF', undefined, {
        iterations: 1,
        totalIterations: 1,
        maxIterations: 50,
        stepIterations: { build: 1 },
      })

      expect(events.length).toBe(before)
    } finally {
      unsubscribe()
    }
  })

  it('does not rebroadcast counters the previous step event already carried', () => {
    manager.startWorkflow(sessionId, 'exec-1', 'wf', 'WF', undefined, {}, undefined, 50, 'project')
    const counters = { iterations: 1, totalIterations: 1, maxIterations: 50, stepIterations: { build: 1 } }
    manager.updateWorkflowStep(sessionId, 'exec-1', 'build', 'Builder', 'wf', 'WF', undefined, counters)

    const countEvents = () =>
      getEventStore()
        .getEvents(sessionId)
        .filter((event) => event.type === 'workflow.execution_changed').length
    const before = countEvents()

    // The terminal paths republish the counters the step event just shipped.
    manager.updateWorkflowIterations(sessionId, 'exec-1', counters, { workflowId: 'wf', workflowName: 'WF' })

    expect(countEvents()).toBe(before)
  })

  it('still broadcasts counters that actually changed', () => {
    manager.startWorkflow(sessionId, 'exec-1', 'wf', 'WF', undefined, {}, undefined, 50, 'project')
    const countEvents = () =>
      getEventStore()
        .getEvents(sessionId)
        .filter((event) => event.type === 'workflow.execution_changed').length
    const before = countEvents()

    manager.updateWorkflowIterations(
      sessionId,
      'exec-1',
      { iterations: 2, totalIterations: 2, maxIterations: 50, stepIterations: { build: 2 } },
      { workflowId: 'wf', workflowName: 'WF' },
    )

    expect(countEvents()).toBe(before + 1)
  })

  it('persists the counters so the UI stays exact after the update', () => {
    manager.startWorkflow(sessionId, 'exec-1', 'wf', 'WF', undefined, {}, undefined, 50, 'project')
    manager.updateWorkflowIterations(sessionId, 'exec-1', {
      iterations: 4,
      totalIterations: 9,
      maxIterations: 50,
      stepIterations: { build: 4 },
    })

    const exec = manager.getActiveWorkflowExecution(sessionId)
    expect(exec?.iterations).toBe(4)
    expect(exec?.totalIterations).toBe(9)
    expect(exec?.maxIterations).toBe(50)
    expect(exec?.stepIterations).toEqual({ build: 4 })
  })

  it('exposes the runtime scope of the execution', () => {
    manager.startWorkflow(sessionId, 'exec-1', 'wf', 'WF', undefined, {}, undefined, 50, 'project')

    expect(manager.getActiveWorkflowExecution(sessionId)?.workflowScope).toBe('project')
  })

  it('leaves the scope undefined when the caller does not provide one', () => {
    manager.startWorkflow(sessionId, 'exec-1', 'wf', 'WF', undefined, {}, undefined, 50)

    expect(manager.getActiveWorkflowExecution(sessionId)?.workflowScope).toBeUndefined()
  })
})
