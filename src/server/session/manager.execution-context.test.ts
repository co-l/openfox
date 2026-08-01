/**
 * Session Manager – Execution Context Integrity Tests (RED)
 *
 * Issue #190: Refresh agent context after workspace or branch mutation during a turn.
 *
 * These tests pin two related responsibilities of SessionManager.switchWorkspace:
 *   - It MUST invalidate the cached system prompt so the next LLM call (same-turn
 *     continuation AND next user turn) rebuilds against the new workdir/branch
 *     instead of serving a stale prompt that still embeds the previous workspace.
 *   - It MUST emit a fresh session.updated event so the frontend never displays
 *     a stale workspace/branch label after an authoritative mutation.
 *
 * The tests are RED until SessionManager.switchWorkspace (or its collaborators)
 * actually clears the cached prompt on success.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const { mockGetGitBranch, mockGetWorkspacesDir, mockRunGit, mockGetCommitsBehind } = vi.hoisted(() => {
  const mockGetGitBranch = vi.fn(async (_cwd: string) => 'feat-x' as string | null)
  const mockGetWorkspacesDir = vi.fn(
    async (_projectName: string, _projectDir: string) => '/tmp/openfox-workspaces',
  )
  const mockRunGit = vi.fn(async (_cwd: string, _args: string[]) => undefined as void)
  const mockGetCommitsBehind = vi.fn(async (_cwd: string, _branch: string) => 0 as number | null)
  return { mockGetGitBranch, mockGetWorkspacesDir, mockRunGit, mockGetCommitsBehind }
})

vi.mock('../lsp/index.js', () => ({
  getLspManager: vi.fn(() => ({ name: 'mock-lsp' })),
  shutdownLspManager: vi.fn(async () => {}),
}))

vi.mock('../git/workspace.js', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    getGitBranch: mockGetGitBranch as any,
    getWorkspacesDir: mockGetWorkspacesDir as any,
    runGit: mockRunGit as any,
    getCommitsBehind: mockGetCommitsBehind as any,
    ensureWorkspace: vi.fn(async () => undefined),
    workspaceExists: vi.fn(async () => true),
    validateRef: vi.fn(async () => undefined),
    resolveAndValidateSourceBranch: vi.fn(async () => 'origin/HEAD'),
  }
})

vi.mock('../dev-server/manager.js', () => ({
  devServerManager: { stop: vi.fn(async () => undefined) },
}))

const mockProviderManager = {
  getCurrentModelContext: vi.fn(() => 200000),
  getLLMClient: vi.fn(() => ({})),
  createClient: vi.fn(() => undefined),
  getActiveProviderId: vi.fn(() => 'test-provider'),
  getCurrentModel: vi.fn(() => 'global-model'),
}

import { loadConfig } from '../config.js'
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js'
import { createProject } from '../db/projects.js'
import { initEventStore } from '../events/index.js'
import { SessionManager } from './manager.js'

describe('SessionManager.switchWorkspace – execution context integrity (issue #190)', () => {
  let workdir: string
  let projectId: string
  let manager: SessionManager

  beforeEach(async () => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
    initEventStore(getDatabase())

    workdir = await mkdtemp(join(tmpdir(), 'openfox-manager-exec-ctx-'))
    projectId = createProject('OpenFox', workdir).id
    manager = new SessionManager(mockProviderManager as any)

    mockGetGitBranch.mockClear()
    mockGetGitBranch.mockResolvedValue('feat-x')
    mockGetWorkspacesDir.mockClear()
    mockGetWorkspacesDir.mockResolvedValue('/tmp/openfox-workspaces')
    mockRunGit.mockClear()
    mockRunGit.mockResolvedValue(undefined)
    mockGetCommitsBehind.mockClear()
    mockGetCommitsBehind.mockResolvedValue(0)
  })

  afterEach(async () => {
    closeDatabase()
    await rm(workdir, { recursive: true, force: true })
  })

  it('invalidates the cached prompt after a successful workspace switch (next-turn sees fresh context)', async () => {
    // Session starts on /tmp/project (original workdir) with no workspace
    const session = manager.createSession(projectId, 'Ctx-1')

    // Simulate that the previous turn warmed up the prompt with the OLD workdir.
    // The cached prompt embeds `Working directory: /tmp/project` — the
    // stale state. This is exactly what buildTopLevelSystemPrompt(workdir) does.
    manager.setCachedPrompt(session.id, 'System prompt with Working directory: /tmp/project', [], 'old-hash')
    expect(manager.getCachedPrompt(session.id)).toBeDefined()

    // Authoritative mutation: switch to workspace feat-x (it exists)
    await manager.switchWorkspace(session.id, 'feat-x')

    // Issue #190: the next turn MUST rebuild the prompt against the new workdir.
    // Therefore the cached prompt must be cleared (so assembleRequest rebuilds).
    const cachedAfter = manager.getCachedPrompt(session.id)
    expect(cachedAfter).toBeUndefined()
  })

  it('invalidates the cached prompt after a successful branch change on the current workspace (same-turn sees fresh context)', async () => {
    // Session currently on /ws/openfox/feat-x with branch=feat-x (default mock)
    const session = manager.createSession(projectId, 'Ctx-2', undefined, undefined, '/ws/openfox/feat-x')
    // Pre-seed a cached prompt referencing branch=feat-x workdir
    manager.setCachedPrompt(session.id, 'System prompt with Working directory: /ws/openfox/feat-x', [], 'feat-hash')
    expect(manager.getCachedPrompt(session.id)).toBeDefined()

    // Branch change: same workspace, different branch. The first getGitBranch
    // call (early-return check) sees the PRE-mutation branch 'feat-x', so the
    // switch is NOT a no-op. Subsequent getGitBranch calls return 'feat-y'
    // to simulate a successful applyBranchIfNeeded.
    mockGetGitBranch.mockResolvedValueOnce('feat-x')
    mockGetGitBranch.mockResolvedValue('feat-y')
    await manager.switchWorkspace(session.id, 'feat-x', 'feat-y')

    // The cached prompt must be cleared so the next LLM call rebuilds against the new branch
    const cachedAfter = manager.getCachedPrompt(session.id)
    expect(cachedAfter).toBeUndefined()
  })

  it('does not invalidate the cached prompt when switchWorkspace is a no-op (no real mutation)', async () => {
    // Session already on /ws/openfox/feat-x — switching to feat-x without branch change
    // is a no-op and must NOT manufacture a fake refreshed context.
    const session = manager.createSession(projectId, 'Ctx-3', undefined, undefined, '/ws/openfox/feat-x')
    manager.setCachedPrompt(session.id, 'Stable system prompt with Working directory: /ws/openfox/feat-x', [], 'stable-hash')

    await manager.switchWorkspace(session.id, 'feat-x')

    // Cache should be untouched on a no-op mutation
    const cached = manager.getCachedPrompt(session.id)
    expect(cached).toBeDefined()
    expect(cached?.hash).toBe('stable-hash')
  })
})