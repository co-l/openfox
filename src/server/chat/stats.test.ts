import { describe, it, expect } from 'vitest'
import { computeMessageStats, computeAggregatedStats } from './stats.js'

describe('stats computation', () => {
  const identity = {
    providerId: 'provider-1',
    providerName: 'Local vLLM',
    backend: 'vllm' as const,
    model: 'test-model',
  }

  describe('computeMessageStats', () => {
    it('calculates speeds correctly for single LLM call', () => {
      const stats = computeMessageStats({
        identity,
        mode: 'builder',
        timing: { ttft: 5, completionTime: 10, tps: 0, prefillTps: 0 },
        usage: { promptTokens: 50000, completionTokens: 500 },
        toolTime: 2,
      })

      expect(stats.prefillTokens).toBe(50000)
      expect(stats.generationTokens).toBe(500)
      // 50000 tokens / 5 seconds = 10000 tok/s
      expect(stats.prefillSpeed).toBe(10000)
      // 500 tokens / 10 seconds = 50 tok/s
      expect(stats.generationSpeed).toBe(50)
      expect(stats.totalTime).toBe(17) // 5 + 10 + 2
    })
  })

  describe('computeAggregatedStats', () => {
    it('calculates speeds correctly for multiple LLM calls', () => {
      // Simulate 5 LLM calls, each with ~70k prompt tokens and ~500 gen tokens
      const stats = computeAggregatedStats({
        identity,
        mode: 'builder',
        totalPrefillTokens: 350000, // 5 × 70k
        totalGenTokens: 2500, // 5 × 500
        totalPrefillTime: 25, // 5 × 5 seconds ttft
        totalGenTime: 17, // sum of completion times
        totalToolTime: 10,
        totalTime: 145,
      })

      expect(stats.prefillTokens).toBe(350000)
      expect(stats.generationTokens).toBe(2500)
      // 350000 tokens / 25 seconds = 14000 tok/s (realistic)
      expect(stats.prefillSpeed).toBe(14000)
      // 2500 tokens / 17 seconds ≈ 147.1 tok/s (realistic)
      expect(stats.generationSpeed).toBe(147.1)
      expect(stats.totalTime).toBe(145)
    })
  })

  describe('builder stats inflation bug', () => {
    it('demonstrates inflated speeds when using single-call timing with cumulative tokens', () => {
      // This is the BUG: using computeMessageStats with cumulative tokens
      // but only the LAST call's timing
      const buggyStats = computeMessageStats({
        identity,
        mode: 'builder',
        // Cumulative tokens from 5 LLM calls
        usage: { promptTokens: 350000, completionTokens: 2500 },
        // But only the LAST call's timing!
        timing: { ttft: 5.5, completionTime: 3.4, tps: 0, prefillTps: 0 },
        toolTime: 52,
        totalTimeOverride: 145,
      })

      // These speeds are WILDLY INFLATED (matches what user saw: 63.9k pp, 732.2 tg)
      // 350000 / 5.5 = 63636 tok/s - impossible!
      expect(buggyStats.prefillSpeed).toBeGreaterThan(60000)
      // 2500 / 3.4 = 735 tok/s - also inflated
      expect(buggyStats.generationSpeed).toBeGreaterThan(700)
    })

    it('shows correct speeds when using computeAggregatedStats with cumulative timing', () => {
      // This is the FIX: use computeAggregatedStats with cumulative timing
      const correctStats = computeAggregatedStats({
        identity,
        mode: 'builder',
        totalPrefillTokens: 350000,
        totalGenTokens: 2500,
        // Cumulative timing from all 5 calls
        totalPrefillTime: 27.5, // 5 × 5.5 seconds
        totalGenTime: 17, // 5 × 3.4 seconds
        totalToolTime: 52,
        totalTime: 145,
      })

      // 350000 / 27.5 ≈ 12727 tok/s - realistic for vLLM
      expect(correctStats.prefillSpeed).toBeLessThan(15000)
      expect(correctStats.prefillSpeed).toBeGreaterThan(10000)
      // 2500 / 17 ≈ 147 tok/s - realistic generation speed
      expect(correctStats.generationSpeed).toBeLessThan(200)
      expect(correctStats.generationSpeed).toBeGreaterThan(100)
    })
  })
})
