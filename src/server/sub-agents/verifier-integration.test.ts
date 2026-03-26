/**
 * Verifier Sub-Agent Integration Tests
 *
 * Tests that the verifier is properly defined in the agent registry
 * and that context building works correctly.
 */

import { describe, it, expect } from 'vitest'
import type { Session } from '../../shared/types.js'
import { loadBuiltinAgents, findAgentById } from '../agents/registry.js'
import { buildVerifierContextMessages } from './context-builders.js'

describe('Verifier Sub-Agent Integration', () => {
  it('should have verifier defined in agent registry', async () => {
    const agents = await loadBuiltinAgents()
    const verifier = findAgentById('verifier', agents)

    expect(verifier).toBeDefined()
    expect(verifier?.metadata.id).toBe('verifier')
    expect(verifier?.metadata.subagent).toBe(true)
    expect(verifier?.metadata.name).toBe('Verifier')
    expect(typeof verifier?.metadata.description).toBe('string')
    expect(typeof verifier?.prompt).toBe('string')
    expect(verifier?.metadata.tools).toEqual(['read_file', 'run_command', 'pass_criterion', 'fail_criterion', 'web_fetch'])
  })

  it('should create verifier context with fresh data only', async () => {
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

    const messages = buildVerifierContextMessages(mockSession, 'Verify test')

    expect(messages).toHaveLength(2)
    expect(messages[0]!.content).toContain('Test summary')
    expect(messages[0]!.content).toContain('Test criterion')
    expect(messages[0]!.content).toContain('src/test.ts')
    expect(messages[0]!.content).not.toContain('conversation')
    expect(messages[0]!.content).not.toContain('history')
  })
})
