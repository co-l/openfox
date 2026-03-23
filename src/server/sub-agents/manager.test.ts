/**
 * Sub-Agent Manager Tests
 */

import { describe, it, expect, vi } from 'vitest'
import type { SessionManager } from '../session/index.js'
import type { LLMClientWithModel } from '../llm/client.js'
import { createSubAgentRegistry } from './registry.js'

describe('SubAgentManager', () => {
  it('should execute verifier with fresh context', async () => {
    const registry = createSubAgentRegistry()
    
    // Mock session manager
    const mockSessionManager = {
      requireSession: vi.fn().mockReturnValue({
        id: 'test-session',
        projectId: 'test-project',
        workdir: '/tmp/test',
        mode: 'builder',
        phase: 'build',
        isRunning: false,
        summary: 'Implement user authentication',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
        criteria: [
          {
            id: 'auth-login',
            description: 'User can login',
            status: { type: 'completed', completedAt: new Date().toISOString() },
            attempts: [],
          },
        ],
        contextWindows: [],
        executionState: {
          iteration: 1,
          modifiedFiles: ['src/auth.ts'],
          readFiles: {},
          consecutiveFailures: 0,
          currentTokenCount: 1000,
          messageCountAtLastUpdate: 10,
          compactionCount: 0,
          startedAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
        },
        metadata: {
          totalTokensUsed: 0,
          totalToolCalls: 0,
          iterationCount: 0,
        },
      }),
      addMessage: vi.fn().mockReturnValue({
        id: 'test-msg',
        role: 'user',
        content: 'Test',
        timestamp: new Date().toISOString(),
        tokenCount: 0,
      }),
    } as unknown as SessionManager
    
    // Mock LLM client
    const mockLLMClient = {
      getModel: vi.fn().mockReturnValue('test-model'),
      generate: vi.fn().mockResolvedValue({
        content: 'All criteria verified successfully.',
        toolCalls: [],
        usage: { promptTokens: 100, completionTokens: 50 },
        timing: { ttft: 0.1, completionTime: 0.5 },
      }),
    } as unknown as LLMClientWithModel
    
    const verifier = registry.getSubAgent('verifier')
    expect(verifier).toBeDefined()
    
    // The context should be built correctly
    const session = mockSessionManager.requireSession('test-session')
    const context = verifier!.createContext(session, { prompt: 'Verify criteria' })
    
    expect(context.messages).toHaveLength(2)
    expect(context.messages[0].content).toContain('Implement user authentication')
    expect(context.requestOptions.disableThinking).toBe(true)
  })

  it('should throw error for unknown sub-agent type', () => {
    const registry = createSubAgentRegistry()
    const unknown = registry.getSubAgent('unknown_type')
    
    expect(unknown).toBeUndefined()
  })

  it('should return correct tools for each sub-agent type', () => {
    const registry = createSubAgentRegistry()
    
    expect(registry.getToolRegistry('verifier')).toEqual([
      'read_file',
      'run_command',
      'pass_criterion',
      'fail_criterion',
    ])
    
    expect(registry.getToolRegistry('code_reviewer')).toEqual([
      'read_file',
      'grep',
    ])
    
    expect(registry.getToolRegistry('test_generator')).toEqual([
      'read_file',
      'write_file',
      'run_command',
    ])
    
    expect(registry.getToolRegistry('debugger')).toEqual([
      'read_file',
      'run_command',
      'grep',
    ])
  })
})
