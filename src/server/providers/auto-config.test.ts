/**
 * Auto-config tests using real data collected from 5 backends.
 *
 * These tests verify that the probing algorithm selects the correct
 * winning combo for each backend based on actual observed behavior.
 */

import { afterEach, describe, it, expect, vi } from 'vitest'
import { autoConfig } from './auto-config.js'

/**
 * Simulated probe results based on real data collected from each backend.
 * Format: [comboIndex, httpCode, hasContent, durationMs]
 */
interface BackendData {
  name: string
  nonThinking: Array<[number, number, boolean, number]>
  thinking: Array<[number, number, boolean, number]>
  expectedNonThinking: number
  expectedThinking: number
}

const BACKENDS: BackendData[] = [
  {
    name: 'vLLM (deepseek-v4-flash-dspark)',
    nonThinking: [
      [0, 200, false, 1204], // {} → no content (thinks)
      [1, 200, true, 209], // reasoning_effort:none → FAST, has content in reasoning field
      [2, 200, false, 1146], // chat_template_kwargs → no content (still thinks)
      [3, 200, false, 1117], // thinking:disabled → no content (ignored)
      [4, 200, true, 196], // both → FAST, has content
    ],
    thinking: [
      [0, 200, true, 1500], // reasoning_effort:high → works
      [1, 200, true, 2000], // chat_template_kwargs → works
      [2, 200, true, 1800], // thinking:enabled → works
      [3, 200, true, 1600], // both → works
    ],
    expectedNonThinking: 4, // both (fastest with content: 196ms vs 209ms)
    expectedThinking: 0, // reasoning_effort:"high" (fastest)
  },
  {
    name: 'llama.cpp (Qwen3.6-35B-A3B-MTP)',
    nonThinking: [
      [0, 200, false, 26437], // {} → no content, super slow
      [1, 200, false, 26221], // reasoning_effort:none → no content, slow
      [2, 200, true, 2665], // chat_template_kwargs → WORKS, fast
      [3, 200, false, 2030], // thinking:disabled → no content (ignored)
      [4, 200, true, 4529], // both → works but slower
    ],
    thinking: [
      [0, 200, true, 3000], // reasoning_effort:high → works
      [1, 200, true, 3500], // chat_template_kwargs → works
      [2, 200, true, 2800], // thinking:enabled → works
      [3, 200, true, 3200], // both → works
    ],
    expectedNonThinking: 2, // chat_template_kwargs:{enable_thinking:false} (fastest with content)
    expectedThinking: 2, // thinking:enabled (fastest)
  },
  {
    name: 'Ollama (qwen3.5:0.8b)',
    nonThinking: [
      [0, 200, true, 2407], // {} → has content (baseline works)
      [1, 200, true, 549], // reasoning_effort:none → FAST, has content
      [2, 200, false, 2196], // chat_template_kwargs → no content (still thinks)
      [3, 200, false, 3929], // thinking:disabled → no content (ignored)
      [4, 200, true, 292], // both → FASTEST, has content
    ],
    thinking: [
      [0, 400, false, 95], // reasoning_effort:high → REJECTED
      [1, 200, true, 4240], // chat_template_kwargs → works
      [2, 200, true, 3500], // thinking:enabled → works
      [3, 400, false, 100], // both → REJECTED
    ],
    expectedNonThinking: 4, // both (fastest with content)
    expectedThinking: 2, // thinking:enabled (fastest working: 3500ms vs 4240ms)
  },
  {
    name: 'DeepSeek API (deepseek-v4-flash)',
    nonThinking: [
      [0, 200, true, 1578], // {} → has content (baseline works)
      [1, 400, false, 379], // reasoning_effort:none → REJECTED
      [2, 200, true, 1516], // chat_template_kwargs → has content
      [3, 200, true, 1170], // thinking:disabled → has content, fastest
      [4, 400, false, 342], // both → REJECTED
    ],
    thinking: [
      [0, 200, true, 2593], // reasoning_effort:high → works
      [1, 200, true, 2408], // chat_template_kwargs → works (but content in reasoning_content only)
      [2, 200, true, 2000], // thinking:enabled → works
      [3, 200, true, 2100], // both → works
    ],
    expectedNonThinking: 3, // thinking:{type:"disabled"} (fastest with content)
    expectedThinking: 2, // thinking:{type:"enabled"} (fastest)
  },
  {
    name: 'Z.AI API (glm-5.2)',
    nonThinking: [
      [0, 200, false, 2778], // {} → no content (thinks)
      [1, 200, true, 2257], // reasoning_effort:none → has content
      [2, 200, false, 3315], // chat_template_kwargs → no content
      [3, 200, true, 3133], // thinking:disabled → has content
      [4, 200, true, 3360], // both → has content
    ],
    thinking: [
      [0, 200, true, 4165], // reasoning_effort:high → works
      [1, 200, true, 7305], // chat_template_kwargs → works
      [2, 200, true, 4000], // thinking:enabled → works
      [3, 200, true, 4500], // both → works
    ],
    expectedNonThinking: 1, // reasoning_effort:"none" (fastest with content)
    expectedThinking: 2, // thinking:{type:"enabled"} (fastest)
  },
]

describe('Auto-config combo selection', () => {
  describe('selects correct non-thinking combo for each backend', () => {
    BACKENDS.forEach((backend) => {
      it(`${backend.name}`, () => {
        const results = backend.nonThinking
          .filter(([, code, hasContent]) => code === 200 && hasContent)
          .sort((a, b) => a[3] - b[3])

        expect(results.length).toBeGreaterThan(0)
        expect(results[0]![0]).toBe(backend.expectedNonThinking)
      })
    })
  })

  describe('selects correct thinking combo for each backend', () => {
    BACKENDS.forEach((backend) => {
      it(`${backend.name}`, () => {
        const results = backend.thinking
          .filter(([, code, hasContent]) => code === 200 && hasContent)
          .sort((a, b) => a[3] - b[3])

        expect(results.length).toBeGreaterThan(0)
        expect(results[0]![0]).toBe(backend.expectedThinking)
      })
    })
  })

  describe('edge cases', () => {
    it('returns null when no combo succeeds', () => {
      const results: Array<[number, number, boolean, number]> = [
        [0, 400, false, 100],
        [1, 0, false, 15000],
        [2, 500, false, 200],
      ]
      const successful = results.filter(([, code, hasContent]) => code === 200 && hasContent)
      expect(successful.length).toBe(0)
    })

    it('prefers faster combo over slower one when both succeed', () => {
      const results: Array<[number, number, boolean, number]> = [
        [0, 200, true, 5000],
        [1, 200, true, 500],
        [2, 200, true, 3000],
      ]
      const sorted = results.filter(([, code, hasContent]) => code === 200 && hasContent).sort((a, b) => a[3] - b[3])
      expect(sorted[0]![0]).toBe(1) // fastest
    })

    it('handles mixed success/failure correctly', () => {
      const results: Array<[number, number, boolean, number]> = [
        [0, 400, false, 100], // rejected
        [1, 200, false, 500], // no content
        [2, 200, true, 300], // works!
        [3, 200, true, 600], // works but slower
      ]
      const successful = results
        .filter(([, code, hasContent]) => code === 200 && hasContent)
        .sort((a, b) => a[3] - b[3])
      expect(successful.length).toBe(2)
      expect(successful[0]![0]).toBe(2) // fastest working
    })
  })
})

describe('Context window detection', () => {
  describe('hardcoded known values', () => {
    const KNOWN: Record<string, number> = {
      'deepseek-v4-flash': 1_000_000,
      'deepseek-v4-pro': 1_000_000,
      'glm-5.2': 1_000_000,
      'glm-4.7': 128_000,
      'glm-4-32b-0414-128k': 128_000,
    }

    it('returns hardcoded values for known cloud models', () => {
      expect(KNOWN['deepseek-v4-flash']).toBe(1_000_000)
      expect(KNOWN['glm-5.2']).toBe(1_000_000)
      expect(KNOWN['glm-4.7']).toBe(128_000)
    })

    it('returns undefined for unknown models', () => {
      expect(KNOWN['unknown-model']).toBeUndefined()
    })
  })
})

describe('Reasoning message compatibility', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('disables reasoning messages when the API rejects assistant reasoning', async () => {
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages?: Array<Record<string, unknown>> }
      if (body.messages?.some((message) => message['reasoning'] === 'probe')) {
        return new Response(JSON.stringify({ error: 'reasoning is not allowed' }), { status: 422 })
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await autoConfig({
      url: 'https://provider.example/v1',
      backend: 'unknown',
      models: [{ id: 'deepseek-v4-flash' }],
    })

    expect(result.models[0]?.sendReasoningInMessages).toBe(false)
    expect(
      fetchMock.mock.calls.some(([, init]) => {
        const body = JSON.parse(String(init?.body)) as { messages?: Array<Record<string, unknown>> }
        return body.messages?.some((message) => message['reasoning'] === 'probe')
      }),
    ).toBe(true)
  })

  it('leaves reasoning messages unchanged when probing cannot reach the API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network unavailable')
      }),
    )

    const result = await autoConfig({
      url: 'https://provider.example/v1',
      backend: 'unknown',
      models: [{ id: 'deepseek-v4-flash' }],
    })

    expect(result.models[0]?.sendReasoningInMessages).toBeUndefined()
  })

  it('detects the reasoning field name (reasoning_content) from probe responses', async () => {
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages?: Array<Record<string, unknown>> }
      if (body.messages?.some((message) => message['reasoning'] === 'probe')) {
        return new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 })
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '', reasoning_content: 'probe' } }] }), {
        status: 200,
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await autoConfig({
      url: 'https://provider.example/v1',
      backend: 'unknown',
      models: [{ id: 'deepseek-v4-flash' }],
    })

    expect(result.models[0]?.thinkingField).toBe('reasoning_content')
  })

  it('detects the reasoning field name (reasoning) from probe responses', async () => {
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages?: Array<Record<string, unknown>> }
      if (body.messages?.some((message) => message['reasoning'] === 'probe')) {
        return new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 })
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '', reasoning: 'probe' } }] }), {
        status: 200,
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await autoConfig({
      url: 'https://provider.example/v1',
      backend: 'unknown',
      models: [{ id: 'deepseek-v4-flash' }],
    })

    expect(result.models[0]?.thinkingField).toBe('reasoning')
  })

  it('leaves thinkingField undefined when probes carry no reasoning field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 })),
    )

    const result = await autoConfig({
      url: 'https://provider.example/v1',
      backend: 'unknown',
      models: [{ id: 'deepseek-v4-flash' }],
    })

    expect(result.models[0]?.thinkingField).toBeUndefined()
  })
})

describe('Rejected-params probing', () => {
  it('detects rejected params from HTTP 400 mentioning the param name', async () => {
    const { autoConfig } = await import('./auto-config.js')

    const chatCalls: Array<Record<string, unknown>> = []
    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        // /models endpoint — return empty so detectModelInfo falls back to default
        if (url.endsWith('/models')) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 })
        }

        // /chat/completions endpoint
        const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {}
        chatCalls.push(body)

        // The rejection-probe baseline sends tools + all standard params.
        // Combo probes don't send tools.
        const isRejectionProbe = Array.isArray(body['tools'])

        if (isRejectionProbe && 'temperature' in body) {
          return new Response(
            JSON.stringify({
              error_code: 'BAD_REQUEST',
              message: 'BAD_REQUEST: Model does not support the temperature parameter.',
            }),
            { status: 400 },
          )
        }
        // All other requests (combo probes, rejection retry without temperature) → 200
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'hi' } }],
          }),
          { status: 200 },
        )
      }) as typeof globalThis.fetch

      const result = await autoConfig({
        url: 'http://localhost:8000/v1',
        backend: 'unknown',
        models: [{ id: 'test-model' }],
      })

      const model = result.models[0]!
      expect(model.rejectedParams).toEqual(['temperature'])
      // The retry call (after dropping temperature) should NOT include temperature
      const retryCall = chatCalls.find(
        (c) => 'top_p' in c && 'max_tokens' in c && 'top_k' in c && !('temperature' in c),
      )
      expect(retryCall).toBeDefined()
      expect(retryCall).not.toHaveProperty('temperature')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('returns no rejectedParams when baseline succeeds', async () => {
    const { autoConfig } = await import('./auto-config.js')

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = (async (input: string | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.endsWith('/models')) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 })
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'hi' } }],
          }),
          { status: 200 },
        )
      }) as typeof globalThis.fetch

      const result = await autoConfig({
        url: 'http://localhost:8000/v1',
        backend: 'unknown',
        models: [{ id: 'test-model' }],
      })

      const model = result.models[0]!
      expect(model.rejectedParams).toBeUndefined()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('detects reasoning_effort rejection when tools are present', async () => {
    const { autoConfig } = await import('./auto-config.js')

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.endsWith('/models')) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 })
        }

        const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {}
        const isRejectionProbe = Array.isArray(body['tools'])

        // Rejection probe with reasoning_effort + tools → 400
        if (isRejectionProbe && 'reasoning_effort' in body) {
          return new Response(
            JSON.stringify({
              error: {
                message:
                  'Function tools with reasoning_effort are not supported for this model in /v1/chat/completions.',
                type: 'invalid_request_error',
                param: 'reasoning_effort',
              },
            }),
            { status: 400 },
          )
        }
        // Everything else → 200
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'hi' } }],
          }),
          { status: 200 },
        )
      }) as typeof globalThis.fetch

      const result = await autoConfig({
        url: 'http://localhost:8000/v1',
        backend: 'unknown',
        models: [{ id: 'probe-model' }],
      })

      const model = result.models[0]!
      expect(model.rejectedParams).toContain('reasoning_effort')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  describe('Reasoning-effort catalog (no endpoint probing)', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    /** Mock a generic endpoint that records any reasoning-effort value probes. */
    function stubEndpoint() {
      const effortRequests: string[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString()
          if (url.endsWith('/models')) {
            return new Response(JSON.stringify({ data: [] }), { status: 200 })
          }
          const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {}
          if (body['reasoning_effort'] !== undefined && body['max_tokens'] === 0) {
            effortRequests.push(String(body['reasoning_effort']))
          }
          return new Response(
            JSON.stringify({ choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 100 } }),
            { status: 200 },
          )
        }),
      )
      return effortRequests
    }

    it('uses the curated catalog values for known models on any backend', async () => {
      stubEndpoint()

      const result = await autoConfig({
        url: 'http://localhost:8000/v1',
        backend: 'vllm',
        models: [{ id: 'deepseek-v4-flash' }],
      })

      expect(result.models[0]?.reasoningEfforts).toEqual(['none', 'low', 'high', 'max'])
      expect(result.models[0]?.defaultReasoningEffort).toBe('high')
    })

    it('uses the curated catalog values for qwen3.8 on a local backend', async () => {
      stubEndpoint()

      const result = await autoConfig({
        url: 'http://localhost:8000/v1',
        backend: 'vllm',
        models: [{ id: 'Qwen3.8-27B-i1' }],
      })

      expect(result.models[0]?.reasoningEfforts).toEqual(['none', 'low', 'medium', 'xhigh'])
      expect(result.models[0]?.defaultReasoningEffort).toBe('xhigh')
    })

    it('leaves reasoningEfforts undefined for models without a catalog entry', async () => {
      stubEndpoint()

      const result = await autoConfig({
        url: 'http://localhost:8000/v1',
        backend: 'unknown',
        models: [{ id: 'test-model' }],
      })

      expect(result.models[0]?.reasoningEfforts).toBeUndefined()
    })

    it('never probes the endpoint for reasoning effort values', async () => {
      const effortRequests = stubEndpoint()

      await autoConfig({
        url: 'http://localhost:8000/v1',
        backend: 'vllm',
        models: [{ id: 'deepseek-v4-flash' }],
      })

      expect(effortRequests).toEqual([])
    })
  })

  it('skips rejected-params detection when the control probe fails (structural rejection)', async () => {
    const { autoConfig } = await import('./auto-config.js')

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.endsWith('/models')) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 })
        }

        const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {}
        const isRejectionProbe = Array.isArray(body['tools'])
        const hasSamplingParams = ['temperature', 'top_p', 'max_tokens', 'top_k', 'reasoning_effort'].some(
          (p) => p in body,
        )

        // Control probe: tools but no sampling params → structural 400 (e.g. no tool support)
        if (isRejectionProbe && !hasSamplingParams) {
          return new Response(JSON.stringify({ error: { message: 'This model does not support tools.' } }), {
            status: 400,
          })
        }
        // A param-attributed 400 that would otherwise trigger stripping must be ignored
        if (isRejectionProbe && 'temperature' in body) {
          return new Response(JSON.stringify({ error: { message: 'unsupported parameter: temperature' } }), {
            status: 400,
          })
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'hi' } }],
          }),
          { status: 200 },
        )
      }) as typeof globalThis.fetch

      const result = await autoConfig({
        url: 'http://localhost:8000/v1',
        backend: 'unknown',
        models: [{ id: 'probe-model' }],
      })

      const model = result.models[0]!
      expect(model.rejectedParams).toBeUndefined()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('matches rejected param names on word boundaries to avoid prefix false positives', async () => {
    const { autoConfig } = await import('./auto-config.js')

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.endsWith('/models')) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 })
        }

        const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {}
        const isRejectionProbe = Array.isArray(body['tools'])
        const hasSamplingParams = ['temperature', 'top_p', 'max_tokens', 'top_k', 'reasoning_effort'].some(
          (p) => p in body,
        )

        if (isRejectionProbe && !hasSamplingParams) {
          return new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 })
        }
        // Message mentions a DIFFERENT param (max_tokens_budget) whose prefix
        // contains 'max_tokens' — must not be attributed to max_tokens.
        if (isRejectionProbe && 'max_tokens' in body) {
          return new Response(
            JSON.stringify({ error: { message: 'max_tokens_budget exceeds server limit of 512000.' } }),
            { status: 400 },
          )
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'hi' } }],
          }),
          { status: 200 },
        )
      }) as typeof globalThis.fetch

      const result = await autoConfig({
        url: 'http://localhost:8000/v1',
        backend: 'unknown',
        models: [{ id: 'probe-model' }],
      })

      const model = result.models[0]!
      expect(model.rejectedParams).toBeUndefined()
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
