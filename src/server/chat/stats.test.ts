import { describe, it, expect } from 'vitest'
import { computeMessageStats, computeAggregatedStats } from './stats.js'
import { TurnMetrics } from './stream-pure.js'

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

    it('carries the reasoningEffort from the identity into the message stats', () => {
      const stats = computeAggregatedStats({
        identity: { ...identity, reasoningEffort: 'high' },
        mode: 'builder',
        totalPrefillTokens: 1000,
        totalGenTokens: 100,
        totalPrefillTime: 1,
        totalGenTime: 1,
        totalToolTime: 0,
        totalTime: 5,
      })

      expect(stats.reasoningEffort).toBe('high')
    })
  })

  describe('prefTokenIncrement', () => {
    it('computes prefillSpeed from increment when prefTokenIncrement is provided', () => {
      // Example: 80k total prompt, 78k cached = 2k increment processed in 0.5s
      // Old (inflated): 80000 / 0.5 = 160000 tok/s
      // New (correct): 2000 / 0.5 = 4000 tok/s
      const stats = computeMessageStats({
        identity,
        mode: 'builder',
        timing: { ttft: 0.5, completionTime: 2, tps: 0, prefillTps: 0 },
        usage: { promptTokens: 80000, completionTokens: 500 },
        prefTokenIncrement: 2000,
      })

      expect(stats.prefillTokens).toBe(80000)
      expect(stats.llmCalls?.[0]?.prefTokenIncrement).toBe(2000)
      expect(stats.prefillSpeed).toBe(4000)
    })

    it('falls back to total tokens when prefTokenIncrement is not provided', () => {
      const stats = computeMessageStats({
        identity,
        mode: 'builder',
        timing: { ttft: 2, completionTime: 10, tps: 0, prefillTps: 0 },
        usage: { promptTokens: 80000, completionTokens: 500 },
      })

      expect(stats.prefillTokens).toBe(80000)
      expect(stats.llmCalls?.[0]?.prefTokenIncrement).toBeUndefined()
      expect(stats.prefillSpeed).toBe(40000) // 80000 / 2
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

  describe('savings fields', () => {
    it('passes RTK and Headroom savings through aggregated stats', () => {
      const stats = computeAggregatedStats({
        identity,
        mode: 'builder',
        totalPrefillTokens: 100,
        totalGenTokens: 10,
        totalPrefillTime: 1,
        totalGenTime: 1,
        totalToolTime: 0,
        totalTime: 2,
        rtkTokensSaved: 1234,
        headroomTokensSaved: 567,
      })

      expect(stats.rtkTokensSaved).toBe(1234)
      expect(stats.headroomTokensSaved).toBe(567)
    })

    it('omits savings fields when nothing was saved', () => {
      const stats = computeAggregatedStats({
        identity,
        mode: 'builder',
        totalPrefillTokens: 100,
        totalGenTokens: 10,
        totalPrefillTime: 1,
        totalGenTime: 1,
        totalToolTime: 0,
        totalTime: 2,
      })

      expect(stats.rtkTokensSaved).toBeUndefined()
      expect(stats.headroomTokensSaved).toBeUndefined()
    })
  })
})

describe('TurnMetrics savings', () => {
  const identity = {
    providerId: 'provider-1',
    providerName: 'Local vLLM',
    backend: 'vllm' as const,
    model: 'test-model',
  }

  it('sums Headroom savings and keeps the RTK high-water mark', () => {
    const metrics = new TurnMetrics()
    metrics.addHeadroomSaved(100)
    metrics.addHeadroomSaved(50)
    metrics.setRtkTokensSaved(1000)
    metrics.setRtkTokensSaved(1200)

    const stats = metrics.buildStats(identity, 'builder')

    expect(stats.headroomTokensSaved).toBe(150)
    expect(stats.rtkTokensSaved).toBe(1200)
  })

  it('ignores zero and invalid savings', () => {
    const metrics = new TurnMetrics()
    metrics.addHeadroomSaved(0)
    metrics.addHeadroomSaved(Number.NaN)
    metrics.setRtkTokensSaved(0)

    const stats = metrics.buildStats(identity, 'builder')

    expect(stats.headroomTokensSaved).toBeUndefined()
    expect(stats.rtkTokensSaved).toBeUndefined()
  })
})
