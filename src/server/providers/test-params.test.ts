import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LlmBackend } from '../../shared/types.js'

const mockCreateChatCompletion = vi.fn()

vi.mock('../llm/http-client.js', () => ({
  OpenAIHttpClient: class MockOpenAIHttpClient {
    constructor(_config: { baseURL: string; apiKey: string }) {}
    createChatCompletion = mockCreateChatCompletion
    createChatCompletionStream = vi.fn()
  },
}))

function testConfig() {
  return {
    llm: {
      baseUrl: 'http://localhost:8000',
      model: 'test-model',
      timeout: 300000,
      idleTimeout: 300000,
      backend: 'vllm' as LlmBackend,
    },
    context: { maxTokens: 200000, compactionThreshold: 0.85, },
    agent: { maxIterations: 10, maxConsecutiveFailures: 3, toolTimeout: 300000 },
    server: { port: 0, host: '127.0.0.1' },
    database: { path: ':memory:' },
    mode: 'test' as const,
    workdir: '/tmp',
  }
}

describe('POST /api/providers/test-params', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function createServer() {
    const { createServerHandle } = await import('../index.js')
    return createServerHandle(testConfig())
  }

  it('should build params using the same pipeline as the agentic loop for thinking mode', async () => {
    mockCreateChatCompletion.mockResolvedValue({
      id: 'test-id',
      choices: [{ message: { content: 'Hi', role: 'assistant' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      raw: JSON.stringify({ id: 'test-id', choices: [{ message: { content: 'Hi' } }] }),
    })

    const handle = await createServer()
    const { port } = await handle.start(0)

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/providers/test-params`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'http://localhost:8000',
          model: 'test-model',
          backend: 'vllm',
          mode: 'thinking',
          modelConfig: {
            thinkingEnabled: true,
            thinkingLevel: 'high',
            thinkingQueryParams: JSON.stringify({ reasoning_effort: 'high' }),
          },
        }),
      })

      expect(response.ok).toBe(true)
      const data: any = await response.json()
      expect(data.success).toBe(true)
      expect(data.message).toBeDefined()
      expect(data.raw).toBeDefined()

      // Verify the params passed to createChatCompletion include reasoning_effort
      const params = mockCreateChatCompletion.mock.calls[0]![0] as Record<string, unknown>
      expect(params['reasoning_effort']).toBe('high')
    } finally {
      await handle.close()
    }
  })

  it('should build params for non-thinking mode with chatTemplateKwargs', async () => {
    mockCreateChatCompletion.mockResolvedValue({
      id: 'test-id',
      choices: [{ message: { content: 'Hi', role: 'assistant' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      raw: JSON.stringify({ id: 'test-id', choices: [{ message: { content: 'Hi' } }] }),
    })

    const handle = await createServer()
    const { port } = await handle.start(0)

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/providers/test-params`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'http://localhost:8000',
          model: 'test-model',
          backend: 'vllm',
          mode: 'non-thinking',
          modelConfig: {
            nonThinkingEnabled: true,
            nonThinkingQueryParams: JSON.stringify({ reasoning_effort: 'none' }),
          },
        }),
      })

      expect(response.ok).toBe(true)
      const data: any = await response.json()
      expect(data.success).toBe(true)
    } finally {
      await handle.close()
    }
  })

  it('should return 400 for missing required fields', async () => {
    const handle = await createServer()
    const { port } = await handle.start(0)

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/providers/test-params`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://localhost:8000' }),
      })

      expect(response.ok).toBe(false)
      expect(response.status).toBe(400)
    } finally {
      await handle.close()
    }
  })

  it('should handle API errors gracefully', async () => {
    mockCreateChatCompletion.mockRejectedValue(new Error('Connection refused'))

    const handle = await createServer()
    const { port } = await handle.start(0)

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/providers/test-params`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'http://localhost:9999',
          model: 'test-model',
          backend: 'vllm',
          mode: 'thinking',
        }),
      })

      expect(response.ok).toBe(false)
      expect(response.status).toBe(400)
      const data: any = await response.json()
      expect(data.error).toBeDefined()
    } finally {
      await handle.close()
    }
  })
})
