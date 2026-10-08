import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callSubAgentTool } from './sub-agent.js'
import type { ToolContext } from './types.js'
import type { SessionManager } from '../session/index.js'
import type { LLMClientWithModel } from '../llm/client.js'

const { executeSubAgentMock } = vi.hoisted(() => ({
  executeSubAgentMock: vi.fn(),
}))

vi.mock('../sub-agents/manager.js', () => ({
  executeSubAgent: executeSubAgentMock,
}))

describe('call_sub_agent tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    executeSubAgentMock.mockResolvedValue({ content: 'Done successfully', result: 'success' })
  })

  it('should have correct tool definition', () => {
    expect(callSubAgentTool.name).toBe('call_sub_agent')
    expect(callSubAgentTool.definition.type).toBe('function')
    expect(callSubAgentTool.definition.function.name).toBe('call_sub_agent')

    const params = callSubAgentTool.definition.function.parameters as any
    expect(params.properties.subAgentType.type).toBe('string')
    expect(params.properties.prompt.type).toBe('string')
    expect(params.properties.subAgentId.type).toBe('string')
    expect(params.required).toContain('subAgentType')
    expect(params.required).toContain('prompt')
    expect(params.required).not.toContain('subAgentId')
  })

  it('should reject unknown sub-agent types', async () => {
    const context: ToolContext = {
      sessionManager: {} as SessionManager,
      workdir: '/tmp/test',
      sessionId: 'test-session',
      signal: undefined,
      lspManager: undefined,
      onEvent: vi.fn(),
      onProgress: vi.fn(),
    }

    const result = await callSubAgentTool.execute({ subAgentType: 'unknown_type' as any, prompt: 'test' }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown sub-agent type')
  })

  it('should require both subAgentType and prompt parameters', async () => {
    const context: ToolContext = {
      sessionManager: {} as SessionManager,
      workdir: '/tmp/test',
      sessionId: 'test-session',
      signal: undefined,
      lspManager: undefined,
      onEvent: vi.fn(),
      onProgress: vi.fn(),
    }

    const result = await callSubAgentTool.execute({ subAgentType: 'verifier' } as any, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Missing required parameter')
  })

  it('passes explicit subAgentId to executeSubAgent when resuming', async () => {
    const mockSessionManager = {
      getLastInterruptedSubAgentForType: vi.fn(),
      clearInterruptedSubAgent: vi.fn(),
      recordInterruptedSubAgent: vi.fn(),
    } as unknown as SessionManager

    const mockLLMClient = {
      getModel: () => 'test-model',
    } as unknown as LLMClientWithModel

    const context: ToolContext = {
      sessionManager: mockSessionManager,
      workdir: '/tmp/test',
      sessionId: 'test-session',
      llmClient: mockLLMClient,
      signal: undefined,
      lspManager: undefined,
      onEvent: vi.fn(),
      onProgress: vi.fn(),
    }

    const result = await callSubAgentTool.execute(
      { subAgentType: 'verifier', prompt: 'Continue verification', subAgentId: 'prev-id-456' },
      context,
    )

    expect(result.success).toBe(true)
    expect(executeSubAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subAgentType: 'verifier',
        subAgentId: 'prev-id-456',
        prompt: 'Continue verification',
      }),
    )
    expect(mockSessionManager.clearInterruptedSubAgent).toHaveBeenCalledWith('test-session', 'prev-id-456')
  })

  it('auto-resumes last interrupted sub-agent when prompt indicates continuation without subAgentId', async () => {
    const mockSessionManager = {
      getLastInterruptedSubAgentForType: vi.fn().mockReturnValue({
        subAgentId: 'auto-resume-id-789',
        subAgentType: 'explorer',
        prompt: 'Original prompt',
        interruptedAt: Date.now() - 5000,
      }),
      clearInterruptedSubAgent: vi.fn(),
      recordInterruptedSubAgent: vi.fn(),
    } as unknown as SessionManager

    const mockLLMClient = {
      getModel: () => 'test-model',
    } as unknown as LLMClientWithModel

    const context: ToolContext = {
      sessionManager: mockSessionManager,
      workdir: '/tmp/test',
      sessionId: 'test-session',
      llmClient: mockLLMClient,
      signal: undefined,
      lspManager: undefined,
      onEvent: vi.fn(),
      onProgress: vi.fn(),
    }

    const result = await callSubAgentTool.execute(
      { subAgentType: 'explorer', prompt: 'Please continue where you left off' },
      context,
    )

    expect(result.success).toBe(true)
    expect(mockSessionManager.getLastInterruptedSubAgentForType).toHaveBeenCalledWith('test-session', 'explorer')
    expect(executeSubAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subAgentType: 'explorer',
        subAgentId: 'auto-resume-id-789',
        prompt: 'Please continue where you left off',
      }),
    )
    expect(mockSessionManager.clearInterruptedSubAgent).toHaveBeenCalledWith('test-session', 'auto-resume-id-789')
    // The implicit resume must be surfaced so the caller knows a prior context was reattached.
    expect(result.metadata).toEqual({
      autoResumed: true,
      subAgentId: 'auto-resume-id-789',
      subAgentType: 'explorer',
    })
  })

  it('records interrupted sub-agent and returns instructive message on abort', async () => {
    const mockSessionManager = {
      getLastInterruptedSubAgentForType: vi.fn(),
      clearInterruptedSubAgent: vi.fn(),
      recordInterruptedSubAgent: vi.fn(),
    } as unknown as SessionManager

    const mockLLMClient = {
      getModel: () => 'test-model',
    } as unknown as LLMClientWithModel

    executeSubAgentMock.mockRejectedValue(new Error('Aborted'))

    const context: ToolContext = {
      sessionManager: mockSessionManager,
      workdir: '/tmp/test',
      sessionId: 'test-session',
      llmClient: mockLLMClient,
      signal: undefined,
      lspManager: undefined,
      onEvent: vi.fn(),
      onProgress: vi.fn(),
    }

    const result = await callSubAgentTool.execute(
      { subAgentType: 'verifier', prompt: 'Verify everything', subAgentId: 'interrupted-sub-id' },
      context,
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('interrupted-sub-id')
    expect(result.error).toContain('verifier')
    expect(result.error).toContain('call_sub_agent with subAgentId')
    expect(result.error).toContain('Do NOT relaunch a new sub-agent from scratch')
    expect(result.metadata).toMatchObject({
      interrupted: true,
      subAgentId: 'interrupted-sub-id',
      subAgentType: 'verifier',
    })
    expect(mockSessionManager.recordInterruptedSubAgent).toHaveBeenCalledWith(
      'test-session',
      expect.objectContaining({
        subAgentId: 'interrupted-sub-id',
        subAgentType: 'verifier',
      }),
    )
  })
})
