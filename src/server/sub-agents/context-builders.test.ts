/**
 * Context Builder Tests
 */

import { describe, it, expect } from 'vitest'
import type { Session } from '../../shared/types.js'
import { createSubAgentRegistry } from './registry.js'

// Mock session factory
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
  
  // Apply partial values, allowing null to override default
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

describe('createVerifierContext', () => {
  it('should build fresh context with summary, criteria, and modified files', () => {
    const registry = createSubAgentRegistry()
    const verifier = registry.getSubAgent('verifier')
    
    expect(verifier).toBeDefined()
    
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
    
    const context = verifier!.createContext(session, { prompt: 'Verify login criteria' })
    
    // Verify context structure
    expect(context.systemPrompt).toContain('You are a code reviewer performing independent verification')
    expect(context.userMessage).toBe('Verify login criteria')
    expect(context.messages).toHaveLength(2)
    
    // Verify first message contains summary
    expect(context.messages[0].content).toContain('Implement user authentication')
    
    // Verify criteria are included with status markers
    expect(context.messages[0].content).toContain('[NEEDS VERIFICATION]')
    expect(context.messages[0].content).toContain('auth-login')
    expect(context.messages[0].content).toContain('auth-register')
    
    // Verify modified files are included
    expect(context.messages[0].content).toContain('src/auth.ts')
    expect(context.messages[0].content).toContain('src/user-service.ts')
    
    // Verify second message is the prompt
    expect(context.messages[1].content).toBe('Verify login criteria')
    
    // Verify tools array is empty (will be filled by tool registry)
    expect(context.tools).toEqual([])
    
    // Verify request options
    expect(context.requestOptions.toolChoice).toBe('auto')
    expect(context.requestOptions.disableThinking).toBe(true)
  })

  it('should handle empty modified files list', () => {
    const registry = createSubAgentRegistry()
    const verifier = registry.getSubAgent('verifier')
    
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
    
    const context = verifier!.createContext(session, { prompt: 'Test' })
    
    expect(context.messages[0].content).toContain('(none)')
  })

  it('should handle missing summary', () => {
    const registry = createSubAgentRegistry()
    const verifier = registry.getSubAgent('verifier')
    
    const session = createMockSession({
      summary: null,
      criteria: [],
    })
    
    const context = verifier!.createContext(session, { prompt: 'Test' })
    
    expect(context.messages[0].content).toContain('No summary available')
  })

  it('should mark criteria with correct status indicators', () => {
    const registry = createSubAgentRegistry()
    const verifier = registry.getSubAgent('verifier')
    
    const session = createMockSession({
      summary: 'Test',
      criteria: [
        {
          id: 'c1',
          description: 'Passed criterion',
          status: { type: 'passed', verifiedAt: new Date().toISOString() },
          attempts: [],
        },
        {
          id: 'c2',
          description: 'Failed criterion',
          status: { type: 'failed', reason: 'Not implemented', failedAt: new Date().toISOString() },
          attempts: [],
        },
        {
          id: 'c3',
          description: 'Completed criterion',
          status: { type: 'completed', completedAt: new Date().toISOString() },
          attempts: [],
        },
        {
          id: 'c4',
          description: 'Pending criterion',
          status: { type: 'pending' },
          attempts: [],
        },
      ],
    })
    
    const context = verifier!.createContext(session, { prompt: 'Test' })
    
    expect(context.messages[0].content).toContain('[PASSED]')
    expect(context.messages[0].content).toContain('[FAILED]')
    expect(context.messages[0].content).toContain('[NEEDS VERIFICATION]')
    expect(context.messages[0].content).toContain('[NOT COMPLETED]')
  })
})

describe('createCodeReviewerContext', () => {
  it('should build context with modified files and prompt', () => {
    const registry = createSubAgentRegistry()
    const codeReviewer = registry.getSubAgent('code_reviewer')
    
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
    
    const context = codeReviewer!.createContext(session, { prompt: 'Review for security issues' })
    
    expect(context.systemPrompt).toContain('You are a senior code reviewer')
    expect(context.messages[0].content).toContain('src/foo.ts')
    expect(context.messages[0].content).toContain('Review for security issues')
  })
})

describe('createTestGeneratorContext', () => {
  it('should build context with prompt', () => {
    const registry = createSubAgentRegistry()
    const testGenerator = registry.getSubAgent('test_generator')
    
    const session = createMockSession()
    
    const context = testGenerator!.createContext(session, { prompt: 'Generate tests for auth module' })
    
    expect(context.systemPrompt).toContain('You are a test generation specialist')
    expect(context.messages[0].content).toContain('Generate tests for auth module')
  })
})

describe('createDebuggerContext', () => {
  it('should build context with prompt', () => {
    const registry = createSubAgentRegistry()
    const debuggerAgent = registry.getSubAgent('debugger')
    
    const session = createMockSession()
    
    const context = debuggerAgent!.createContext(session, { prompt: 'Fix null pointer exception' })
    
    expect(context.systemPrompt).toContain('You are an expert debugger')
    expect(context.messages[0].content).toContain('Fix null pointer exception')
  })
})
