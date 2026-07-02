/**
 * Auto-config tests using real data collected from 5 backends.
 *
 * These tests verify that the probing algorithm selects the correct
 * winning combo for each backend based on actual observed behavior.
 */

import { describe, it, expect } from 'vitest'

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
