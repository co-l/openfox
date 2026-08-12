/**
 * Session Manager – Workspace Switch & Execution Context Integrity Tests
 *
 * Cache discipline: the cached system prompt is SACRED for local LLMs — OpenFox
 * never invalidates it on workspace or branch mutation. Those tests pin that
 * switchWorkspace:
 *   - MUST preserve the cached prompt untouched after a workspace/branch switch,
 *     so the next LLM call reuses it instead of paying a full rebuild.
 *   - MUST inject a workspace system reminder (<system-reminder> auto-prompt)
 *     carrying the new workspace/branch, which the model is instructed to trust
 *     over the static "Working directory" line in the cached prompt.
 *   - MUST emit a fresh session.updated event so the frontend never displays
 *     a stale workspace/branch label after an authoritative mutation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const {
  mockGetGitBranch,
  mockGetWorkspacesDir,
  mockRunGit,
  mockGetCommitsBehind,
  mockEnsureWorkspace,
  mockWorkspaceExists,
} = vi.hoisted(() => {
  const mockGetGitBranch = vi.fn(async (_cwd: string) => 'feat-x' as string | null)
  const mockGetWorkspacesDir = vi.fn(async (_projectName: string, _projectDir: string) => '/tmp/openfox-workspaces')
  const mockRunGit = vi.fn(async (_cwd: string, _args: string[]) => undefined as void)
  const mockGetCommitsBehind = vi.fn(async (_cwd: string, _branch: string) => 0 as number | null)
  const mockEnsureWorkspace = vi.fn(async () => undefined)
  const mockWorkspaceExists = vi.fn(async () => true)
  return {
    mockGetGitBranch,
    mockGetWorkspacesDir,
    mockRunGit,
    mockGetCommitsBehind,
    mockEnsureWorkspace,
    mockWorkspaceExists,
  }
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
    ensureWorkspace: mockEnsureWorkspace as any,
    workspaceExists: mockWorkspaceExists as any,
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
  getModelSettings: vi.fn(() => undefined),
  getProviders: vi.fn(() => []),
  createClientForAgent: vi.fn(() => ({
    getModel: () => 'mock-test-model',
    setModel: vi.fn(),
    getProfile: vi.fn(() => ({})),
    getBackend: () => 'ollama',
    setBackend: vi.fn(),
    complete: vi.fn(),
    stream: vi.fn(),
  })),
}

import { loadConfig } from '../config.js'
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js'
import { createProject } from '../db/projects.js'
import { updateSessionBranch } from '../db/sessions.js'
import { initEventStore } from '../events/index.js'
import { SessionManager } from './manager.js'
import type { ToolCall, ToolResult } from '../../shared/types.js'
import type { TurnEvent } from '../events/types.js'

// ============================================================================
// Orchestrator/agent-loop mocks — used only by the runAgentTurn integration
// describe at the bottom. Kept here so the test file is self-contained.
// ============================================================================

const { orchestratorCapturedStreamCalls, orchestratorStreamResults, orchestratorStreamCallIndex } = vi.hoisted(() => {
  const captured: Array<{ systemPrompt: string; messages: unknown[]; tools: unknown[] }> = []
  const results: Array<{
    content: string
    toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
    segments: Array<{ type: string; content: string }>
    usage: { promptTokens: number; completionTokens: number }
    timing: { ttft: number; completionTime: number; tps: number; prefillTps: number }
    aborted: boolean
    finishReason: 'stop' | 'tool_calls' | 'length'
    modelParams: Record<string, unknown>
  }> = []
  return {
    orchestratorCapturedStreamCalls: captured,
    orchestratorStreamResults: results,
    orchestratorStreamCallIndex: { value: 0 },
  }
})

vi.mock('../skills/registry.js', () => ({
  getEnabledSkillMetadata: vi.fn(async () => []),
}))

vi.mock('../context/instructions.js', () => ({
  getAllInstructions: vi.fn(async () => ({ content: '', files: [] })),
}))

vi.mock('../runtime-config.js', () => ({
  getRuntimeConfig: vi.fn(() => ({
    mode: 'test',
    workdir: '/tmp/project',
    agent: { toolTimeout: 30000, maxIterations: 25, maxConsecutiveFailures: 3 },
    context: { maxTokens: 200000, compactionThreshold: 0.8, compactionTarget: 0.5 },
    llm: {
      baseUrl: 'http://localhost:11434',
      model: 'mock-test-model',
      timeout: 30000,
      idleTimeout: 30000,
      backend: 'ollama',
    },
    database: { path: ':memory:' },
    server: { port: 0, host: '127.0.0.1' },
  })),
}))

vi.mock('../../cli/paths.js', () => ({
  getGlobalConfigDir: vi.fn(() => '/tmp/openfox-test-config'),
}))

vi.mock('../db/settings.js', () => ({
  getSetting: vi.fn(() => null),
  SETTINGS_KEYS: {
    RETRY_PATTERNS: 'agent.retryPatterns',
    CONFIRM_ON_WORKSPACE_ACTIONS: 'tools.confirmOnWorkspaceActions',
  },
}))

vi.mock('../agents/registry.js', () => ({
  loadAllAgentsDefault: vi.fn(async () => [
    {
      metadata: {
        id: 'planner',
        name: 'Planner',
        description: 'Plans work',
        subagent: false,
        allowedTools: ['read_file', 'workspace'],
        color: '#a855f7',
      },
      prompt: '# Plan Mode\nCRITICAL: Plan mode ACTIVE.',
    },
  ]),
  findAgentById: vi.fn((id: string, list: Array<{ metadata: { id: string } }>) =>
    list.find((a) => a.metadata.id === id),
  ),
  resolveDefaultAgentId: vi.fn(() => 'planner'),
  getSubAgents: vi.fn(() => []),
  getTopLevelAgents: vi.fn(() => []),
}))

vi.mock('../chat/stream-pure.js', () => ({
  streamLLMPure: vi.fn((opts: { systemPrompt: string; messages: unknown[]; tools: unknown[] }) => {
    orchestratorCapturedStreamCalls.push({
      systemPrompt: opts.systemPrompt,
      messages: opts.messages,
      tools: opts.tools,
    })
    const idx = (orchestratorStreamCallIndex as unknown as { value: number }).value++
    const result = orchestratorStreamResults[idx]
    if (!result) {
      throw new Error(
        `streamLLMPure called ${idx + 1} times, only ${orchestratorStreamResults.length} results prepared`,
      )
    }
    return result
  }),
  consumeStreamGenerator: vi.fn(async <T>(gen: T | Promise<T>) => gen),
  TurnMetrics: class {
    addToolTime = vi.fn()
    addLLMCall = vi.fn()
    buildStats = vi.fn(() => ({}))
  },
  createMessageStartEvent: vi.fn((messageId: string, role: string, content?: string, options?: unknown) => ({
    type: 'message.start',
    data: { messageId, role, content, ...(options as object) },
  })),
  createMessageDoneEvent: vi.fn((messageId: string, options?: unknown) => ({
    type: 'message.done',
    data: { messageId, ...(options as object) },
  })),
  createChatDoneEvent: vi.fn((messageId: string, reason: string, _stats?: unknown, agentType?: string) => ({
    type: 'chat.done',
    data: { messageId, reason, ...(agentType ? { agentType } : {}) },
  })),
  createToolCallEvent: vi.fn((messageId: string, toolCall: unknown) => ({
    type: 'tool.call',
    data: { messageId, toolCall },
  })),
  createToolResultEvent: vi.fn((messageId: string, toolCallId: string, result: unknown) => ({
    type: 'tool.result',
    data: { messageId, toolCallId, result },
  })),
  evaluateLLMRetry: vi.fn(() => ({ retry: true, delayMs: 0, attempt: 2 })),
  sleepThroughRetryBackoff: vi.fn(async () => 'waited' as const),
  recordLLMFailure: vi.fn(),
  clearLLMFailure: vi.fn(),
}))

async function setSessionBranch(manager: SessionManager, sessionId: string, branch: string) {
  updateSessionBranch(sessionId, branch)
  // Force the manager to reload from DB so session.branch reflects the write
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(manager.getSession(sessionId)?.branch).toBe(branch)
}

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
    mockEnsureWorkspace.mockReset()
    mockEnsureWorkspace.mockResolvedValue(undefined)
    mockWorkspaceExists.mockReset()
    mockWorkspaceExists.mockResolvedValue(true)
  })

  afterEach(async () => {
    closeDatabase()
    await rm(workdir, { recursive: true, force: true })
  })

  it('preserves the cached prompt after a successful workspace switch (system reminder carries the new context)', async () => {
    // Session starts on /tmp/project (original workdir) with no workspace
    const session = manager.createSession(projectId, 'Ctx-1')

    // Simulate that the previous turn warmed up the prompt with the OLD workdir.
    // The cached prompt embeds `Working directory: /tmp/project` — the stale
    // state. This is exactly what buildTopLevelSystemPrompt(workdir) does.
    manager.setCachedPrompt(session.id, 'System prompt with Working directory: /tmp/project', [], 'old-hash')
    expect(manager.getCachedPrompt(session.id)).toBeDefined()

    // Authoritative mutation: switch to workspace feat-x (it exists)
    await manager.switchWorkspace(session.id, 'feat-x')

    // The cache is sacred — it must survive the switch untouched so the next LLM
    // call reuses it instead of paying a full rebuild.
    const cachedAfter = manager.getCachedPrompt(session.id)
    expect(cachedAfter).toBeDefined()
    expect(cachedAfter?.hash).toBe('old-hash')
    expect(cachedAfter?.systemPrompt).toBe('System prompt with Working directory: /tmp/project')

    // The new workspace/branch reaches the model via an injected system reminder.
    const messages = manager.getSession(session.id)!.messages
    const reminders = messages.filter((m) => m.messageKind === 'auto-prompt')
    expect(reminders.length).toBeGreaterThan(0)
    expect(reminders[reminders.length - 1]!.content).toContain('feat-x')
  })

  it('preserves the cached prompt after a successful branch change on the current workspace (same-turn sees fresh context)', async () => {
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

    // The cached prompt must survive so the next LLM call reuses it — the new
    // branch travels via the injected system reminder instead.
    const cachedAfter = manager.getCachedPrompt(session.id)
    expect(cachedAfter).toBeDefined()
    expect(cachedAfter?.hash).toBe('feat-hash')

    const messages = manager.getSession(session.id)!.messages
    const reminders = messages.filter((m) => m.messageKind === 'auto-prompt')
    expect(reminders.length).toBeGreaterThan(0)
    expect(reminders[reminders.length - 1]!.content).toContain('feat-y')
  })

  it('does not invalidate the cached prompt when switchWorkspace is a no-op (no real mutation)', async () => {
    // Session already on /ws/openfox/feat-x — switching to feat-x without branch change
    // is a no-op and must NOT manufacture a fake refreshed context.
    const session = manager.createSession(projectId, 'Ctx-3', undefined, undefined, '/ws/openfox/feat-x')
    manager.setCachedPrompt(
      session.id,
      'Stable system prompt with Working directory: /ws/openfox/feat-x',
      [],
      'stable-hash',
    )

    await manager.switchWorkspace(session.id, 'feat-x')

    // Cache should be untouched on a no-op mutation
    const cached = manager.getCachedPrompt(session.id)
    expect(cached).toBeDefined()
    expect(cached?.hash).toBe('stable-hash')
  })

  // ==========================================================================
  // Workspace branch inheritance — a fresh workspace must not silently drop
  // the session's current branch onto the clone's default (main/develop).
  // ==========================================================================

  describe('workspace branch inheritance', () => {
    it('carries the session branch into a newly created workspace when no branch is given', async () => {
      const session = manager.createSession(projectId, 'Ctx-inherit-1')
      await setSessionBranch(manager, session.id, 'feat-x')
      mockWorkspaceExists.mockResolvedValue(false)
      mockEnsureWorkspace.mockClear()

      await manager.switchWorkspace(session.id, 'brand-new-ws')

      expect(mockEnsureWorkspace).toHaveBeenCalledWith(workdir, 'brand-new-ws', 'OpenFox', 'feat-x', undefined)
    })

    it('does not force a branch checkout into an existing workspace when no branch is given', async () => {
      const session = manager.createSession(projectId, 'Ctx-inherit-2', undefined, undefined, '/ws/openfox/feat-x')
      mockEnsureWorkspace.mockClear()

      await manager.switchWorkspace(session.id, 'feat-x')

      expect(mockEnsureWorkspace).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // A failed workspace creation must NOT manufacture a fake refreshed context:
  // cache stays intact, no workspace reminder, no session_updated emitted.
  // ==========================================================================

  describe('mutation failure does not leak a fake refreshed context', () => {
    it('keeps cache untouched and emits no workspace reminder when ensureWorkspace rejects', async () => {
      // Prevent createSession's async getGitBranch() from racing our branch write
      mockGetGitBranch.mockResolvedValue(null)

      const session = manager.createSession(projectId, 'Fail-1')

      await setSessionBranch(manager, session.id, 'initial-branch')

      // Stabilize any pending async writes from createSession before capturing state
      await new Promise<void>((resolve) => setImmediate(resolve))

      const before = manager.requireSession(session.id)
      const beforeWorkspace = before.workspace
      const beforeWorkdir = before.workdir
      const beforeBranch = before.branch

      manager.setCachedPrompt(session.id, 'System prompt with Working directory: /tmp/project', [], 'old-hash')

      // Install spies AFTER stabilization so creation-time side effects are not counted
      const setCachedSpy = vi.spyOn(manager, 'setCachedPrompt')
      const resetWarmupSpy = vi.spyOn(manager, 'resetWarmup')
      const addMessageSpy = vi.spyOn(manager, 'addMessage')
      setCachedSpy.mockClear()
      resetWarmupSpy.mockClear()
      addMessageSpy.mockClear()

      const sessionUpdatedEvents: unknown[] = []
      const unsubscribe = manager.subscribe((event) => {
        if (event.type === 'session_updated') sessionUpdatedEvents.push(event)
      })

      try {
        // Force the failure: workspace does not exist AND ensureWorkspace throws
        mockWorkspaceExists.mockResolvedValue(false)
        mockEnsureWorkspace.mockRejectedValueOnce(new Error('checkout failed: branch not found'))

        // Capture the rejection explicitly to prevent an unhandled-rejection warning
        // triggered by the .finally() chain on the internal lock promise.
        const rejection = await manager.switchWorkspace(session.id, 'bad-ws', 'bad-branch').then(
          () => null,
          (err: Error) => err,
        )
        expect(rejection).not.toBeNull()
        expect(rejection?.message ?? '').toMatch(/checkout|branch/i)

        // Let any in-flight .finally() settle so unhandled-rejection tracking is clean
        await new Promise<void>((resolve) => setImmediate(resolve))

        const after = manager.requireSession(session.id)
        expect(after.workspace).toBe(beforeWorkspace)
        expect(after.workdir).toBe(beforeWorkdir)
        expect(after.branch).toBe(beforeBranch)

        const cachedAfter = manager.getCachedPrompt(session.id)
        expect(cachedAfter).toBeDefined()
        expect(cachedAfter?.hash).toBe('old-hash')
        expect(cachedAfter?.systemPrompt).toBe('System prompt with Working directory: /tmp/project')

        expect(setCachedSpy).not.toHaveBeenCalled()
        expect(resetWarmupSpy).not.toHaveBeenCalled()
        expect(addMessageSpy.mock.calls.filter(([, msg]) => msg?.messageKind === 'auto-prompt')).toHaveLength(0)

        // No session_updated events were emitted post-failure (the listener was installed
        // AFTER createSession stabilization, so any later session_updated reflects only
        // post-stabilization activity — and there should be none from the failed switch).
        expect(sessionUpdatedEvents).toHaveLength(0)
      } finally {
        unsubscribe()
      }
    })
  })

  // ==========================================================================
  // Switching to the current workspace+branch is a no-op and must not consume
  // cache, reset warmup, or emit any workspace reminder / session_updated event.
  // ==========================================================================

  describe('no-op switchWorkspace leaves cache, warmup, and event log untouched', () => {
    it('does not invalidate cache, does not reset warmup, and does not emit any message or session_updated', async () => {
      // Prevent createSession's async getGitBranch() from racing our branch write
      mockGetGitBranch.mockResolvedValue('feat-x')

      const session = manager.createSession(projectId, 'Noop-1', undefined, undefined, '/ws/openfox/feat-x')

      await setSessionBranch(manager, session.id, 'feat-x')

      await new Promise<void>((resolve) => setImmediate(resolve))

      manager.setCachedPrompt(
        session.id,
        'Stable system prompt with Working directory: /ws/openfox/feat-x',
        [],
        'stable-hash',
      )

      const cachedBefore = manager.getCachedPrompt(session.id)
      expect(cachedBefore).toBeDefined()
      expect(cachedBefore?.hash).toBe('stable-hash')

      const resetWarmupSpy = vi.spyOn(manager, 'resetWarmup')
      const addMessageSpy = vi.spyOn(manager, 'addMessage')
      const setCachedSpy = vi.spyOn(manager, 'setCachedPrompt')
      resetWarmupSpy.mockClear()
      addMessageSpy.mockClear()
      setCachedSpy.mockClear()

      const messagesBefore = manager.getSession(session.id)!.messages.slice()

      const sessionUpdatedEvents: unknown[] = []
      const unsubscribe = manager.subscribe((event) => {
        if (event.type === 'session_updated') sessionUpdatedEvents.push(event)
      })

      try {
        await manager.switchWorkspace(session.id, 'feat-x')

        const cachedAfter = manager.getCachedPrompt(session.id)
        expect(cachedAfter).toBeDefined()
        expect(cachedAfter?.hash).toBe('stable-hash')
        expect(cachedAfter?.systemPrompt).toBe('Stable system prompt with Working directory: /ws/openfox/feat-x')

        expect(setCachedSpy).not.toHaveBeenCalled()
        expect(resetWarmupSpy).not.toHaveBeenCalled()

        expect(addMessageSpy.mock.calls.filter(([, msg]) => msg?.messageKind === 'auto-prompt')).toHaveLength(0)

        const messagesAfter = manager.getSession(session.id)!.messages
        expect(messagesAfter.length).toBe(messagesBefore.length)

        expect(sessionUpdatedEvents).toHaveLength(0)
      } finally {
        unsubscribe()
      }
    })
  })

  // ==========================================================================
  // End-to-end runAgentTurn integration: prove that the cached system prompt is
  // strictly identical across the two LLM calls of the same turn when a workspace
  // switch happens between them, while the new workspace/branch/path reaches the
  // second LLM call via a dynamic <system-reminder> auto-prompt.
  // ==========================================================================

  describe('runAgentTurn: cached system prompt preserved across same-turn workspace switch', () => {
    it('keeps the cached system prompt strictly identical and surfaces the new context via a workspace <system-reminder>', async () => {
      const session = manager.createSession(projectId, 'CacheSacred-SameTurn')

      const oldSystemPrompt =
        'System prompt with Working directory: /tmp/project\nThis prompt was warmed up with the old workdir.'
      const cachedTools = [
        {
          type: 'function' as const,
          function: { name: 'workspace', description: 'Workspace tool', parameters: {} },
        },
        {
          type: 'function' as const,
          function: { name: 'read_file', description: 'Read', parameters: {} },
        },
      ]
      const oldHash = 'stable-hash-from-prior-turn'

      manager.setCachedPrompt(session.id, oldSystemPrompt, cachedTools, oldHash)

      const cachedBefore = manager.getCachedPrompt(session.id)
      expect(cachedBefore).toBeDefined()
      expect(cachedBefore?.hash).toBe(oldHash)
      expect(cachedBefore?.systemPrompt).toBe(oldSystemPrompt)

      const setCachedSpy = vi.spyOn(manager, 'setCachedPrompt')
      const resetWarmupSpy = vi.spyOn(manager, 'resetWarmup')
      setCachedSpy.mockClear()
      resetWarmupSpy.mockClear()

      orchestratorCapturedStreamCalls.length = 0
      orchestratorStreamResults.length = 0
      orchestratorStreamCallIndex.value = 0

      const workspaceToolCallId = 'call-ws-1'
      orchestratorStreamResults.push({
        content: '',
        toolCalls: [
          {
            id: workspaceToolCallId,
            name: 'workspace',
            arguments: { action: 'switch', target: 'feature-x', branch: 'requested-branch' },
          },
        ],
        segments: [],
        usage: { promptTokens: 100, completionTokens: 5 },
        timing: { ttft: 10, completionTime: 100, tps: 50, prefillTps: 100 },
        aborted: false,
        finishReason: 'tool_calls',
        modelParams: { temperature: 0 },
      })
      // The session in this file has no workspace yet, so the early-return
      // branch check (currentBranch === requestedBranch) uses the default mock
      // getGitBranch value 'feat-x' for the pre-mutation check, then 'feat-x'
      // for the post-mutation authoritative read. The reminder will therefore
      // carry branch="feat-x", distinct from the requested branch.
      mockGetGitBranch.mockResolvedValue('feat-x')
      orchestratorStreamResults.push({
        content: 'Acknowledged the workspace switch.',
        toolCalls: [],
        segments: [{ type: 'text', content: 'Acknowledged the workspace switch.' }],
        usage: { promptTokens: 200, completionTokens: 10 },
        timing: { ttft: 10, completionTime: 50, tps: 200, prefillTps: 100 },
        aborted: false,
        finishReason: 'stop',
        modelParams: { temperature: 0 },
      })

      // Stub executeTools to perform the real manager.switchWorkspace (the only
      // mutation under test) and emit the matching tool.call / tool.result events.
      // Everything else — session state, conversation history, event log — runs
      // through real production code paths.
      const executeToolsModule = await import('../chat/execute-tools.js')
      const executeToolsSpy = vi
        .spyOn(executeToolsModule, 'executeTools')
        .mockImplementation(
          async (assistantMsgId: string, toolCalls: ToolCall[], _ctx: unknown, append: (event: TurnEvent) => void) => {
            for (const toolCall of toolCalls) {
              append({
                type: 'tool.call',
                data: {
                  messageId: assistantMsgId,
                  toolCall: {
                    id: toolCall.id,
                    name: toolCall.name,
                    arguments: toolCall.arguments,
                  },
                },
              })
            }
            await manager.switchWorkspace(session.id, 'feature-x', 'requested-branch')
            const toolResult: ToolResult = {
              success: true,
              output: JSON.stringify({
                workspace: 'feature-x',
                path: '/tmp/openfox-workspaces/feature-x',
                branch: 'feature-x',
                message: 'Switched to workspace "feature-x" on branch "feature-x"',
              }),
              durationMs: 5,
              truncated: false,
            }
            for (const toolCall of toolCalls) {
              append({
                type: 'tool.result',
                data: { messageId: assistantMsgId, toolCallId: toolCall.id, result: toolResult },
              })
            }
            return {
              toolMessages: [
                {
                  role: 'tool' as const,
                  content: toolResult.output ?? '',
                  source: 'history' as const,
                  toolCallId: workspaceToolCallId,
                },
              ],
              criteriaChanged: false,
            }
          },
        )

      manager.setActiveSession(session.id)

      const { runAgentTurn } = await import('../chat/orchestrator.js')
      try {
        await runAgentTurn(
          {
            sessionManager: manager,
            sessionId: session.id,
            llmClient: {
              getModel: () => 'mock-test-model',
              setModel: vi.fn(),
              getProfile: () => ({}) as never,
              getBackend: () => 'ollama',
              setBackend: vi.fn(),
              complete: vi.fn(),
              stream: vi.fn(),
            } as never,
          },
          {
            addToolTime: vi.fn(),
            addLLMCall: vi.fn(),
            buildStats: vi.fn(() => ({})),
          } as never,
          'planner',
          vi.fn(),
        )

        expect(orchestratorCapturedStreamCalls).toHaveLength(2)
        const firstCall = orchestratorCapturedStreamCalls[0]!
        const secondCall = orchestratorCapturedStreamCalls[1]!

        // Identity of the system prompt across the two calls (character-by-character).
        expect(firstCall.systemPrompt).toBe(oldSystemPrompt)
        expect(secondCall.systemPrompt).toBe(oldSystemPrompt)
        expect(secondCall.systemPrompt).toBe(firstCall.systemPrompt)

        // Tool list reuse (deep equality).
        expect(secondCall.tools).toEqual(firstCall.tools)
        expect(firstCall.tools).toEqual(cachedTools)

        // Cache state after both calls — hash, system prompt, no rebuild helpers.
        const cachedAfter = manager.getCachedPrompt(session.id)
        expect(cachedAfter).toBeDefined()
        expect(cachedAfter?.hash).toBe(oldHash)
        expect(cachedAfter?.systemPrompt).toBe(oldSystemPrompt)
        expect(setCachedSpy).not.toHaveBeenCalled()
        expect(resetWarmupSpy).not.toHaveBeenCalled()

        // The workspace reminder reaches the second LLM call with the
        // authoritatively-read workspace, path, and branch — not the requested one.
        const secondMessages = secondCall.messages as Array<{ content: string }>
        const workspaceReminders = secondMessages.filter(
          (m) =>
            typeof m.content === 'string' && m.content.includes('<system-reminder>') && m.content.includes('workspace'),
        )
        expect(workspaceReminders.length).toBeGreaterThan(0)
        const reminder = workspaceReminders[workspaceReminders.length - 1]!
        expect(reminder.content).toContain('feature-x')
        // switchWorkspace resolves the path (manager.ts), so the reminder carries
        // the native form — on Windows that is a backslash path with a drive.
        expect(reminder.content).toContain(resolve('/tmp/openfox-workspaces', 'feature-x'))
        expect(reminder.content).toMatch(/branch\s+"feat-x"/)
        expect(reminder.content).not.toContain('requested-branch')

        // Position: the reminder arrives after at least one prior context element.
        expect(secondMessages.findIndex((m) => m === reminder)).toBeGreaterThan(0)
      } finally {
        executeToolsSpy.mockRestore()
      }
    })
  })
})
