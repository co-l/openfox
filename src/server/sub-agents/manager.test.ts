/**
 * Sub-Agent Manager Tests
 */

import { describe, it, expect, vi } from 'vitest'
import { loadBuiltinAgents, findAgentById, getSubAgents } from '../agents/registry.js'
import { buildSubAgentContextMessages } from './context-builders.js'

describe('SubAgentManager', () => {
  it('should have verifier available in agent registry', async () => {
    const agents = await loadBuiltinAgents()
    const verifier = findAgentById('verifier', agents)

    expect(verifier).toBeDefined()
    expect(verifier!.metadata.subagent).toBe(true)
    expect(verifier!.metadata.tools).toContain('pass_criterion')
    expect(verifier!.metadata.tools).toContain('fail_criterion')
  })

  it('should build verifier context correctly', async () => {
    const session = {
      id: 'test-session',
      projectId: 'test-project',
      workdir: '/tmp/test',
      mode: 'builder' as const,
      phase: 'build' as const,
      isRunning: false,
      summary: 'Implement user authentication',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
      criteria: [
        {
          id: 'auth-login',
          description: 'User can login',
          status: { type: 'completed' as const, completedAt: new Date().toISOString() },
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
    }

    const context = buildSubAgentContextMessages('verifier', session, 'Verify criteria')

    expect(context).toHaveLength(2)
    expect(context[0]!.content).toContain('Implement user authentication')
  })

  it('should return undefined for unknown sub-agent type', async () => {
    const agents = await loadBuiltinAgents()
    const unknown = findAgentById('unknown_type', agents)

    expect(unknown).toBeUndefined()
  })

  it('should return correct tools for each sub-agent type', async () => {
    const agents = await loadBuiltinAgents()

    expect(findAgentById('verifier', agents)?.metadata.tools).toEqual([
      'read_file',
      'run_command',
      'pass_criterion',
      'fail_criterion',
      'web_fetch',
    ])

    expect(findAgentById('code_reviewer', agents)?.metadata.tools).toEqual([
      'read_file',
      'grep',
      'web_fetch',
    ])

    expect(findAgentById('test_generator', agents)?.metadata.tools).toEqual([
      'read_file',
      'write_file',
      'run_command',
      'web_fetch',
    ])

    expect(findAgentById('debugger', agents)?.metadata.tools).toEqual([
      'read_file',
      'run_command',
      'grep',
      'web_fetch',
    ])
  })
})
