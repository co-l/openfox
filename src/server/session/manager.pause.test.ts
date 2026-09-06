import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const { getLspManagerMock, shutdownLspManagerMock } = vi.hoisted(() => ({
  getLspManagerMock: vi.fn(() => ({ name: 'mock-lsp' })),
  shutdownLspManagerMock: vi.fn(async () => {}),
}))

vi.mock('../lsp/index.js', () => ({
  getLspManager: getLspManagerMock,
  shutdownLspManager: shutdownLspManagerMock,
}))

const mockGetGitBranch = vi.fn()

vi.mock('../git/workspace.js', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    getGitBranch: (...args: any[]) => mockGetGitBranch(...args),
  }
})

import { loadConfig } from '../config.js'
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js'
import { createProject } from '../db/projects.js'
import { initEventStore } from '../events/index.js'
import { SessionManager, type SessionEvent } from './manager.js'

const mockProviderManager = {
  getCurrentModelContext: vi.fn(() => 200000),
  getLLMClient: vi.fn(() => ({ getModel: vi.fn(() => 'global-model'), getBackend: vi.fn(() => 'unknown') })),
  createClient: vi.fn(),
  getActiveProviderId: vi.fn(() => 'test-provider'),
  getCurrentModel: vi.fn(() => 'global-model'),
  getProviders: vi.fn(() => []),
  getDefaultModelSelection: vi.fn(() => 'default-provider/default-model'),
  getModelSettings: vi.fn(),
  resolveModelEffort: vi.fn(),
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('SessionManager pause state', () => {
  let workdir: string
  let projectId: string
  let manager: SessionManager
  let sessionId: string
  const pauseEvents: SessionEvent[] = []

  beforeEach(async () => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
    initEventStore(getDatabase())

    workdir = await mkdtemp(join(tmpdir(), 'openfox-session-pause-'))
    projectId = createProject('OpenFox', workdir).id
    manager = new SessionManager(mockProviderManager as any)
    mockGetGitBranch.mockResolvedValue(null)

    sessionId = manager.createSession(projectId).id
    pauseEvents.length = 0
    manager.subscribe((event) => {
      if (event.type === 'pause_changed') pauseEvents.push(event)
    })
  })

  afterEach(async () => {
    closeDatabase()
    await rm(workdir, { recursive: true, force: true })
  })

  it('defaults to "none" and exposes it on the session object (state parity)', () => {
    expect(manager.getPauseState(sessionId)).toBe('none')
    expect(manager.getSession(sessionId)?.pauseState).toBe('none')
  })

  it('requestPause moves none→pending, broadcasts, and rejects a second pause', () => {
    expect(manager.requestPause(sessionId)).toBe(true)
    expect(manager.getPauseState(sessionId)).toBe('pending')
    expect(manager.getSession(sessionId)?.pauseState).toBe('pending')
    expect(pauseEvents.map((e) => (e.type === 'pause_changed' ? e.pauseState : null))).toEqual(['pending'])
    expect(manager.requestPause(sessionId)).toBe(false)
  })

  it('requestResume cancels a pending pause (pending→none)', () => {
    manager.requestPause(sessionId)
    expect(manager.requestResume(sessionId)).toBe(true)
    expect(manager.getPauseState(sessionId)).toBe('none')
    expect(manager.getSession(sessionId)?.pauseState).toBe('none')
    expect(pauseEvents.map((e) => (e.type === 'pause_changed' ? e.pauseState : null))).toEqual(['pending', 'none'])
  })

  it('requestResume moves paused→resuming, rejects from none and from resuming', async () => {
    expect(manager.requestResume(sessionId)).toBe(false)

    manager.requestPause(sessionId)
    const gate = manager.enterPauseGate(sessionId)
    expect(manager.getPauseState(sessionId)).toBe('paused')

    expect(manager.requestResume(sessionId)).toBe(true)
    expect(manager.getPauseState(sessionId)).toBe('resuming')
    expect(manager.requestResume(sessionId)).toBe(false)

    await expect(gate).resolves.toBe('released')
    expect(manager.getPauseState(sessionId)).toBe('none')
  })

  it('enterPauseGate passes through immediately when no pause is requested', async () => {
    await expect(manager.enterPauseGate(sessionId)).resolves.toBe('released')
    expect(manager.getPauseState(sessionId)).toBe('none')
  })

  it('enterPauseGate blocks a pending pause until resume, then clears to none', async () => {
    manager.requestPause(sessionId)
    const gate = manager.enterPauseGate(sessionId)
    // The gate itself transitioned pending→paused and broadcast it
    expect(manager.getPauseState(sessionId)).toBe('paused')
    expect(pauseEvents.map((e) => (e.type === 'pause_changed' ? e.pauseState : null))).toEqual(['pending', 'paused'])

    const race = await Promise.race([gate.then(() => 'settled'), sleep(50).then(() => 'timeout')])
    expect(race).toBe('timeout')

    manager.requestResume(sessionId)
    await expect(gate).resolves.toBe('released')
    expect(manager.getPauseState(sessionId)).toBe('none')
    expect(pauseEvents.map((e) => (e.type === 'pause_changed' ? e.pauseState : null))).toEqual([
      'pending',
      'paused',
      'resuming',
      'none',
    ])
  })

  it('a second concurrent gate also blocks while paused (parent + sub-agent loops)', async () => {
    manager.requestPause(sessionId)
    const gate1 = manager.enterPauseGate(sessionId)
    const gate2 = manager.enterPauseGate(sessionId)
    expect(manager.getPauseState(sessionId)).toBe('paused')

    const race = await Promise.race([
      Promise.all([gate1, gate2]).then(() => 'settled'),
      sleep(50).then(() => 'timeout'),
    ])
    expect(race).toBe('timeout')

    manager.requestResume(sessionId)
    await expect(gate1).resolves.toBe('released')
    await expect(gate2).resolves.toBe('released')
    expect(manager.getPauseState(sessionId)).toBe('none')
  })

  it('aborts resolve as "aborted" when the signal fires while paused', async () => {
    manager.requestPause(sessionId)
    const controller = new AbortController()
    const gate = manager.enterPauseGate(sessionId, controller.signal)
    expect(manager.getPauseState(sessionId)).toBe('paused')

    controller.abort()
    await expect(gate).resolves.toBe('aborted')
  })

  it('clearPauseState wakes a blocked gate with "aborted" and clears to none', async () => {
    manager.requestPause(sessionId)
    const gate = manager.enterPauseGate(sessionId)
    expect(manager.getPauseState(sessionId)).toBe('paused')

    manager.clearPauseState(sessionId)
    await expect(gate).resolves.toBe('aborted')
    expect(manager.getPauseState(sessionId)).toBe('none')
  })

  it('setRunning(false) clears a stale pending pause (turn ended before the gate was reached)', () => {
    manager.setRunning(sessionId, true)
    manager.requestPause(sessionId)
    expect(manager.getPauseState(sessionId)).toBe('pending')
    manager.setRunning(sessionId, false)
    expect(manager.getPauseState(sessionId)).toBe('none')
  })

  it('deleteSession clears the pause state', () => {
    manager.requestPause(sessionId)
    manager.deleteSession(sessionId)
    expect(manager.getPauseState(sessionId)).toBe('none')
    expect(manager.getSession(sessionId)).toBeNull()
  })
})
