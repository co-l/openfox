/**
 * Workflow Execution Engine Counters — DB round trip
 *
 * The viewer shows counters that survive a reload: they are persisted per
 * execution, and a resume continues from the persisted values instead of
 * starting over.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig } from '../config.js'
import { closeDatabase, initDatabase } from './index.js'
import { createProject } from './projects.js'
import { createSession } from './sessions.js'
import { createWorkflowExecution, getActiveWorkflowExecution, updateWorkflowExecutionIterations } from './sessions.js'

describe('workflow execution engine counters', () => {
  let sessionA: string
  let sessionB: string

  beforeEach(() => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
    const project = createProject('Project', '/tmp/wf-counters')
    sessionA = createSession(project.id, '/tmp/wf-counters').id
    sessionB = createSession(project.id, '/tmp/wf-counters').id
  })

  afterEach(() => {
    closeDatabase()
  })

  it('starts a fresh execution with zeroed counters and the engine cap', () => {
    createWorkflowExecution('exec-1', sessionA, 'wf', 'WF', undefined, {}, undefined, 50)

    const row = getActiveWorkflowExecution(sessionA)
    expect(row?.iterations).toBe(0)
    expect(row?.total_iterations).toBe(0)
    expect(row?.max_iterations).toBe(50)
  })

  it('persists the exact iteration counters and the per-step counts', () => {
    createWorkflowExecution('exec-1', sessionA, 'wf', 'WF', undefined, {}, undefined, 50)

    updateWorkflowExecutionIterations('exec-1', {
      iterations: 3,
      totalIterations: 9,
      maxIterations: 50,
      stepIterations: { build: 2, verify: 1 },
    })

    const row = getActiveWorkflowExecution(sessionA)
    expect(row?.iterations).toBe(3)
    expect(row?.total_iterations).toBe(9)
    expect(row?.max_iterations).toBe(50)
    expect(JSON.parse(row?.step_iterations ?? '{}')).toEqual({ build: 2, verify: 1 })
  })

  it('keeps the counters of two executions of two sessions apart', () => {
    createWorkflowExecution('exec-a', sessionA, 'wf', 'WF', undefined, {}, undefined, 10)
    createWorkflowExecution('exec-b', sessionB, 'wf', 'WF', undefined, {}, undefined, 10)

    updateWorkflowExecutionIterations('exec-a', { iterations: 2, totalIterations: 2, maxIterations: 10 })
    updateWorkflowExecutionIterations('exec-b', { iterations: 5, totalIterations: 5, maxIterations: 10 })

    expect(getActiveWorkflowExecution(sessionA)?.iterations).toBe(2)
    expect(getActiveWorkflowExecution(sessionB)?.iterations).toBe(5)
  })

  it('accumulates the per-step counts across updates (a resume continues the count)', () => {
    createWorkflowExecution('exec-1', sessionA, 'wf', 'WF', undefined, {}, undefined, 50)

    updateWorkflowExecutionIterations('exec-1', {
      iterations: 1,
      totalIterations: 1,
      maxIterations: 50,
      stepIterations: { build: 1 },
    })
    updateWorkflowExecutionIterations('exec-1', {
      iterations: 2,
      totalIterations: 4,
      maxIterations: 50,
      stepIterations: { build: 3, verify: 1 },
    })

    const row = getActiveWorkflowExecution(sessionA)
    expect(row?.iterations).toBe(2)
    expect(row?.total_iterations).toBe(4)
    expect(JSON.parse(row?.step_iterations ?? '{}')).toEqual({ build: 3, verify: 1 })
  })
})
