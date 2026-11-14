import { beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { closeDatabase, initDatabase } from './index.js'
import {
  getProcessRecord,
  markInterruptedProcesses,
  recordProcessCreated,
  recordProcessExited,
  recordProcessStarted,
  recordProcessStopped,
} from './background-processes.js'

describe('db background processes', () => {
  beforeEach(() => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
  })

  it('records the lifecycle of a process', () => {
    recordProcessCreated('proc-1', 'session-1', 'build', 'npm run build', '/tmp')
    recordProcessStarted('proc-1', 4242)

    let record = getProcessRecord('proc-1')
    expect(record?.status).toBe('running')
    expect(record?.pid).toBe(4242)
    expect(record?.sessionId).toBe('session-1')
    expect(record?.exitCode).toBeNull()

    recordProcessExited('proc-1', 0, null, 'success')
    record = getProcessRecord('proc-1')
    expect(record?.status).toBe('exited')
    expect(record?.exitCode).toBe(0)
    expect(record?.reason).toBe('success')
    expect(record?.endedAt).toBeTruthy()
  })

  it('keeps the signal apart from the exit code', () => {
    recordProcessCreated('proc-2', 'session-1', 'killed', 'sleep 30', '/tmp')
    recordProcessStarted('proc-2', 1)
    recordProcessExited('proc-2', null, 'SIGTERM', 'signalled')

    const record = getProcessRecord('proc-2')
    expect(record?.signal).toBe('SIGTERM')
    expect(record?.reason).toBe('signalled')
  })

  it('records a stopped process', () => {
    recordProcessCreated('proc-3', 'session-1', 'stopped', 'sleep 30', '/tmp')
    recordProcessStarted('proc-3', 1)
    recordProcessStopped('proc-3', 'cancelled')

    const record = getProcessRecord('proc-3')
    expect(record?.status).toBe('stopped')
    expect(record?.reason).toBe('cancelled')
  })

  it('marks still-running processes as interrupted on startup', () => {
    recordProcessCreated('proc-4', 'session-1', 'running', 'sleep 30', '/tmp')
    recordProcessStarted('proc-4', 1)
    recordProcessCreated('proc-5', 'session-1', 'done', 'exit 0', '/tmp')
    recordProcessStarted('proc-5', 2)
    recordProcessExited('proc-5', 0, null, 'success')

    const changed = markInterruptedProcesses()

    expect(changed).toBe(1)
    expect(getProcessRecord('proc-4')?.status).toBe('interrupted')
    expect(getProcessRecord('proc-4')?.reason).toBe('interrupted')
    // A finished process keeps its real outcome.
    expect(getProcessRecord('proc-5')?.status).toBe('exited')
    expect(getProcessRecord('proc-5')?.reason).toBe('success')
  })

  it('returns undefined for an unknown process', () => {
    expect(getProcessRecord('nope')).toBeUndefined()
  })
})
