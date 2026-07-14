/**
 * Session Name Generator Tests
 *
 * TDD: Write failing tests first, then implement to make them pass.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  generateSessionName,
  needsNameGeneration,
  generateSessionNameForSession,
  SESSION_NAME_PROMPT,
} from './name-generator.js'
import type { LLMCompletionResponse } from '../llm/types.js'
import type { Session } from '../../shared/types.js'

vi.mock('../runtime-config.js', () => ({
  getRuntimeConfig: vi.fn(),
}))

vi.mock('../utils/session-utils.js', () => ({
  getSessionMessageCount: vi.fn(() => 1),
}))

describe('Session Name Generator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('generateSessionName', () => {
    it('should generate a descriptive name from the user message', async () => {
      // Create mock LLM client
      const mockResponse: LLMCompletionResponse = {
        id: 'test-id',
        content: 'React project setup',
        finishReason: 'stop',
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
      }

      const mockClient = {
        complete: vi.fn().mockResolvedValue(mockResponse),
        getModel: vi.fn().mockReturnValue('test-model'),
        setModel: vi.fn(),
        getProfile: vi.fn(),
        getBackend: vi.fn().mockReturnValue('unknown'),
        setBackend: vi.fn(),
      }

      // Execute
      const result = await generateSessionName({
        userMessage: 'How do I set up a React project?',
        llmClient: mockClient as any,
      })

      // Assert
      expect(result.success).toBe(true)
      expect(result.name).toBe('React project setup')
      expect(result.error).toBeUndefined()
    })

    it('should truncate names longer than 50 characters', async () => {
      const longName = 'A very long session name that definitely exceeds the fifty character limit for session titles'
      const mockResponse: LLMCompletionResponse = {
        id: 'test-id',
        content: longName,
        finishReason: 'stop',
        usage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
        },
      }

      const mockClient = {
        complete: vi.fn().mockResolvedValue(mockResponse),
        getModel: vi.fn().mockReturnValue('test-model'),
        setModel: vi.fn(),
        getProfile: vi.fn(),
        getBackend: vi.fn().mockReturnValue('unknown'),
        setBackend: vi.fn(),
      }

      const result = await generateSessionName({
        userMessage: 'Some question',
        llmClient: mockClient as any,
      })

      expect(result.success).toBe(true)
      expect(result.name?.length).toBeLessThanOrEqual(50)
      expect(result.name?.endsWith('...')).toBe(true)
    })

    it('should return failure for empty or too short names', async () => {
      const mockResponse: LLMCompletionResponse = {
        id: 'test-id',
        content: 'x',
        finishReason: 'stop',
        usage: {
          promptTokens: 10,
          completionTokens: 1,
          totalTokens: 11,
        },
      }

      const mockClient = {
        complete: vi.fn().mockResolvedValue(mockResponse),
        getModel: vi.fn().mockReturnValue('test-model'),
        setModel: vi.fn(),
        getProfile: vi.fn(),
        getBackend: vi.fn().mockReturnValue('unknown'),
        setBackend: vi.fn(),
      }

      const result = await generateSessionName({
        userMessage: 'Test message',
        llmClient: mockClient as any,
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('too short')
    })

    it('should handle LLM errors gracefully', async () => {
      const mockClient = {
        complete: vi.fn().mockRejectedValue(new Error('LLM connection failed')),
        getModel: vi.fn().mockReturnValue('test-model'),
        setModel: vi.fn(),
        getProfile: vi.fn(),
        getBackend: vi.fn().mockReturnValue('unknown'),
        setBackend: vi.fn(),
      }

      const result = await generateSessionName({
        userMessage: 'Test message',
        llmClient: mockClient as any,
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('LLM connection failed')
    })

    it('should use the provided LLM client', async () => {
      const mockResponse: LLMCompletionResponse = {
        id: 'test-id',
        content: 'Test name',
        finishReason: 'stop',
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
      }

      const mockClient = {
        complete: vi.fn().mockResolvedValue(mockResponse),
        getModel: vi.fn().mockReturnValue('custom-model'),
        setModel: vi.fn(),
        getProfile: vi.fn(),
        getBackend: vi.fn().mockReturnValue('custom-backend'),
        setBackend: vi.fn(),
      }

      await generateSessionName({
        userMessage: 'Test message',
        llmClient: mockClient as any,
      })

      // Verify the mock client's complete method was called
      expect(mockClient.complete).toHaveBeenCalled()
      const callArgs = (mockClient.complete as any).mock.calls[0][0]
      expect(callArgs.messages).toBeDefined()
      expect(callArgs.messages[0].role).toBe('user')
    })
  })

  describe('needsNameGeneration', () => {
    it('should return true when session has no title', () => {
      expect(needsNameGeneration(null, 1)).toBe(true)
      expect(needsNameGeneration('', 1)).toBe(true)
      expect(needsNameGeneration(undefined, 1)).toBe(true)
    })

    it('should return true for default session titles', () => {
      expect(needsNameGeneration('Session 1', 1)).toBe(true)
      expect(needsNameGeneration('Session 42', 1)).toBe(true)
      expect(needsNameGeneration('Session 100', 1)).toBe(true)
    })

    it('should return false for custom titles', () => {
      expect(needsNameGeneration('My custom session', 1)).toBe(false)
      expect(needsNameGeneration('React project setup', 1)).toBe(false)
    })

    it('should return false if more than one message has been sent', () => {
      expect(needsNameGeneration(null, 2)).toBe(false)
      expect(needsNameGeneration('Session 1', 5)).toBe(false)
    })

    it('should return true for first message with default title', () => {
      expect(needsNameGeneration('Session 1', 1)).toBe(true)
    })
  })

  describe('model settings forwarding', () => {
    function createMockClient(response: LLMCompletionResponse) {
      return {
        complete: vi.fn().mockResolvedValue(response),
        getModel: vi.fn().mockReturnValue('test-model'),
        setModel: vi.fn(),
        getProfile: vi.fn(),
        getBackend: vi.fn().mockReturnValue('unknown'),
        setBackend: vi.fn(),
      }
    }

    const defaultResponse: LLMCompletionResponse = {
      id: 'test-id',
      content: 'React setup',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    }

    it('should not pass reasoningEffort by default', async () => {
      const mockClient = createMockClient(defaultResponse)

      await generateSessionName({
        userMessage: 'How do I set up React?',
        llmClient: mockClient as any,
      })

      const callArgs = (mockClient.complete as any).mock.calls[0][0]
      expect(callArgs.reasoningEffort).toBeUndefined()
    })

    it('should pass modelSettings to the LLM client', async () => {
      const mockClient = createMockClient(defaultResponse)
      const modelSettings = {
        temperature: 0.7,
        chatTemplateKwargs: { enable_thinking: false },
      }

      await generateSessionName({
        userMessage: 'How do I set up React?',
        llmClient: mockClient as any,
        modelSettings,
      })

      const callArgs = (mockClient.complete as any).mock.calls[0][0]
      expect(callArgs.modelSettings).toEqual(modelSettings)
    })

    it('should pass queryParams in modelSettings', async () => {
      const mockClient = createMockClient(defaultResponse)
      const modelSettings = {
        queryParams: { disable_thinking: true },
      }

      await generateSessionName({
        userMessage: 'How do I set up React?',
        llmClient: mockClient as any,
        modelSettings,
      })

      const callArgs = (mockClient.complete as any).mock.calls[0][0]
      expect(callArgs.modelSettings).toEqual(modelSettings)
    })

    it('should fall back to thinkingContent when content is empty', async () => {
      const mockClient = createMockClient({
        ...defaultResponse,
        content: '',
        thinkingContent: 'React project setup',
      })

      const result = await generateSessionName({
        userMessage: 'How do I set up React?',
        llmClient: mockClient as any,
      })

      expect(result.success).toBe(true)
      expect(result.name).toBe('React project setup')
    })

    it('should fall back to thinkingContent when content is null-like', async () => {
      const mockClient = createMockClient({
        ...defaultResponse,
        content: '',
        thinkingContent: 'Fix auth bug',
      })

      const result = await generateSessionName({
        userMessage: 'Fix the authentication bug',
        llmClient: mockClient as any,
      })

      expect(result.success).toBe(true)
      expect(result.name).toBe('Fix auth bug')
    })

    it('should return failure when both content and thinkingContent are empty', async () => {
      const mockClient = createMockClient({
        ...defaultResponse,
        content: '',
      })

      const result = await generateSessionName({
        userMessage: 'Test message',
        llmClient: mockClient as any,
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('too short')
    })
  })

  describe('generateSessionNameForSession', () => {
    it('should skip name generation when disableAutoSessionTitle is true', async () => {
      const { getRuntimeConfig } = await import('../runtime-config.js')
      ;(getRuntimeConfig as any).mockReturnValue({ disableAutoSessionTitle: true })

      const sessionManager = {
        getSession: vi.fn().mockReturnValue({ id: 'test', metadata: { title: null } } as unknown as Session),
      }
      const providerManager = {
        getProviders: vi.fn().mockReturnValue([]),
        getCurrentModel: vi.fn().mockReturnValue(null),
      }
      const broadcastForSession = vi.fn()
      const eventStore = { getEvents: vi.fn().mockReturnValue([]), append: vi.fn() }

      await generateSessionNameForSession('test-session', 'Hello world', {
        sessionManager: sessionManager as any,
        providerManager: providerManager as any,
        broadcastForSession,
        eventStore: eventStore as any,
      })

      expect(broadcastForSession).not.toHaveBeenCalled()
      expect(eventStore.append).not.toHaveBeenCalled()
    })

    it('uses the session provider client instead of mutating the active provider client', async () => {
      const { getRuntimeConfig } = await import('../runtime-config.js')
      ;(getRuntimeConfig as any).mockReturnValue({ disableAutoSessionTitle: false })

      const session = {
        id: 'test-session',
        providerId: 'lm-studio',
        providerModel: 'google/gemma-4-12b-qat',
        metadata: { title: 'Session 1' },
      } as unknown as Session
      const activeClient = {
        complete: vi.fn(),
        setModel: vi.fn(),
      }
      const sessionClient = {
        complete: vi.fn().mockResolvedValue({
          id: 'test-id',
          content: '',
          finishReason: 'stop',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        }),
      }
      const getLLMClientForProvider = vi.fn().mockReturnValue(sessionClient)
      const sessionManager = { getSession: vi.fn().mockReturnValue(session) }
      const providerManager = {
        getProviders: vi.fn().mockReturnValue([
          {
            id: 'lm-studio',
            url: 'http://localhost:1234/v1',
            models: [{ id: 'google/gemma-4-12b-qat' }],
          },
        ]),
        getCurrentModel: vi.fn().mockReturnValue('gpt-5.6'),
        getModelSettings: vi.fn().mockReturnValue(undefined),
      }

      await generateSessionNameForSession('test-session', 'Hello world', {
        sessionManager: sessionManager as any,
        providerManager: providerManager as any,
        broadcastForSession: vi.fn(),
        eventStore: { getEvents: vi.fn().mockReturnValue([]), append: vi.fn() } as any,
        getLLMClient: () => activeClient as any,
        getLLMClientForProvider,
      })

      expect(getLLMClientForProvider).toHaveBeenCalledWith('lm-studio', 'google/gemma-4-12b-qat')
      expect(sessionClient.complete).toHaveBeenCalledOnce()
      expect(activeClient.setModel).not.toHaveBeenCalled()
      expect(activeClient.complete).not.toHaveBeenCalled()
    })
  })

  describe('SESSION_NAME_PROMPT', () => {
    it('should be ultra-lightweight with no project context', () => {
      // Verify the prompt is minimal and doesn't contain project-related keywords
      // Note: We check the actual prompt content, not comments
      expect(SESSION_NAME_PROMPT).not.toContain('project_id')
      expect(SESSION_NAME_PROMPT).not.toContain('workdir')
      expect(SESSION_NAME_PROMPT).not.toContain('project context')
      expect(SESSION_NAME_PROMPT).not.toContain('system instructions')

      // Should contain name generation instructions
      expect(SESSION_NAME_PROMPT).toContain('Generate')
      expect(SESSION_NAME_PROMPT).toContain('session name')
      expect(SESSION_NAME_PROMPT).toContain('50 characters')
    })
  })
})
