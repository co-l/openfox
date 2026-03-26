/**
 * Context Builder Tests
 */

import { describe, it, expect } from 'vitest'
import type { Session } from '../../shared/types.js'
import {
  buildVerifierContextMessages,
  buildCodeReviewerContextMessages,
  buildSimpleContextMessages,
  buildSubAgentContextMessages,
} from './context-builders.js'

function createMockSession(partial?: Partial<Session>): Session {
  const session: Session = {
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
    criteria: [],
    contextWindows: [],
    executionState: null,
    metadata: {
      totalTokensUsed: 0,
      totalToolCalls: 0,
      iterationCount: 0,
    },
  }

  if (partial?.summary !== undefined) {
    session.summary = partial.summary as string | null
  }
  if (partial?.criteria !== undefined) {
    session.criteria = partial.criteria
  }
  if (partial?.executionState !== undefined) {
    session.executionState = partial.executionState
  }

  return session
}

describe('buildVerifierContextMessages', () => {
  it('should build context with summary, criteria, and modified files', () => {
    const session = createMockSession({
      summary: 'Implement user authentication',
      criteria: [
        {
          id: 'auth-login',
          description: 'User can login with credentials',
          status: { type: 'completed', completedAt: new Date().toISOString() },
          attempts: [],
        },
        {
          id: 'auth-register',
          description: 'User can register new account',
          status: { type: 'pending' },
          attempts: [],
        },
      ],
      executionState: {
        iteration: 1,
        modifiedFiles: ['src/auth.ts', 'src/user-service.ts'],
        readFiles: {},
        consecutiveFailures: 0,
        currentTokenCount: 1000,
        messageCountAtLastUpdate: 10,
        compactionCount: 0,
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
      },
    })

    const messages = buildVerifierContextMessages(session, 'Verify login criteria')

    expect(messages).toHaveLength(2)
    expect(messages[0]!.content).toContain('Implement user authentication')
    expect(messages[0]!.content).toContain('[NEEDS VERIFICATION]')
    expect(messages[0]!.content).toContain('auth-login')
    expect(messages[0]!.content).toContain('auth-register')
    expect(messages[0]!.content).toContain('src/auth.ts')
    expect(messages[0]!.content).toContain('src/user-service.ts')
    expect(messages[1]!.content).toBe('Verify login criteria')
  })

  it('should handle empty modified files list', () => {
    const session = createMockSession({
      summary: 'Test summary',
      criteria: [],
      executionState: {
        iteration: 1,
        modifiedFiles: [],
        readFiles: {},
        consecutiveFailures: 0,
        currentTokenCount: 100,
        messageCountAtLastUpdate: 5,
        compactionCount: 0,
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
      },
    })

    const messages = buildVerifierContextMessages(session, 'Test')
    expect(messages[0]!.content).toContain('(none)')
  })

  it('should handle missing summary', () => {
    const session = createMockSession({
      summary: null,
      criteria: [],
    })

    const messages = buildVerifierContextMessages(session, 'Test')
    expect(messages[0]!.content).toContain('No summary available')
  })

  it('should mark criteria with correct status indicators', () => {
    const session = createMockSession({
      summary: 'Test',
      criteria: [
        { id: 'c1', description: 'Passed criterion', status: { type: 'passed', verifiedAt: new Date().toISOString() }, attempts: [] },
        { id: 'c2', description: 'Failed criterion', status: { type: 'failed', reason: 'Not implemented', failedAt: new Date().toISOString() }, attempts: [] },
        { id: 'c3', description: 'Completed criterion', status: { type: 'completed', completedAt: new Date().toISOString() }, attempts: [] },
        { id: 'c4', description: 'Pending criterion', status: { type: 'pending' }, attempts: [] },
      ],
    })

    const messages = buildVerifierContextMessages(session, 'Test')
    expect(messages[0]!.content).toContain('[PASSED]')
    expect(messages[0]!.content).toContain('[FAILED]')
    expect(messages[0]!.content).toContain('[NEEDS VERIFICATION]')
    expect(messages[0]!.content).toContain('[NOT COMPLETED]')
  })
})

describe('buildCodeReviewerContextMessages', () => {
  it('should build context with modified files and prompt', () => {
    const session = createMockSession({
      executionState: {
        iteration: 1,
        modifiedFiles: ['src/foo.ts', 'src/bar.ts'],
        readFiles: {},
        consecutiveFailures: 0,
        currentTokenCount: 100,
        messageCountAtLastUpdate: 5,
        compactionCount: 0,
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
      },
    })

    const messages = buildCodeReviewerContextMessages(session, 'Review for security issues')
    expect(messages[0]!.content).toContain('src/foo.ts')
    expect(messages[0]!.content).toContain('Review for security issues')
  })
})

describe('buildSimpleContextMessages', () => {
  it('should build context with prompt', () => {
    const messages = buildSimpleContextMessages('Generate tests for auth module')
    expect(messages[0]!.content).toContain('Generate tests for auth module')
  })
})

describe('buildSubAgentContextMessages', () => {
  it('should route to verifier context builder', () => {
    const session = createMockSession({ summary: 'Test task' })
    const messages = buildSubAgentContextMessages('verifier', session, 'Verify')
    expect(messages).toHaveLength(2)
    expect(messages[0]!.content).toContain('Test task')
  })

  it('should route to code reviewer context builder', () => {
    const session = createMockSession({
      executionState: {
        iteration: 1,
        modifiedFiles: ['src/foo.ts'],
        readFiles: {},
        consecutiveFailures: 0,
        currentTokenCount: 100,
        messageCountAtLastUpdate: 5,
        compactionCount: 0,
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
      },
    })
    const messages = buildSubAgentContextMessages('code_reviewer', session, 'Review')
    expect(messages[0]!.content).toContain('src/foo.ts')
  })

  it('should use simple context for unknown agent types', () => {
    const session = createMockSession()
    const messages = buildSubAgentContextMessages('custom_agent', session, 'Do something')
    expect(messages[0]!.content).toContain('Do something')
  })
})
