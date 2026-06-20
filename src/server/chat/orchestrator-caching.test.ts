import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SessionManager } from '../session/index.js'
import type { AgentDefinition } from '../agents/types.js'
import type { SkillMetadata } from '../skills/types.js'
import { createAssemblyResult, assembleAgentRequest } from './request-context.js'
import { computeDynamicContextHash } from './dynamic-context.js'

vi.mock('./dynamic-context.js', () => ({
  computeDynamicContextHash: vi.fn(),
}))

vi.mock('./request-context.js', () => ({
  createAssemblyResult: vi.fn((input) => ({
    systemPrompt: input.systemPrompt,
    messages: input.messages ?? [],
  })),
  assembleAgentRequest: vi.fn((input) => ({
    systemPrompt: 'fresh-agent-prompt',
    messages: input.messages ?? [],
  })),
}))

function makeAssembleRequest(sessionManager: SessionManager, instructionContent: string, skills: SkillMetadata[]) {
  const agentDef = { metadata: { subagent: false, id: 'planner', name: 'Planner' } } as AgentDefinition
  const subAgentDefs: AgentDefinition[] = []

  return (input: any) => {
    const cached = sessionManager.getCachedPrompt('test-session')
    if (cached) {
      const currentHash = computeDynamicContextHash(instructionContent ?? '', skills)
      if (cached.hash !== currentHash) {
        sessionManager.setDynamicContextChanged('test-session', true)
      }
      return createAssemblyResult({
        systemPrompt: cached.systemPrompt,
        messages: input.messages,
        injectedFiles: input.injectedFiles,
        requestTools: input.promptTools,
        toolChoice: input.toolChoice,
      })
    }
    const result = assembleAgentRequest({
      ...input,
      agentDef,
      subAgentDefs,
      modelName: 'test-model',
    })
    const hash = computeDynamicContextHash(instructionContent ?? '', skills)
    sessionManager.setCachedPrompt('test-session', result.systemPrompt, hash)
    return result
  }
}

describe('orchestrator assembleRequest caching', () => {
  let sessionManager: SessionManager
  let setCachedPrompt: ReturnType<typeof vi.fn>
  let getCachedPrompt: ReturnType<typeof vi.fn>
  let setDynamicContextChanged: ReturnType<typeof vi.fn>

  const baseInput = {
    workdir: '/test',
    messages: [],
    injectedFiles: [],
    promptTools: [],
    toolChoice: 'auto' as const,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    setCachedPrompt = vi.fn()
    getCachedPrompt = vi.fn()
    setDynamicContextChanged = vi.fn()
    ;(computeDynamicContextHash as any).mockReturnValue('test-hash')

    sessionManager = {
      getCachedPrompt,
      setCachedPrompt,
      setDynamicContextChanged,
    } as any
  })

  it('builds fresh and caches on first call (no cache)', () => {
    getCachedPrompt.mockReturnValue(undefined)

    const assembleRequest = makeAssembleRequest(sessionManager, 'instructions', [])
    const result = assembleRequest(baseInput)

    expect(result.systemPrompt).toBe('fresh-agent-prompt')
    expect(setCachedPrompt).toHaveBeenCalledWith('test-session', 'fresh-agent-prompt', 'test-hash')
    expect(setDynamicContextChanged).not.toHaveBeenCalled()
  })

  it('uses cached prompt when hash matches', () => {
    getCachedPrompt.mockReturnValue({ systemPrompt: 'cached-prompt', hash: 'test-hash' })
    ;(computeDynamicContextHash as any).mockReturnValue('test-hash')

    const assembleRequest = makeAssembleRequest(sessionManager, 'instructions', [])
    const result = assembleRequest(baseInput)

    expect(result.systemPrompt).toBe('cached-prompt')
    expect(setCachedPrompt).not.toHaveBeenCalled()
    expect(setDynamicContextChanged).not.toHaveBeenCalled()
  })

  it('sets dynamicContextChanged when hash differs', () => {
    getCachedPrompt.mockReturnValue({ systemPrompt: 'cached-prompt', hash: 'old-hash' })
    ;(computeDynamicContextHash as any).mockReturnValue('new-hash')

    const assembleRequest = makeAssembleRequest(sessionManager, 'instructions', [])
    const result = assembleRequest(baseInput)

    expect(result.systemPrompt).toBe('cached-prompt')
    expect(setCachedPrompt).not.toHaveBeenCalled()
    expect(setDynamicContextChanged).toHaveBeenCalledWith('test-session', true)
  })
})
