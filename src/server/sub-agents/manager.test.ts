/**
 * Sub-Agent Manager Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { EventStore, initEventStore } from '../events/store.js'
import { loadDefaultAgents, findAgentById } from '../agents/registry.js'
import { executeSubAgent, loadGitIgnoreRules } from './manager.js'
import type { SessionManager } from '../session/index.js'
import type { LLMClientWithModel } from '../llm/client.js'
import type { ToolRegistry } from '../tools/types.js'
import type { TurnMetrics } from '../chat/stream-pure.js'

const { getEventStoreMock, getAllInstructionsMock } = vi.hoisted(() => ({
  getEventStoreMock: vi.fn(),
  getAllInstructionsMock: vi.fn(),
}))

vi.mock('../events/index.js', () => ({
  getEventStore: getEventStoreMock,
  getCurrentContextWindowId: vi.fn(() => undefined),
  getCurrentWindowMessageOptions: vi.fn(() => undefined),
}))

vi.mock('../context/instructions.js', () => ({
  getAllInstructions: getAllInstructionsMock,
  toInjectedFiles: (files: unknown[]) => files as unknown,
}))

vi.mock('../skills/registry.js', () => ({
  getEnabledSkillMetadata: vi.fn(async () => []),
}))

vi.mock('../runtime-config.js', () => ({
  getRuntimeConfig: vi.fn(() => ({
    mode: 'development',
    context: { compactionThreshold: 0.9 },
    agent: { toolTimeout: 120000 },
  })),
}))

describe('SubAgentManager', () => {
  let db: Database.Database
  let eventStore: EventStore

  beforeEach(() => {
    vi.clearAllMocks()
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        workdir TEXT NOT NULL
      )
    `)
    eventStore = initEventStore(db)
    getEventStoreMock.mockReturnValue(eventStore)
    getAllInstructionsMock.mockResolvedValue({ content: '', files: [] })
  })

  it('should exit immediately after return_value is called without extra LLM calls', async () => {
    const mockSessionManager = {
      requireSession: vi.fn().mockReturnValue({
        criteria: [],
        workdir: '/test',
        projectId: 'test-project',
      }),
      setCurrentContextSize: vi.fn(),
      getContextState: vi.fn().mockReturnValue({
        currentTokens: 1000,
        maxTokens: 128000,
        compactionCount: 0,
        dangerZone: false,
        canCompact: false,
        dynamicContextChanged: false,
      }),
      getCurrentModelSettings: vi.fn().mockReturnValue({}),
      getCurrentModelContext: vi.fn().mockReturnValue(128000),
      getDynamicContextChanged: vi.fn().mockReturnValue(false),
      setDynamicContextChanged: vi.fn(),
      getCachedPrompt: vi.fn().mockReturnValue(undefined),
      setCachedPrompt: vi.fn(),
      getLspManager: vi.fn().mockReturnValue(undefined),
      drainAsapMessages: vi.fn().mockReturnValue([]),
      getCurrentWindowMessages: vi.fn().mockReturnValue([]),
      updateMessage: vi.fn(),
      getQueueState: vi.fn().mockReturnValue({ queued: 0, processing: false }),
      addModifiedFile: vi.fn(),
    } as unknown as SessionManager

    let llmCallCount = 0
    const mockLLMClient = {
      getModel: () => 'test-model',
      setModel: () => {},
      getProfile: () => ({ contextWindow: 128000, supportsVision: false, supportsThinking: false }),
      getBackend: () => 'ollama' as const,
      setBackend: () => {},
      stream: async function* () {
        llmCallCount++
        yield {
          type: 'tool_call_delta',
          index: 0,
          id: 'call-1',
          name: 'return_value',
          arguments: '{"content":"Test result content","result":"success"}',
        }
        yield {
          type: 'text_delta',
          content: 'Completed.',
        }
        yield {
          type: 'done',
          response: {
            id: 'mock-1',
            content: 'Completed.',
            thinkingContent: '',
            toolCalls: [
              {
                id: 'call-1',
                name: 'return_value',
                arguments: { content: 'Test result content', result: 'success' },
              },
            ],
            finishReason: 'tool_calls',
            usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
          },
        }
      },
    } as unknown as LLMClientWithModel

    const mockToolRegistry = {
      definitions: [
        {
          type: 'function',
          function: {
            name: 'return_value',
            description: 'Return value',
            parameters: { type: 'object', properties: { content: { type: 'string' }, result: { type: 'string' } } },
          },
        },
      ],
      execute: vi.fn().mockImplementation(async (name: string, args: Record<string, unknown>) => {
        if (name === 'return_value') {
          return {
            success: true,
            output: `Returned: ${args['content']} (${args['result']})`,
            durationMs: 1,
            truncated: false,
          }
        }
        return { success: true, output: 'ok', durationMs: 1, truncated: false }
      }),
    } as unknown as ToolRegistry

    const mockOnMessage = vi.fn()

    const mockTurnMetrics = {
      addLLMCall: vi.fn(),
      addToolTime: vi.fn(),
      buildStats: vi.fn().mockReturnValue({ totalDurationMs: 100, llmCalls: 1 }),
    } as unknown as TurnMetrics

    const result = await executeSubAgent({
      subAgentType: 'explorer',
      prompt: 'Do something simple and return the result.',
      sessionManager: mockSessionManager,
      sessionId: 'test-session',
      llmClient: mockLLMClient,
      toolRegistry: mockToolRegistry,
      turnMetrics: mockTurnMetrics,
      statsIdentity: { providerId: 'mock', providerName: 'mock', backend: 'ollama', model: 'test' },
      onMessage: mockOnMessage,
    })

    expect(llmCallCount).toBe(1)
    expect(result.content).toBe('Test result content')
    expect(result.result).toBe('success')

    const allCalls: Array<[unknown]> = mockOnMessage.mock.calls as Array<[unknown]>
    const chatDoneMessages = allCalls.filter(([msg]) => (msg as { type: string }).type === 'chat.done')
    expect(chatDoneMessages.length).toBe(1)
    const chatDonePayload = (chatDoneMessages[0]![0] as { payload: { reason: string } }).payload
    expect(chatDonePayload.reason).toBe('complete')

    const messageUpdatedMessages = allCalls.filter(([msg]) => (msg as { type: string }).type === 'chat.message_updated')
    expect(messageUpdatedMessages.length).toBe(1)
    const messageUpdatedPayload = (messageUpdatedMessages[0]![0] as { payload: { updates: { stats?: unknown } } })
      .payload
    expect('stats' in messageUpdatedPayload.updates).toBe(true)
  })

  it('should have verifier available in agent registry', async () => {
    const agents = await loadDefaultAgents()
    const verifier = findAgentById('verifier', agents)

    expect(verifier).toBeDefined()
    expect(verifier!.metadata.subagent).toBe(true)
    expect(verifier!.metadata.allowedTools).toContain('session_metadata')
  })

  it('should return undefined for unknown sub-agent type', async () => {
    const agents = await loadDefaultAgents()
    const unknown = findAgentById('unknown_type', agents)

    expect(unknown).toBeUndefined()
  })

  it('should return correct tools for each sub-agent type', async () => {
    const agents = await loadDefaultAgents()

    expect(findAgentById('verifier', agents)?.metadata.allowedTools).toEqual([
      'read_file',
      'run_command',
      'session_metadata',
      'web_fetch',
    ])

    expect(findAgentById('code_reviewer', agents)?.metadata.allowedTools).toEqual([
      'read_file',
      'run_command',
      'web_fetch',
      'session_metadata',
      'trace_code',
    ])

    expect(findAgentById('explorer', agents)?.metadata.allowedTools).toEqual([
      'read_file',
      'run_command',
      'web_fetch',
      'trace_code',
    ])
  })

  describe('loadGitIgnoreRules', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'openfox-gitignore-test-'))
    })

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    it('returns empty string when no .gitignore exists', async () => {
      const result = await loadGitIgnoreRules(tempDir)
      expect(result).toBe('')
    })

    it('reads .gitignore from workdir', async () => {
      await writeFile(join(tempDir, '.gitignore'), 'node_modules/\ndist/\n')
      const result = await loadGitIgnoreRules(tempDir)
      expect(result).toContain('node_modules/')
      expect(result).toContain('dist/')
      expect(result).toContain('Repository Exclusion Rules')
    })

    it('walks up to parent directory when .gitignore not in workdir', async () => {
      const subDir = join(tempDir, 'sub', 'deep')
      await mkdir(subDir, { recursive: true })
      // Put .gitignore in the parent (tempDir)
      await writeFile(join(tempDir, '.gitignore'), 'build/\n')
      // Should find it from deep subdirectory
      const result = await loadGitIgnoreRules(subDir)
      expect(result).toContain('build/')
      expect(result).toContain('Repository Exclusion Rules')
    })

    it('returns empty string for empty .gitignore', async () => {
      await writeFile(join(tempDir, '.gitignore'), '')
      const result = await loadGitIgnoreRules(tempDir)
      expect(result).toBe('')
    })

    it('returns empty string for whitespace-only .gitignore', async () => {
      await writeFile(join(tempDir, '.gitignore'), '   \n\n  \n')
      const result = await loadGitIgnoreRules(tempDir)
      expect(result).toBe('')
    })

    it('handles nonexistent workdir gracefully', async () => {
      const fakeDir = join(tempDir, 'nonexistent')
      const result = await loadGitIgnoreRules(fakeDir)
      expect(result).toBe('')
    })

    it('caps .gitignore at 100 lines to prevent prompt bloat', async () => {
      const lines = Array.from({ length: 150 }, (_, i) => `pattern${i}/`)
      await writeFile(join(tempDir, '.gitignore'), lines.join('\n'))
      const result = await loadGitIgnoreRules(tempDir)
      // Should contain first 100 patterns
      expect(result).toContain('pattern0/')
      expect(result).toContain('pattern99/')
      // Should NOT contain pattern 100+
      expect(result).not.toContain('pattern100/')
      // Should have truncation marker
      expect(result).toContain('truncated')
    })

    it('caps .gitignore at 4 KB to prevent prompt bloat', async () => {
      // Create content well over 4 KB with a single long line
      const longLine = 'x'.repeat(5000)
      await writeFile(join(tempDir, '.gitignore'), longLine)
      const result = await loadGitIgnoreRules(tempDir)
      expect(result.length).toBeLessThanOrEqual(4500) // header + capped content
    })

    it('returns empty string for relative path', async () => {
      const result = await loadGitIgnoreRules('relative/path')
      expect(result).toBe('')
    })
  })
})
