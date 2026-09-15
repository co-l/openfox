/**
 * End-of-session command tests
 *
 * "Delete session" is two-phase: POST /api/sessions/:id/end-session runs the
 * configured end-of-session command inside the session and marks it closing;
 * the client then offers an explicit final delete. An empty setting means the
 * routine is off and the delete is immediate; a command that is configured but
 * cannot run answers 409 and leaves the session alone.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js'
import { loadConfig } from '../config.js'
import { createProject } from '../db/projects.js'
import { initEventStore } from '../events/index.js'
import { SessionManager } from '../session/manager.js'
import { setSetting, SETTINGS_KEYS } from '../db/settings.js'
import { getSession, listSessionsByProject } from '../db/sessions.js'
import { registerSessionEndRoutes, resolveEndOfSessionCommand } from './session-end.js'

const mockProviderManager = {
  getCurrentModelContext: () => 200000,
  getLLMClient: () => ({
    getModel: () => 'global-model',
    setModel: () => {},
    getProfile: () => {},
    getBackend: () => 'unknown',
    setBackend: () => {},
    complete: async () => {},
    stream: async function* () {},
  }),
  getActiveProviderId: () => 'test-provider',
  getCurrentModel: () => 'global-model',
  createClient: () => undefined,
  getProviders: () => [],
  getModelSettings: () => undefined,
  getDefaultModelSelection: () => 'test-provider/global-model',
}

async function writeCommand(configDir: string, id: string, body: string): Promise<void> {
  const dir = join(configDir, 'commands')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${id}.command.md`), body, 'utf-8')
}

describe('POST /api/sessions/:id/end-session', () => {
  let server: Server
  let baseUrl: string
  let sessionManager: SessionManager
  let sessionId: string
  let configDir: string
  let workdir: string
  let hardDeleted: string[]

  beforeEach(async () => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
    initEventStore(getDatabase())

    configDir = await mkdtemp(join(tmpdir(), 'openfox-eos-config-'))
    workdir = await mkdtemp(join(tmpdir(), 'openfox-eos-work-'))
    const projectId = createProject('Test', workdir).id

    sessionManager = new SessionManager(mockProviderManager as never)
    sessionId = sessionManager.createSession(projectId).id
    hardDeleted = []

    const app = express()
    app.use(express.json())
    const router = express.Router()
    const hardDeleteSession = async (id: string): Promise<void> => {
      hardDeleted.push(id)
      sessionManager.deleteSession(id)
    }
    registerSessionEndRoutes(router, {
      sessionManager,
      configDir,
      hardDelete: hardDeleteSession,
      broadcast: () => {},
    })
    // The untouched final-delete path, for the "Skip & close" case
    router.delete('/sessions/:id', async (req, res) => {
      const id = req.params['id'] as string
      if (!sessionManager.getSession(id)) return res.status(404).json({ error: 'Session not found' })
      await hardDeleteSession(id)
      res.json({ success: true })
    })
    app.use('/api', router)

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${(server.address() as { port: number }).port}`
        resolve()
      })
    })
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    closeDatabase()
    // Windows keeps the directory in "pending delete" after the files are
    // unlinked, so rmdir returns EBUSY; fs.rm does not retry unless asked.
    await rm(configDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    await rm(workdir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  it('queues the resolved command and marks the session closing', async () => {
    await writeCommand(
      configDir,
      'end-of-session',
      '---\nid: end-of-session\nname: End of session\n---\nSummarize this session and report findings.',
    )
    setSetting(SETTINGS_KEYS.END_OF_SESSION_COMMAND, 'end-of-session')
    const queueSpy = vi.spyOn(sessionManager, 'queueMessage')

    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/end-session`, { method: 'POST' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { closing?: boolean; command?: string; deleted?: boolean }
    expect(body).toEqual({ closing: true, command: 'end-of-session' })

    expect(queueSpy).toHaveBeenCalledTimes(1)
    expect(queueSpy.mock.calls[0]?.[0]).toBe(sessionId)
    expect(queueSpy.mock.calls[0]?.[1]).toBe('asap')
    expect(queueSpy.mock.calls[0]?.[2]).toContain('Summarize this session')
    expect(queueSpy.mock.calls[0]?.[4]).toBe('command')
    expect(hardDeleted).toEqual([])

    expect(getSession(sessionId)?.closingAt).toBeTruthy()
  })

  it('applies the command agentMode when it declares one', async () => {
    await writeCommand(configDir, 'wrap', '---\nid: wrap\nname: Wrap\nagentMode: builder\n---\nWrap it up.')
    setSetting(SETTINGS_KEYS.END_OF_SESSION_COMMAND, 'wrap')
    const modeSpy = vi.spyOn(sessionManager, 'setMode')

    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/end-session`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(modeSpy).toHaveBeenCalledWith(sessionId, 'builder')
  })

  it('deletes right away when the setting is empty', async () => {
    setSetting(SETTINGS_KEYS.END_OF_SESSION_COMMAND, '')
    const queueSpy = vi.spyOn(sessionManager, 'queueMessage')

    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/end-session`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: true })
    expect(queueSpy).not.toHaveBeenCalled()
    expect(hardDeleted).toEqual([sessionId])
  })

  it('refuses to delete when the configured command cannot run', async () => {
    setSetting(SETTINGS_KEYS.END_OF_SESSION_COMMAND, 'no-such-command')
    const queueSpy = vi.spyOn(sessionManager, 'queueMessage')

    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/end-session`, { method: 'POST' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ reason: 'not_found', command: 'no-such-command' })
    expect(queueSpy).not.toHaveBeenCalled()
    expect(hardDeleted).toEqual([])
    expect(sessionManager.getSession(sessionId)?.closingAt).toBeUndefined()
  })

  it('refuses to delete a command that needs parameters', async () => {
    await writeCommand(configDir, 'needs', '---\nid: needs\nname: Needs\n---\nDo {{thing}} now.')
    setSetting(SETTINGS_KEYS.END_OF_SESSION_COMMAND, 'needs')

    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/end-session`, { method: 'POST' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ reason: 'needs_params', command: 'needs' })
    expect(hardDeleted).toEqual([])
  })

  it('404s for an unknown session', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/does-not-exist/end-session`, { method: 'POST' })
    expect(res.status).toBe(404)
  })

  it('falls back to the bundled end-of-session command when nothing is configured', async () => {
    const queueSpy = vi.spyOn(sessionManager, 'queueMessage')

    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/end-session`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { command?: string }).command).toBe('end-of-session')

    const prompt = queueSpy.mock.calls[0]?.[2] ?? ''
    expect(prompt).toContain('End-of-session routine')
    expect(prompt).toContain('Summarize')
    expect(hardDeleted).toEqual([])
    expect(getSession(sessionId)?.closingAt).toBeTruthy()
  })

  it('runs no command on the plain delete path (the "Skip & close" escape hatch)', async () => {
    await writeCommand(
      configDir,
      'end-of-session',
      '---\nid: end-of-session\nname: End of session\n---\nSummarize this session.',
    )
    setSetting(SETTINGS_KEYS.END_OF_SESSION_COMMAND, 'end-of-session')
    const queueSpy = vi.spyOn(sessionManager, 'queueMessage')

    // The final delete is the untouched DELETE /api/sessions/:id path
    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(queueSpy).not.toHaveBeenCalled()
    expect(getSession(sessionId)).toBeNull()
  })
})

describe('DELETE /api/sessions/:id/end-session (cancel closing)', () => {
  let server: Server
  let baseUrl: string
  let sessionManager: SessionManager
  let sessionId: string
  let projectId: string
  let configDir: string
  let workdir: string

  beforeEach(async () => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
    initEventStore(getDatabase())

    configDir = await mkdtemp(join(tmpdir(), 'openfox-eos2-config-'))
    workdir = await mkdtemp(join(tmpdir(), 'openfox-eos2-work-'))
    projectId = createProject('Test', workdir).id
    sessionManager = new SessionManager(mockProviderManager as never)
    sessionId = sessionManager.createSession(projectId).id

    const app = express()
    app.use(express.json())
    const router = express.Router()
    registerSessionEndRoutes(router, {
      sessionManager,
      configDir,
      hardDelete: async (id: string) => sessionManager.deleteSession(id),
      broadcast: () => {},
    })
    app.use('/api', router)

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${(server.address() as { port: number }).port}`
        resolve()
      })
    })
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    closeDatabase()
    // Windows keeps the directory in "pending delete" after the files are
    // unlinked, so rmdir returns EBUSY; fs.rm does not retry unless asked.
    await rm(configDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    await rm(workdir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  it('clears closingAt so the session keeps living', async () => {
    await writeCommand(configDir, 'end-of-session', '---\nid: end-of-session\nname: End of session\n---\nWrap up.')
    setSetting(SETTINGS_KEYS.END_OF_SESSION_COMMAND, 'end-of-session')

    await fetch(`${baseUrl}/api/sessions/${sessionId}/end-session`, { method: 'POST' })
    expect(getSession(sessionId)?.closingAt).toBeTruthy()
    expect(sessionManager.getSession(sessionId)?.closingAt).toBeTruthy()
    expect(listSessionsByProject(projectId).sessions[0]?.closingAt).toBeTruthy()

    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/end-session`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(getSession(sessionId)?.closingAt).toBeUndefined()
    expect(sessionManager.getSession(sessionId)?.closingAt).toBeUndefined()
    expect(listSessionsByProject(projectId).sessions[0]?.closingAt).toBeUndefined()
  })

  it('withdraws the queued closing prompt so it cannot run later', async () => {
    await writeCommand(configDir, 'end-of-session', '---\nid: end-of-session\nname: End of session\n---\nWrap up.')
    setSetting(SETTINGS_KEYS.END_OF_SESSION_COMMAND, 'end-of-session')

    await fetch(`${baseUrl}/api/sessions/${sessionId}/end-session`, { method: 'POST' })
    expect(sessionManager.getQueueState(sessionId).map((m) => m.content)).toEqual(['Wrap up.'])

    await fetch(`${baseUrl}/api/sessions/${sessionId}/end-session`, { method: 'DELETE' })

    expect(sessionManager.getQueueState(sessionId)).toEqual([])
  })
})

describe('resolveEndOfSessionCommand', () => {
  let configDir: string

  beforeEach(async () => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
    initEventStore(getDatabase())
    configDir = await mkdtemp(join(tmpdir(), 'openfox-eos-resolve-'))
  })

  afterEach(async () => {
    closeDatabase()
    // Windows keeps the directory in "pending delete" after the files are
    // unlinked, so rmdir returns EBUSY; fs.rm does not retry unless asked.
    await rm(configDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  it('reports the routine as disabled when the setting is empty', async () => {
    setSetting(SETTINGS_KEYS.END_OF_SESSION_COMMAND, '')
    expect(await resolveEndOfSessionCommand(configDir)).toEqual({ available: false, reason: 'disabled' })
  })

  it('reports not_found for a command that does not exist', async () => {
    setSetting(SETTINGS_KEYS.END_OF_SESSION_COMMAND, 'ghost')
    expect(await resolveEndOfSessionCommand(configDir)).toEqual({
      available: false,
      reason: 'not_found',
      commandId: 'ghost',
    })
  })

  it('reports needs_params for a command that demands arguments', async () => {
    await writeCommand(configDir, 'params', '---\nid: params\nname: Params\n---\nRun {{thing}}.')
    setSetting(SETTINGS_KEYS.END_OF_SESSION_COMMAND, 'params')
    expect(await resolveEndOfSessionCommand(configDir)).toEqual({
      available: false,
      reason: 'needs_params',
      commandId: 'params',
    })
  })

  it('resolves the bundled default with its prompt and agent mode', async () => {
    const resolved = await resolveEndOfSessionCommand(configDir)
    expect(resolved.available).toBe(true)
    if (resolved.available) {
      expect(resolved.commandId).toBe('end-of-session')
      expect(resolved.prompt).toContain('End-of-session routine')
      expect(resolved.agentMode).toBe('builder')
    }
  })
})
