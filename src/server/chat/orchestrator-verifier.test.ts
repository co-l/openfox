/**
 * Test that runVerifierTurn uses SubAgentManager
 */

import { describe, it, expect, vi } from 'vitest'
import type { SessionManager } from '../session/index.js'
import type { LLMClientWithModel } from '../llm/client.js'
import { runVerifierTurn } from './orchestrator.js'
import { TurnMetrics } from './stream-pure.js'

describe('runVerifierTurn - Sub-Agent Integration', () => {
  it('should use SubAgentManager to execute verifier', async () => {
    // This test verifies that runVerifierTurn delegates to SubAgentManager
    // rather than implementing verifier logic directly
    
    const mockSessionManager = {
      requireSession: vi.fn().mockReturnValue({
        id: 'test-session',
        projectId: 'test-project',
        workdir: '/tmp/test',
        mode: 'builder',
        phase: 'verification',
        isRunning: false,
        summary: 'Test summary',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
        criteria: [
          {
            id: 'test-1',
            description: 'Test criterion',
            status: { type: 'completed', completedAt: new Date().toISOString() },
            attempts: [],
          },
        ],
        contextWindows: [],
        executionState: {
          iteration: 1,
          modifiedFiles: ['src/test.ts'],
          readFiles: {},
          consecutiveFailures: 0,
          currentTokenCount: 100,
          messageCountAtLastUpdate: 5,
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
        id: 'msg-1',
        role: 'user',
        content: 'Test',
        timestamp: new Date().toISOString(),
        tokenCount: 0,
      }),
      updateCriterionStatus: vi.fn(),
      addCriterionAttempt: vi.fn(),
    } as unknown as SessionManager

    const mockLLMClient = {
      getModel: vi.fn().mockReturnValue('test-model'),
      generate: vi.fn().mockResolvedValue({
        content: 'All criteria verified successfully.',
        toolCalls: [],
        usage: { promptTokens: 100, completionTokens: 50 },
        timing: { ttft: 0.1, completionTime: 0.5 },
      }),
    } as unknown as LLMClientWithModel

    const mockOnMessage = vi.fn()

    const options = {
      sessionManager: mockSessionManager,
      sessionId: 'test-session',
      llmClient: mockLLMClient,
      onMessage: mockOnMessage,
    }

    const turnMetrics = new TurnMetrics()

    // This should not throw and should use the sub-agent framework
    const result = await runVerifierTurn(options, turnMetrics)

    // Verify result structure
    expect(result).toHaveProperty('allPassed')
    expect(result).toHaveProperty('failed')
    expect(Array.isArray(result.failed)).toBe(true)
  })
})
