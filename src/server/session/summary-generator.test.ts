import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { generateSessionSummary } from './summary-generator.js'
import type { LLMClientWithModel } from '../llm/client.js'

describe('generateSessionSummary', () => {
  const mockLLMClient = {
    complete: vi.fn(),
    getModel: () => 'qwen3-32b',
    getBackend: () => 'vllm',
  } as unknown as LLMClientWithModel

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('generates summary from conversation messages', async () => {
    ;(mockLLMClient.complete as any).mockResolvedValue({
      content: 'User wants to build a REST API with authentication.',
      toolCalls: [],
    })

    const messages = [
      { role: 'user' as const, content: 'I need to build a REST API' },
      { role: 'assistant' as const, content: 'Sure, what features do you need?' },
      { role: 'user' as const, content: 'Authentication and CRUD operations' },
    ]

    const result = await generateSessionSummary({
      messages,
      llmClient: mockLLMClient,
      workdir: '/test',
    })

    expect(result.success).toBe(true)
    expect(result.summary).toContain('REST API')
    expect(mockLLMClient.complete).toHaveBeenCalled()
  })

  it('returns failure when LLM call fails', async () => {
    ;(mockLLMClient.complete as any).mockRejectedValue(new Error('LLM error'))

    const messages = [
      { role: 'user' as const, content: 'Test message' },
    ]

    const result = await generateSessionSummary({
      messages,
      llmClient: mockLLMClient,
      workdir: '/test',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('returns failure when summary is too short', async () => {
    ;(mockLLMClient.complete as any).mockResolvedValue({
      content: 'a',
      toolCalls: [],
    })

    const messages = [
      { role: 'user' as const, content: 'Test message' },
    ]

    const result = await generateSessionSummary({
      messages,
      llmClient: mockLLMClient,
      workdir: '/test',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('too short')
  })

  it('truncates summary to 500 characters', async () => {
    const longText = 'x'.repeat(600)
    ;(mockLLMClient.complete as any).mockResolvedValue({
      content: longText,
      toolCalls: [],
    })

    const messages = [
      { role: 'user' as const, content: 'Test message' },
    ]

    const result = await generateSessionSummary({
      messages,
      llmClient: mockLLMClient,
      workdir: '/test',
    })

    expect(result.success).toBe(true)
    expect(result.summary?.length).toBeLessThanOrEqual(500)
  })
})
