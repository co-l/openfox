import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LLMToolDefinition } from '../llm/types.js'
import type { SessionManager } from '../session/manager.js'
import type { TurnEvent } from '../events/types.js'
import {
  checkToolChangesAndInject,
  computeDynamicContextHash,
  getToolFingerprint,
  injectContextDriftReminders,
  injectContextDriftRemindersForSessions,
} from './dynamic-context.js'
import { getToolRegistryForAgent } from '../tools/index.js'
import { getCurrentContextWindowId, getEventStore } from '../events/index.js'

const { eventStoreAppendMock } = vi.hoisted(() => {
  const eventStoreAppendMock = vi.fn()
  return { eventStoreAppendMock }
})

vi.mock('../tools/index.js', () => ({
  getToolRegistryForAgent: vi.fn(),
}))

vi.mock('../events/index.js', () => ({
  getCurrentContextWindowId: vi.fn(() => undefined),
  getEventStore: vi.fn(() => ({ append: eventStoreAppendMock })),
}))

vi.mock('../agents/registry.js', () => ({
  loadAllAgentsDefault: vi.fn(async () => [{ metadata: { id: 'builder', name: 'Builder' } }]),
  findAgentById: vi.fn((id: string) => ({ metadata: { id, name: 'Builder' } })),
  resolveDefaultAgentId: vi.fn(() => 'builder'),
  getSubAgents: vi.fn(() => []),
}))

vi.mock('../context/instructions.js', () => ({
  getAllInstructions: vi.fn(async () => ({ content: 'instructions', files: [] })),
}))

vi.mock('../skills/registry.js', () => ({
  getEnabledSkillMetadata: vi.fn(async () => []),
}))

vi.mock('../runtime-config.js', () => ({
  getRuntimeConfig: vi.fn(() => ({ mode: 'production' })),
}))

vi.mock('../../cli/paths.js', () => ({
  getGlobalConfigDir: vi.fn(() => '/tmp/config'),
}))

vi.mock('./prompts.js', () => ({
  buildTopLevelSystemPrompt: vi.fn(() => 'new system prompt'),
}))

function tool(name: string, opts: { description?: string; parameters?: unknown } = {}): LLMToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description: opts.description ?? `desc ${name}`,
      parameters: (opts.parameters ?? {
        type: 'object',
        properties: {},
      }) as LLMToolDefinition['function']['parameters'],
    },
  }
}

interface CachedState {
  systemPrompt: string
  tools: LLMToolDefinition[]
  hash: string
  promptHash?: string
}

function createSessionManager(initial?: CachedState) {
  let cached: CachedState | undefined = initial
  let announcedPromptHash: string | undefined
  let announcedToolFingerprint: string | undefined
  let activeSubAgent: { subAgentId: string; subAgentType: string } | undefined
  return {
    getCachedPrompt: vi.fn(() => cached),
    setCachedPrompt: vi.fn(
      (_sessionId: string, systemPrompt: string, tools: LLMToolDefinition[], hash: string, promptHash?: string) => {
        cached = { systemPrompt, tools, hash, ...(promptHash ? { promptHash } : {}) }
      },
    ),
    getAnnouncedPromptHash: vi.fn(() => announcedPromptHash),
    setAnnouncedPromptHash: vi.fn((_sessionId: string, hash: string) => {
      announcedPromptHash = hash
    }),
    getAnnouncedToolFingerprint: vi.fn(() => announcedToolFingerprint),
    setAnnouncedToolFingerprint: vi.fn((_sessionId: string, fingerprint: string) => {
      announcedToolFingerprint = fingerprint
    }),
    setDynamicContextChanged: vi.fn(),
    getActiveSubAgent: vi.fn(() => activeSubAgent),
    setActiveSubAgent: vi.fn((_sessionId: string, subAgent?: { subAgentId: string; subAgentType: string }) => {
      activeSubAgent = subAgent
    }),
  } as unknown as SessionManager
}

function createAppend() {
  const events: TurnEvent[] = []
  const append = vi.fn((event: TurnEvent) => {
    events.push(event)
  })
  return { append, events }
}

function reminders(events: TurnEvent[]) {
  return events.filter((e) => e.type === 'message.start')
}

const agentDef = { metadata: { id: 'builder', name: 'Builder' } } as never

const OPTIONS = {
  modelName: 'test-model',
  instructionContent: 'instructions',
  skills: [],
  buildNewSystemPrompt: () => 'new system prompt',
}

describe('checkToolChangesAndInject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCurrentContextWindowId).mockReturnValue(undefined)
  })

  it('does nothing when no cached prompt exists', async () => {
    const sessionManager = createSessionManager()
    const { append, events } = createAppend()
    const result = await checkToolChangesAndInject(sessionManager, 's1', agentDef, OPTIONS, append)
    expect(result).toEqual({ injectedToolReminder: false, injectedPromptReminder: false })
    expect(events).toEqual([])
    expect(sessionManager.setCachedPrompt).not.toHaveBeenCalled()
  })

  it('injects a tool reminder WITHOUT mutating the cached prefix (frozen cache)', async () => {
    const cachedTools = [tool('read_file')]
    const liveTools = [tool('read_file'), tool('write_file')]
    vi.mocked(getToolRegistryForAgent).mockReturnValue({ definitions: liveTools } as never)
    const sessionManager = createSessionManager({
      systemPrompt: 'new system prompt',
      tools: cachedTools,
      hash: 'old-hash',
    })
    const { append, events } = createAppend()

    const result = await checkToolChangesAndInject(sessionManager, 's1', agentDef, OPTIONS, append)

    expect(result.injectedToolReminder).toBe(true)
    const starts = reminders(events)
    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({
      type: 'message.start',
      data: {
        role: 'user',
        isSystemGenerated: true,
        messageKind: 'auto-prompt',
        metadata: { type: 'tools', name: 'Tools', kind: 'reminder' },
      },
    })
    expect(starts[0]!.data.content).toContain('write_file')
    expect(starts[0]!.data.content).toContain('"name": "write_file"')
    expect(events.some((e) => e.type === 'message.done')).toBe(true)
    // The cached prefix must stay frozen — no setCachedPrompt, no hash rewrite.
    expect(sessionManager.setCachedPrompt).not.toHaveBeenCalled()
    expect(sessionManager.getCachedPrompt('s1')?.tools).toEqual(cachedTools)
    expect(sessionManager.getCachedPrompt('s1')?.hash).toBe('old-hash')
    // Exactly-once is tracked via the announced tool fingerprint instead.
    expect(sessionManager.setAnnouncedToolFingerprint).toHaveBeenCalled()
    // Drift lights up the rebase door: dynamicContextChanged flips to true.
    expect(sessionManager.setDynamicContextChanged).toHaveBeenCalledWith('s1', true)
  })

  it('tags injected reminders with the active sub-agent identity', async () => {
    vi.mocked(getToolRegistryForAgent).mockReturnValue({
      definitions: [tool('read_file'), tool('write_file')],
    } as never)
    const sessionManager = createSessionManager({
      systemPrompt: 'new system prompt',
      tools: [tool('read_file')],
      hash: 'old-hash',
    })
    sessionManager.setActiveSubAgent('s1', { subAgentId: 'sub-1', subAgentType: 'explorer' })
    const { append, events } = createAppend()

    const result = await checkToolChangesAndInject(sessionManager, 's1', agentDef, OPTIONS, append)

    expect(result.injectedToolReminder).toBe(true)
    const starts = reminders(events)
    expect(starts).toHaveLength(1)
    expect(starts[0]!.data.subAgentId).toBe('sub-1')
    expect(starts[0]!.data.subAgentType).toBe('explorer')
  })

  it('leaves reminders untagged when no sub-agent is active', async () => {
    vi.mocked(getToolRegistryForAgent).mockReturnValue({
      definitions: [tool('read_file'), tool('write_file')],
    } as never)
    const sessionManager = createSessionManager({
      systemPrompt: 'new system prompt',
      tools: [tool('read_file')],
      hash: 'old-hash',
    })
    const { append, events } = createAppend()

    await checkToolChangesAndInject(sessionManager, 's1', agentDef, OPTIONS, append)

    const starts = reminders(events)
    expect(starts).toHaveLength(1)
    expect(starts[0]!.data.subAgentId).toBeUndefined()
    expect(starts[0]!.data.subAgentType).toBeUndefined()
  })

  it('injects exactly once across consecutive turns (injection-once semantics)', async () => {
    const liveTools = [tool('read_file'), tool('write_file')]
    vi.mocked(getToolRegistryForAgent).mockReturnValue({ definitions: liveTools } as never)
    const sessionManager = createSessionManager({
      systemPrompt: 'new system prompt',
      tools: [tool('read_file')],
      hash: 'old-hash',
    })
    const { append, events } = createAppend()

    const first = await checkToolChangesAndInject(sessionManager, 's1', agentDef, OPTIONS, append)
    expect(first.injectedToolReminder).toBe(true)

    const second = await checkToolChangesAndInject(sessionManager, 's1', agentDef, OPTIONS, append)
    expect(second).toEqual({ injectedToolReminder: false, injectedPromptReminder: false })
    expect(reminders(events)).toHaveLength(1)
  })

  it('injects a reminder when a tool is removed', async () => {
    vi.mocked(getToolRegistryForAgent).mockReturnValue({ definitions: [tool('read_file')] } as never)
    const sessionManager = createSessionManager({
      systemPrompt: 'new system prompt',
      tools: [tool('read_file'), tool('write_file')],
      hash: 'old-hash',
    })
    const { append, events } = createAppend()

    const result = await checkToolChangesAndInject(sessionManager, 's1', agentDef, OPTIONS, append)

    expect(result.injectedToolReminder).toBe(true)
    expect(reminders(events)[0]!.data.content).toContain('write_file')
  })

  it('injects a reminder when a tool signature changes (same name, new description)', async () => {
    vi.mocked(getToolRegistryForAgent).mockReturnValue({
      definitions: [tool('read_file', { description: 'new description' })],
    } as never)
    const sessionManager = createSessionManager({
      systemPrompt: 'new system prompt',
      tools: [tool('read_file', { description: 'old description' })],
      hash: 'old-hash',
    })
    const { append, events } = createAppend()

    const result = await checkToolChangesAndInject(sessionManager, 's1', agentDef, OPTIONS, append)

    expect(result.injectedToolReminder).toBe(true)
    expect(reminders(events)[0]!.data.content).toContain('read_file')
  })

  it('injects a system prompt diff reminder when the prompt text drifts', async () => {
    vi.mocked(getToolRegistryForAgent).mockReturnValue({ definitions: [tool('read_file')] } as never)
    const sessionManager = createSessionManager({ systemPrompt: 'old prompt', tools: [tool('read_file')], hash: 'h1' })
    const { append, events } = createAppend()

    const options = {
      ...OPTIONS,
      buildNewSystemPrompt: () => 'new prompt text',
    }
    const result = await checkToolChangesAndInject(sessionManager, 's1', agentDef, options, append)

    expect(result.injectedPromptReminder).toBe(true)
    const starts = reminders(events)
    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({
      data: { metadata: { type: 'system-prompt', name: 'System Prompt', kind: 'reminder' } },
    })
    expect(starts[0]!.data.content).toContain('<system-reminder>')
    expect(sessionManager.setCachedPrompt).not.toHaveBeenCalled()
  })

  it('does not re-inject the prompt reminder on subsequent turns', async () => {
    vi.mocked(getToolRegistryForAgent).mockReturnValue({ definitions: [tool('read_file')] } as never)
    const sessionManager = createSessionManager({ systemPrompt: 'old prompt', tools: [tool('read_file')], hash: 'h1' })
    const { append, events } = createAppend()
    const options = { ...OPTIONS, buildNewSystemPrompt: () => 'new prompt text' }

    const first = await checkToolChangesAndInject(sessionManager, 's1', agentDef, options, append)
    expect(first.injectedPromptReminder).toBe(true)

    const second = await checkToolChangesAndInject(sessionManager, 's1', agentDef, options, append)
    expect(second.injectedPromptReminder).toBe(false)
    expect(reminders(events)).toHaveLength(1)
  })

  it('injects both reminders when tools and prompt change together', async () => {
    vi.mocked(getToolRegistryForAgent).mockReturnValue({
      definitions: [tool('read_file'), tool('write_file')],
    } as never)
    const sessionManager = createSessionManager({
      systemPrompt: 'old prompt',
      tools: [tool('read_file')],
      hash: 'h1',
    })
    const { append, events } = createAppend()
    const options = { ...OPTIONS, buildNewSystemPrompt: () => 'new prompt text' }

    const result = await checkToolChangesAndInject(sessionManager, 's1', agentDef, options, append)

    expect(result.injectedToolReminder).toBe(true)
    expect(result.injectedPromptReminder).toBe(true)
    expect(reminders(events)).toHaveLength(2)
  })

  it('injects no reminders when nothing changed', async () => {
    const tools = [tool('read_file')]
    vi.mocked(getToolRegistryForAgent).mockReturnValue({ definitions: tools } as never)
    const sessionManager = createSessionManager({ systemPrompt: 'new system prompt', tools, hash: 'h1' })
    const { append, events } = createAppend()

    const result = await checkToolChangesAndInject(sessionManager, 's1', agentDef, OPTIONS, append)

    expect(result).toEqual({ injectedToolReminder: false, injectedPromptReminder: false })
    expect(events).toEqual([])
  })

  it('does not build the new system prompt text when the prompt hash matches', async () => {
    const tools = [tool('read_file')]
    vi.mocked(getToolRegistryForAgent).mockReturnValue({ definitions: tools } as never)
    const sessionManager = createSessionManager({ systemPrompt: 'prompt', tools, hash: 'h1' })
    const livePromptHash = computeDynamicContextHash('instructions', [], undefined, 'test-model')
    sessionManager.setAnnouncedPromptHash('s1', livePromptHash)
    const buildNewSystemPrompt = vi.fn(() => 'prompt')
    const { append, events } = createAppend()

    const result = await checkToolChangesAndInject(
      sessionManager,
      's1',
      agentDef,
      { ...OPTIONS, buildNewSystemPrompt },
      append,
    )

    expect(result.injectedPromptReminder).toBe(false)
    expect(buildNewSystemPrompt).not.toHaveBeenCalled()
    expect(events).toEqual([])
  })

  it('does not spuriously run a prompt-diff check after restart when only tools drifted', async () => {
    // Post-restart: the announced prompt hash is lost (in-memory), but the
    // cached prompt persists its TOOL-INDEPENDENT promptHash. A tool change
    // must NOT make the prompt hash look drifted.
    const tools = [tool('read_file')]
    const livePromptHash = computeDynamicContextHash('instructions', [], undefined, 'test-model')
    vi.mocked(getToolRegistryForAgent).mockReturnValue({
      definitions: [tool('read_file'), tool('write_file')],
    } as never)
    const sessionManager = createSessionManager({
      systemPrompt: 'prompt',
      tools,
      hash: computeDynamicContextHash('instructions', [], getToolFingerprint(tools), 'test-model'),
      promptHash: livePromptHash,
    })
    const buildNewSystemPrompt = vi.fn(() => 'prompt')
    const { append } = createAppend()

    const result = await checkToolChangesAndInject(
      sessionManager,
      's1',
      agentDef,
      { ...OPTIONS, buildNewSystemPrompt },
      append,
    )

    // Tool reminder fires (frozen prefix), but the prompt check is skipped:
    // buildNewSystemPrompt is never invoked.
    expect(result.injectedToolReminder).toBe(true)
    expect(result.injectedPromptReminder).toBe(false)
    expect(buildNewSystemPrompt).not.toHaveBeenCalled()
    expect(sessionManager.setCachedPrompt).not.toHaveBeenCalled()
  })

  it('keeps the cached tools byte-identical when the mcp_config tool definition changes', async () => {
    const cachedTools = [
      tool('mcp_config', {
        description: 'Configure MCP servers',
        parameters: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'add'] } } },
      }),
    ]
    const liveTools = [
      tool('mcp_config', {
        description: 'Configure MCP servers',
        parameters: {
          type: 'object',
          properties: { action: { type: 'string', enum: ['list', 'add', 'bootstrap'] } },
        },
      }),
    ]
    vi.mocked(getToolRegistryForAgent).mockReturnValue({ definitions: liveTools } as never)
    const sessionManager = createSessionManager({
      systemPrompt: 'new system prompt',
      tools: cachedTools,
      hash: 'old-hash',
    })
    const { append, events } = createAppend()

    const result = await checkToolChangesAndInject(sessionManager, 's1', agentDef, OPTIONS, append)

    expect(result.injectedToolReminder).toBe(true)
    expect(reminders(events)[0]!.data.content).toContain('bootstrap')
    // Prefix invariant: cached tools untouched → provider prefix cache stays valid.
    expect(sessionManager.getCachedPrompt('s1')?.tools).toEqual(cachedTools)
    expect(sessionManager.setCachedPrompt).not.toHaveBeenCalled()
  })

  it('scopes injected reminders to the current context window', async () => {
    vi.mocked(getToolRegistryForAgent).mockReturnValue({
      definitions: [tool('read_file'), tool('write_file')],
    } as never)
    const sessionManager = createSessionManager({
      systemPrompt: 'new system prompt',
      tools: [tool('read_file')],
      hash: 'old-hash',
    })
    const { append, events } = createAppend()
    const originalWindowId = getCurrentContextWindowId('s1')
    ;(getCurrentContextWindowId as ReturnType<typeof vi.fn>).mockReturnValue('window-9')

    await checkToolChangesAndInject(sessionManager, 's1', agentDef, OPTIONS, append)

    const start = reminders(events)[0]!
    expect(start.data.contextWindowId).toBe('window-9')
    ;(getCurrentContextWindowId as ReturnType<typeof vi.fn>).mockReturnValue(originalWindowId)
  })
})

describe('injectContextDriftReminders', () => {
  function createSelfContainedSessionManager(initial?: CachedState, extra: Record<string, CachedState> = {}) {
    const caches = new Map<string, CachedState>(Object.entries(extra))
    if (initial) caches.set('s1', initial)
    const announcedHashes = new Map<string, string>()
    const announcedFingerprints = new Map<string, string>()
    return {
      getCachedPrompt: vi.fn((sessionId: string) => caches.get(sessionId)),
      setCachedPrompt: vi.fn(
        (sessionId: string, systemPrompt: string, tools: LLMToolDefinition[], hash: string, promptHash?: string) => {
          caches.set(sessionId, { systemPrompt, tools, hash, ...(promptHash ? { promptHash } : {}) })
        },
      ),
      getAnnouncedPromptHash: vi.fn((sessionId: string) => announcedHashes.get(sessionId)),
      setAnnouncedPromptHash: vi.fn((sessionId: string, hash: string) => {
        announcedHashes.set(sessionId, hash)
      }),
      getAnnouncedToolFingerprint: vi.fn((sessionId: string) => announcedFingerprints.get(sessionId)),
      setAnnouncedToolFingerprint: vi.fn((sessionId: string, fingerprint: string) => {
        announcedFingerprints.set(sessionId, fingerprint)
      }),
      setDynamicContextChanged: vi.fn(),
      getProjectWorkdir: vi.fn(() => '/tmp/project'),
      requireSession: vi.fn(() => ({ workdir: '/tmp/project', mode: 'builder', projectId: 'p1' })),
      resolveEffectiveProviderModel: vi.fn(() => ({ providerId: null, model: 'test-model' })),
      getProviderManager: vi.fn(() => ({ getCurrentModel: () => 'test-model' })),
    } as unknown as SessionManager
  }

  beforeEach(() => {
    eventStoreAppendMock.mockClear()
  })

  it('injects a tool reminder immediately at the point of contention', async () => {
    vi.mocked(getToolRegistryForAgent).mockReturnValue({
      definitions: [tool('read_file'), tool('write_file')],
    } as never)
    const sessionManager = createSelfContainedSessionManager({
      systemPrompt: 'new system prompt',
      tools: [tool('read_file')],
      hash: 'old-hash',
    })
    const { append, events } = createAppend()

    const result = await injectContextDriftReminders(sessionManager, 's1', append)

    expect(result.injectedToolReminder).toBe(true)
    expect(result.injectedPromptReminder).toBe(false)
    const starts = reminders(events)
    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({
      data: { metadata: { type: 'tools', name: 'Tools', kind: 'reminder' } },
    })
    expect(starts[0]!.data.content).toContain('write_file')
    // Point-of-contention injection must not mutate the cached prefix either.
    expect(sessionManager.setCachedPrompt).not.toHaveBeenCalled()
    expect(sessionManager.setAnnouncedToolFingerprint).toHaveBeenCalled()
  })

  it('injects a system prompt diff reminder at the point of contention', async () => {
    vi.mocked(getToolRegistryForAgent).mockReturnValue({ definitions: [tool('read_file')] } as never)
    const sessionManager = createSelfContainedSessionManager({
      systemPrompt: 'old prompt',
      tools: [tool('read_file')],
      hash: 'h1',
    })
    const { append, events } = createAppend()

    const result = await injectContextDriftReminders(sessionManager, 's1', append)

    expect(result.injectedPromptReminder).toBe(true)
    const starts = reminders(events)
    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({
      data: { metadata: { type: 'system-prompt', name: 'System Prompt', kind: 'reminder' } },
    })
    expect(starts[0]!.data.content).toContain('<system-reminder>')
  })

  it('resolves the concrete model name (expanding auto) for hash parity with the turn', async () => {
    vi.mocked(getToolRegistryForAgent).mockReturnValue({ definitions: [tool('read_file')] } as never)
    const sessionManager = createSelfContainedSessionManager({
      systemPrompt: 'old prompt',
      tools: [tool('read_file')],
      hash: 'h1',
    })
    ;(sessionManager.resolveEffectiveProviderModel as ReturnType<typeof vi.fn>).mockReturnValue({
      providerId: 'p1',
      model: 'auto',
    })
    ;(sessionManager.getProviderManager as ReturnType<typeof vi.fn>).mockReturnValue({
      resolveModel: () => 'concrete-model',
      createClient: () => ({ getModel: () => 'concrete-model' }),
      getCurrentModel: () => 'fallback-model',
    })
    const { append } = createAppend()

    const result = await injectContextDriftReminders(sessionManager, 's1', append)

    expect(result.injectedPromptReminder).toBe(true)
    expect(sessionManager.setAnnouncedPromptHash).toHaveBeenCalledWith(
      's1',
      computeDynamicContextHash('instructions', [], undefined, 'concrete-model'),
    )
  })

  it('does not re-inject the same drift on a second call (exactly-once)', async () => {
    vi.mocked(getToolRegistryForAgent).mockReturnValue({
      definitions: [tool('read_file'), tool('write_file')],
    } as never)
    const sessionManager = createSelfContainedSessionManager({
      systemPrompt: 'new system prompt',
      tools: [tool('read_file')],
      hash: 'old-hash',
    })
    const { append, events } = createAppend()

    await injectContextDriftReminders(sessionManager, 's1', append)
    const second = await injectContextDriftReminders(sessionManager, 's1', append)

    expect(second).toEqual({ injectedToolReminder: false, injectedPromptReminder: false })
    expect(reminders(events)).toHaveLength(1)
  })

  it('uses the event store to append when no append closure is given', async () => {
    vi.mocked(getToolRegistryForAgent).mockReturnValue({
      definitions: [tool('read_file'), tool('write_file')],
    } as never)
    const sessionManager = createSelfContainedSessionManager({
      systemPrompt: 'new system prompt',
      tools: [tool('read_file')],
      hash: 'old-hash',
    })

    const result = await injectContextDriftReminders(sessionManager, 's1')

    expect(result.injectedToolReminder).toBe(true)
    expect(getEventStore).toHaveBeenCalledWith()
    expect(eventStoreAppendMock).toHaveBeenCalled()
    const event = eventStoreAppendMock.mock.calls[0]?.[1] as TurnEvent
    expect(event.type).toBe('message.start')
  })

  it('is best-effort — returns a no-op result when the session is missing', async () => {
    const sessionManager = createSelfContainedSessionManager({
      systemPrompt: 'prompt',
      tools: [tool('read_file')],
      hash: 'h1',
    })
    ;(sessionManager.requireSession as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Session not found')
    })
    const { append, events } = createAppend()

    const result = await injectContextDriftReminders(sessionManager, 'missing', append)

    expect(result).toEqual({ injectedToolReminder: false, injectedPromptReminder: false })
    expect(events).toEqual([])
  })

  it('does nothing when no cached prompt exists', async () => {
    const sessionManager = createSelfContainedSessionManager()
    const { append, events } = createAppend()

    const result = await injectContextDriftReminders(sessionManager, 's1', append)

    expect(result).toEqual({ injectedToolReminder: false, injectedPromptReminder: false })
    expect(events).toEqual([])
  })

  it('injects for every session in the batch without mutating cached prefixes', async () => {
    vi.mocked(getToolRegistryForAgent).mockReturnValue({
      definitions: [tool('read_file'), tool('write_file')],
    } as never)
    const sessionManager = createSelfContainedSessionManager(undefined, {
      s1: { systemPrompt: 'p', tools: [tool('read_file')], hash: 'h1' },
      s2: { systemPrompt: 'p', tools: [tool('read_file')], hash: 'h2' },
    })

    await injectContextDriftRemindersForSessions(sessionManager, ['s1', 's2'])

    expect(sessionManager.setCachedPrompt).not.toHaveBeenCalled()
    expect(sessionManager.setAnnouncedToolFingerprint).toHaveBeenCalledWith('s1', expect.any(String))
    expect(sessionManager.setAnnouncedToolFingerprint).toHaveBeenCalledWith('s2', expect.any(String))
  })
})
