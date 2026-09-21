/**
 * Session Export / Import Tests (TDD)
 *
 * Covers:
 * - export payload shape (format marker, source env info, session metadata,
 *   cached layout, current-window messages, events in seq order)
 * - export is read-only
 * - import: new session in target project, events replayed verbatim
 * - cache restored verbatim and session marked warmed up
 * - provider/mode fallback when the target environment lacks them
 * - drift <system-reminder>s injected on import (system prompt + tools), exactly once
 * - import marker reminder appended last
 * - validation errors (bad format/version, missing project, no initialized event)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const mockGetGitBranch = vi.fn()

vi.mock('../git/workspace.js', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    getGitBranch: (...args: any[]) => mockGetGitBranch(...args),
  }
})

vi.mock('../agents/registry.js', () => ({
  loadAllAgentsDefault: vi.fn(async () => [{ metadata: { id: 'builder', name: 'Builder' } }]),
  findAgentById: vi.fn((id: string) => ({ metadata: { id, name: 'Builder' } })),
  resolveDefaultAgentId: vi.fn(() => 'builder'),
  getSubAgents: vi.fn(() => []),
}))

vi.mock('../context/instructions.js', () => ({
  getAllInstructions: vi.fn(async () => ({ content: 'target instructions', files: [] })),
}))

vi.mock('../skills/registry.js', () => ({
  getEnabledSkillMetadata: vi.fn(async () => []),
}))

vi.mock('../runtime-config.js', () => ({
  getRuntimeConfig: vi.fn(() => ({ mode: 'production', context: { maxTokens: 200000 } })),
}))

vi.mock('../../cli/paths.js', () => ({
  getGlobalConfigDir: vi.fn(() => '/tmp/config'),
}))

vi.mock('../tools/index.js', () => ({
  getToolRegistryForAgent: vi.fn(() => ({ definitions: [liveTool] })),
}))

vi.mock('../chat/prompts.js', () => ({
  buildTopLevelSystemPrompt: vi.fn(() => NEW_SYSTEM_PROMPT),
}))

import { loadConfig } from '../config.js'
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js'
import { createProject } from '../db/projects.js'
import { getSessionCachedPrompt } from '../db/sessions.js'
import {
  initEventStore,
  getEventStore,
  emitUserMessage,
  emitAssistantMessageStart,
  emitMessageDelta,
  emitMessageDone,
  emitToolCall,
  emitToolResult,
  emitTurnSnapshot,
  emitCriteriaSet,
  emitTodosUpdated,
  emitModeChanged,
  getSessionState,
  getCurrentWindowMessageOptions,
  buildSnapshotFromSessionState,
} from '../events/index.js'
import type { SnapshotMessage } from '../events/types.js'
import { SessionManager } from './manager.js'
import { buildSessionExport, SESSION_EXPORT_FORMAT, SESSION_EXPORT_VERSION } from './export-import.js'
import { injectContextDriftReminders } from '../chat/dynamic-context.js'
import type { LLMToolDefinition } from '../llm/types.js'

function tool(name: string, description = `desc ${name}`): LLMToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties: {} },
    },
  }
}

const CACHED_TOOL = tool('cached-tool')
const liveTool = tool('live-tool')
const OLD_SYSTEM_PROMPT = 'You are OpenFox in the source environment. Working directory: /src/original.'
const NEW_SYSTEM_PROMPT = 'You are OpenFox in the target environment. Working directory: /target/other.'

const mockProviderManager = {
  getCurrentModelContext: vi.fn(() => 200000),
  getLLMClient: vi.fn(),
  createClient: vi.fn(),
  getActiveProviderId: vi.fn(() => 'test-provider'),
  getCurrentModel: vi.fn(() => 'global-model'),
  getProviders: vi.fn(() => [
    { id: 'test-provider', name: 'Test', models: [{ id: 'test-model' }], backend: 'openai', url: 'http://test' },
  ]),
  getDefaultModelSelection: vi.fn(() => 'default-provider/default-model'),
  resolveModel: vi.fn(),
  resolveModelEffort: vi.fn(),
} as any

describe('Session export / import', () => {
  let workdir: string
  let targetWorkdir: string
  let projectId: string
  let targetProjectId: string
  let manager: SessionManager

  beforeEach(async () => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
    initEventStore(getDatabase())

    workdir = await mkdtemp(join(tmpdir(), 'openfox-export-src-'))
    targetWorkdir = await mkdtemp(join(tmpdir(), 'openfox-export-dst-'))
    projectId = createProject('Source project', workdir).id
    targetProjectId = createProject('Target project', targetWorkdir).id
    manager = new SessionManager(mockProviderManager)
    mockGetGitBranch.mockResolvedValue(null)
    mockProviderManager.getProviders.mockReturnValue([
      { id: 'test-provider', name: 'Test', models: [{ id: 'test-model' }], backend: 'openai', url: 'http://test' },
    ])
  })

  afterEach(async () => {
    closeDatabase()
    await rm(workdir, { recursive: true, force: true })
    await rm(targetWorkdir, { recursive: true, force: true })
  })

  function createSourceSession(): string {
    const session = manager.createSession(projectId, 'Source session', 'test-provider', 'test-model')
    const windowId = getCurrentWindowMessageOptions(session.id)?.contextWindowId
    emitUserMessage(session.id, 'Hello from source', windowId ? { contextWindowId: windowId } : undefined)
    const asstMsgId = emitAssistantMessageStart(session.id, windowId ? { contextWindowId: windowId } : undefined)
    emitMessageDelta(session.id, asstMsgId, 'I will read a file')
    emitMessageDone(session.id, asstMsgId)
    emitToolCall(session.id, asstMsgId, {
      id: 'call-1',
      name: 'read_file',
      arguments: { path: '/src/original/file.ts' },
    })
    emitToolResult(session.id, asstMsgId, 'call-1', {
      success: true,
      output: 'file content',
      durationMs: 5,
      truncated: false,
    })
    manager.setCachedPrompt(session.id, OLD_SYSTEM_PROMPT, [CACHED_TOOL], 'source-hash', 'source-prompt-hash')
    // Realistic snapshot at turn end
    const events = getEventStore().getEvents(session.id)
    const latestSeq = getEventStore().getLatestSeq(session.id) ?? events.length
    emitTurnSnapshot(
      session.id,
      buildSnapshotFromSessionState({
        session: manager.requireSession(session.id),
        events,
        latestSeq,
        cachedSystemPrompt: OLD_SYSTEM_PROMPT,
        dynamicContextHash: 'source-hash',
      }),
    )
    // State events land after the snapshot in production (next turn start)
    emitCriteriaSet(session.id, [{ id: 'c1', description: 'Export works', status: { type: 'pending' }, attempts: [] }])
    emitTodosUpdated(session.id, [{ content: 'Implement export', status: 'pending' }])
    return session.id
  }

  describe('buildSessionExport', () => {
    it('produces a versioned payload with cached layout and all events in seq order', () => {
      const sessionId = createSourceSession()
      const payload = buildSessionExport(manager, sessionId)

      expect(payload.format).toBe(SESSION_EXPORT_FORMAT)
      expect(payload.version).toBe(SESSION_EXPORT_VERSION)
      expect(payload.session.title).toBe('Source session')
      expect(payload.session.providerId).toBe('test-provider')
      expect(payload.session.providerModel).toBe('test-model')
      expect(payload.session.criteria).toHaveLength(1)
      expect(payload.session.todos).toHaveLength(1)
      expect(payload.session.metadataEntries).toBeDefined()
      expect(payload.session.createdAt).toBeDefined()
      expect(payload.session.updatedAt).toBeDefined()
      expect(payload.cachedLayout).toEqual({
        systemPrompt: OLD_SYSTEM_PROMPT,
        tools: [CACHED_TOOL],
        hash: 'source-hash',
        promptHash: 'source-prompt-hash',
      })
      expect(payload.messages.length).toBeGreaterThan(0)
      expect(payload.messages.map((m) => m.content)).toContain('Hello from source')
      expect(payload.events.length).toBeGreaterThan(0)
      const seqs = payload.events.map((e) => e.seq)
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
      expect(payload.events[0]).toMatchObject({ type: 'session.initialized', sessionId })
    })

    it('includes source environment info', () => {
      const sessionId = createSourceSession()
      const payload = buildSessionExport(manager, sessionId)

      expect(payload.source).toMatchObject({
        projectName: 'Source project',
        workdir,
        mode: 'builder',
        providerId: 'test-provider',
        providerModel: 'test-model',
      })
      expect(payload.source.openfoxVersion).toBeTruthy()
      expect(payload.source.effectiveModel).toBeTruthy()
    })

    it('throws for an unknown session', () => {
      expect(() => buildSessionExport(manager, 'missing-session')).toThrow()
    })

    it('is read-only: export does not mutate the cache or event store', () => {
      const sessionId = createSourceSession()
      const eventsBefore = getEventStore().getEvents(sessionId).length
      const cachedBefore = getSessionCachedPrompt(sessionId)

      buildSessionExport(manager, sessionId)

      expect(getEventStore().getEvents(sessionId)).toHaveLength(eventsBefore)
      expect(getSessionCachedPrompt(sessionId)).toEqual(cachedBefore)
      expect(manager.isWarmedUp(sessionId)).toBe(false)
    })
  })

  describe('importSession', () => {
    it('creates a session in the target project, replaying history verbatim', async () => {
      const sessionId = createSourceSession()
      const payload = buildSessionExport(manager, sessionId)

      const imported = await manager.importSession(targetProjectId, payload)

      expect(imported.id).not.toBe(sessionId)
      expect(imported.projectId).toBe(targetProjectId)
      expect(imported.metadata.title).toBe('Source session')
      expect(imported.isRunning).toBe(false)
      expect(imported.providerId).toBe('test-provider')
      expect(imported.providerModel).toBe('test-model')

      const sourceState = getSessionState(sessionId)
      const importedState = getSessionState(imported.id)
      expect(importedState).toBeDefined()
      // Import appends drift reminders + the import marker, so the source
      // history must be preserved verbatim as a prefix of the imported one.
      expect(importedState!.messages.length).toBeGreaterThanOrEqual(sourceState!.messages.length)
      const projectMessages = (messages: SnapshotMessage[]) =>
        messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          toolCalls: m.toolCalls?.map((tc) => ({ id: tc.id, name: tc.name })),
        }))
      expect(projectMessages(importedState!.messages.slice(0, sourceState!.messages.length))).toEqual(
        projectMessages(sourceState!.messages),
      )

      const importedEvents = getEventStore().getEvents(imported.id)
      // The replayed source events are a prefix of the imported session's
      // events (drift reminders + import marker are appended after).
      expect(importedEvents.slice(0, payload.events.length).map((e) => e.type)).toEqual(
        payload.events.map((e) => e.type),
      )
      expect(importedEvents[0]?.seq).toBe(1)
      expect(importedEvents[0]?.timestamp).toBe(payload.events[0]?.timestamp)

      // State (criteria, todos) is restored via the replayed events
      expect(importedState!.criteria).toHaveLength(1)
      expect(importedState!.todos).toHaveLength(1)
    })

    it('restores the cached layout verbatim and marks the session warmed up', async () => {
      const sessionId = createSourceSession()
      const payload = buildSessionExport(manager, sessionId)

      const imported = await manager.importSession(targetProjectId, payload)

      const cached = getSessionCachedPrompt(imported.id)
      expect(cached).toEqual({
        systemPrompt: OLD_SYSTEM_PROMPT,
        tools: [CACHED_TOOL],
        hash: 'source-hash',
        promptHash: 'source-prompt-hash',
      })
      expect(manager.isWarmedUp(imported.id)).toBe(true)
    })

    it('falls back to environment defaults when the provider does not exist', async () => {
      const sessionId = createSourceSession()
      const payload = buildSessionExport(manager, sessionId)

      mockProviderManager.getProviders.mockReturnValue([])
      const imported = await manager.importSession(targetProjectId, payload)

      expect(imported.providerId).toBeNull()
      expect(imported.providerModel).toBeNull()
    })

    it('matches the source provider by backend + url when the id differs (team scenario)', async () => {
      // Source env names the server "server"; the target env names it "merlin".
      mockProviderManager.getProviders.mockReturnValue([
        { id: 'server', name: 'Server', models: [{ id: 'test-model' }], backend: 'openai', url: 'http://server:8000' },
      ])
      const sourceId = manager.createSession(projectId, 'Team session', 'server', 'test-model').id
      emitUserMessage(sourceId, 'Hello from the team session')
      const payload = buildSessionExport(manager, sourceId)

      expect(payload.source.providerId).toBe('server')
      expect(payload.source.providerBackend).toBe('openai')
      expect(payload.source.providerUrl).toBe('http://server:8000')

      mockProviderManager.getProviders.mockReturnValue([
        { id: 'merlin', name: 'Merlin', models: [{ id: 'test-model' }], backend: 'openai', url: 'http://server:8000' },
      ])
      const imported = await manager.importSession(targetProjectId, payload)

      expect(imported.providerId).toBe('merlin')
      expect(imported.providerModel).toBe('test-model')
    })

    it('does not URL-match when the target server differs or lacks the model', async () => {
      mockProviderManager.getProviders.mockReturnValue([
        { id: 'server', name: 'Server', models: [{ id: 'test-model' }], backend: 'openai', url: 'http://server:8000' },
      ])
      const sourceId = manager.createSession(projectId, 'Team session', 'server', 'test-model').id
      emitUserMessage(sourceId, 'Hello')
      const payload = buildSessionExport(manager, sourceId)

      // Same label different URL + missing model on a different server
      mockProviderManager.getProviders.mockReturnValue([
        {
          id: 'other',
          name: 'Other',
          models: [{ id: 'unrelated-model' }],
          backend: 'openai',
          url: 'http://other:9999',
        },
      ])
      const imported = await manager.importSession(targetProjectId, payload)

      expect(imported.providerId).toBeNull()
      expect(imported.providerModel).toBeNull()
    })

    it('falls back to the default agent when the source mode does not exist', async () => {
      const sessionId = manager.createSession(projectId, 'Ghost mode session', 'test-provider', 'test-model').id
      emitModeChanged(sessionId, 'ghost-agent', false)
      const events = getEventStore().getEvents(sessionId)
      emitTurnSnapshot(
        sessionId,
        buildSnapshotFromSessionState({
          session: manager.requireSession(sessionId),
          events,
          latestSeq: getEventStore().getLatestSeq(sessionId) ?? events.length,
        }),
      )
      const payload = buildSessionExport(manager, sessionId)
      expect(payload.session.mode).toBe('ghost-agent')

      const imported = await manager.importSession(targetProjectId, payload)

      // 'ghost-agent' is not in the target environment -> default agent
      expect(imported.mode).toBe('builder')
    })

    it('injects system-reminders for system prompt and tool drift, exactly once', async () => {
      const sessionId = createSourceSession()
      const payload = buildSessionExport(manager, sessionId)

      const imported = await manager.importSession(targetProjectId, payload)

      const reminders = getEventStore()
        .getEvents(imported.id)
        .filter(
          (e) =>
            e.type === 'message.start' &&
            (e.data as { role?: string; isSystemGenerated?: boolean }).role === 'user' &&
            (e.data as { isSystemGenerated?: boolean }).isSystemGenerated,
        )

      const reminderContents = reminders.map((r) => (r.data as { content: string }).content)
      const promptDiff = reminderContents.find((c) => c.includes('Your system prompt has changed'))
      expect(promptDiff).toBeDefined()
      const toolDiff = reminderContents.find((c) => c.includes('You now have access to new tools'))
      expect(toolDiff).toBeDefined()
      expect(toolDiff).toContain('live-tool')

      // Exactly once: a later drift check must not re-inject
      const before = getEventStore().getEvents(imported.id).length
      await injectContextDriftReminders(manager, imported.id)
      expect(getEventStore().getEvents(imported.id).length).toBe(before)
    })

    it('appends the import marker reminder last', async () => {
      const sessionId = createSourceSession()
      const payload = buildSessionExport(manager, sessionId)

      const imported = await manager.importSession(targetProjectId, payload)

      const marker = getEventStore()
        .getEvents(imported.id)
        .filter((e) => e.type === 'message.start')
        .at(-1)!
      const markerData = marker.data as {
        role: string
        content: string
        isSystemGenerated?: boolean
        messageKind?: string
        metadata?: { kind?: string }
      }
      expect(markerData).toMatchObject({
        role: 'user',
        isSystemGenerated: true,
        messageKind: 'auto-prompt',
        metadata: { kind: 'reminder' },
      })
      expect(markerData.content).toBe(
        'This session was imported from another environment. The latest system reminders are authoritative.',
      )
    })

    it('rejects invalid payloads', async () => {
      await expect(manager.importSession(targetProjectId, { format: 'nope' })).rejects.toThrow()
      const payload = buildSessionExport(manager, createSourceSession())
      await expect(manager.importSession('missing-project', payload)).rejects.toThrow('Project not found')
    })
  })
})
