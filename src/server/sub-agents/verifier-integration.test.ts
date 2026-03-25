/**
 * Verifier Migration Tests - Testing that verifier uses sub-agent framework
 */

import { describe, it, expect } from 'vitest'
import type { Session } from '../../shared/types.js'
import { createSubAgentRegistry } from './registry.js'

describe('Verifier Sub-Agent Integration', () => {
  it('should have verifier defined in registry', () => {
    const registry = createSubAgentRegistry()
    const verifier = registry.getSubAgent('verifier')
    
    expect(verifier).toBeDefined()
    expect(verifier?.id).toBe('verifier')
    expect(verifier?.createContext).toBeDefined()
    expect(verifier?.name).toBe('Verifier')
    expect(typeof verifier?.description).toBe('string')
    expect(typeof verifier?.systemPrompt).toBe('string')
    expect(verifier?.tools).toEqual(['read_file', 'run_command', 'pass_criterion', 'fail_criterion', 'web_fetch'])
  })

  it('should create verifier context with fresh data only', () => {
    const registry = createSubAgentRegistry()
    const verifier = registry.getSubAgent('verifier')!
    
    const mockSession: Session = {
      id: 'test-session',
      projectId: 'test-project',
      workdir: '/tmp/test',
      mode: 'builder',
      phase: 'build',
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
    }

    const context = verifier.createContext(mockSession, { prompt: 'Verify test' })
    
    // Verify context contains only fresh data, not conversation history
    expect(context.messages).toHaveLength(2) // context + prompt
    expect(context.messages[0]!.content).toContain('Test summary')
    expect(context.messages[0]!.content).toContain('Test criterion')
    expect(context.messages[0]!.content).toContain('src/test.ts')
    
    // Verify no conversation history is included
    expect(context.messages[0]!.content).not.toContain('conversation')
    expect(context.messages[0]!.content).not.toContain('history')
  })
})
