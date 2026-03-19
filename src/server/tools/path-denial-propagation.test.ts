/**
 * Test that tools correctly re-throw PathAccessDeniedError
 * 
 * When a user denies access to a sensitive file, the error must propagate
 * to the orchestrator so it can return a helpful message like:
 * "User denied access to X. If you need this file, explain why and ask for permission."
 * 
 * If tools catch the error and convert it to a tool result, the orchestrator
 * never sees it and the LLM gets the raw PathAccessDeniedError.message instead.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PathAccessDeniedError } from './path-security.js'

// Mock requestPathAccess to throw PathAccessDeniedError
vi.mock('./path-security.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./path-security.js')>()
  return {
    ...actual,
    requestPathAccess: vi.fn().mockRejectedValue(
      new actual.PathAccessDeniedError(['/test/.env'], 'test_tool', 'sensitive_file')
    ),
  }
})

// Import tools AFTER mocking
import { readFileTool } from './read.js'
import { writeFileTool } from './write.js'
import { editFileTool } from './edit.js'
import { globTool } from './glob.js'
import { grepTool } from './grep.js'
import { runCommandTool } from './shell.js'

describe('PathAccessDeniedError propagation', () => {
  const mockOnEvent = vi.fn()
  
  // Mock sessionManager for test context
  const mockSessionManager = {
    recordFileRead: vi.fn(),
    getReadFiles: vi.fn().mockReturnValue({}),
    updateFileHash: vi.fn(),
  } as any
  
  // Context with onEvent to trigger path security checks
  const context = {
    sessionManager: mockSessionManager,
    sessionId: 'test-session',
    workdir: '/test',
    onEvent: mockOnEvent,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('read_file', () => {
    it('re-throws PathAccessDeniedError instead of catching it', async () => {
      // Currently FAILS: tool catches error and returns { success: false, error: message }
      // After fix: should throw PathAccessDeniedError
      await expect(
        readFileTool.execute({ path: '.env' }, context)
      ).rejects.toThrow(PathAccessDeniedError)
    })
  })

  describe('write_file', () => {
    it('re-throws PathAccessDeniedError instead of catching it', async () => {
      await expect(
        writeFileTool.execute({ path: '.env', content: 'test' }, context)
      ).rejects.toThrow(PathAccessDeniedError)
    })
  })

  describe('edit_file', () => {
    it('re-throws PathAccessDeniedError instead of catching it', async () => {
      await expect(
        editFileTool.execute({ path: '.env', old_string: 'a', new_string: 'b' }, context)
      ).rejects.toThrow(PathAccessDeniedError)
    })
  })

  describe('glob', () => {
    it('re-throws PathAccessDeniedError instead of catching it', async () => {
      await expect(
        globTool.execute({ pattern: '**/.env', path: '/outside' }, context)
      ).rejects.toThrow(PathAccessDeniedError)
    })
  })

  describe('grep', () => {
    it('re-throws PathAccessDeniedError instead of catching it', async () => {
      await expect(
        grepTool.execute({ pattern: 'secret', path: '/outside' }, context)
      ).rejects.toThrow(PathAccessDeniedError)
    })
  })

  describe('run_command', () => {
    it('re-throws PathAccessDeniedError instead of catching it', async () => {
      await expect(
        runCommandTool.execute({ command: 'cat .env' }, context)
      ).rejects.toThrow(PathAccessDeniedError)
    })
  })
})
