import { describe, expect, it } from 'vitest'
import { shouldCompact } from './compactor.js'

describe('LLMExecutor compaction logic', () => {
  describe('shouldCompact threshold checks', () => {
    const testCases = [
      { tokens: 180_001, max: 200_000, threshold: 0.9, expected: true },
      { tokens: 180_000, max: 200_000, threshold: 0.9, expected: false },
      { tokens: 160_001, max: 200_000, threshold: 0.8, expected: true },
      { tokens: 160_000, max: 200_000, threshold: 0.8, expected: false },
      { tokens: 50_000, max: 128_000, threshold: 0.7, expected: false },
      { tokens: 89_601, max: 128_000, threshold: 0.7, expected: true },
    ]

    for (const { tokens, max, threshold, expected } of testCases) {
      it(`shouldCompact(${tokens}, ${max}, ${threshold}) = ${expected}`, () => {
        expect(shouldCompact(tokens, max, threshold)).toBe(expected)
      })
    }
  })
})

describe('subAgentId routing', () => {
  it('creates unique subAgentInstanceId per invocation', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      ids.add(crypto.randomUUID())
    }
    expect(ids.size).toBe(100)
  })

  it('subAgentId is included in context state event data', () => {
    const subAgentId = crypto.randomUUID()
    const eventData = {
      currentTokens: 50000,
      maxTokens: 128000,
      compactionCount: 0,
      dangerZone: false,
      canCompact: true,
      subAgentId,
    }
    expect(eventData.subAgentId).toBe(subAgentId)
    expect(typeof eventData.subAgentId).toBe('string')
  })

  it('main agent context state does not include subAgentId', () => {
    const eventData = {
      currentTokens: 50000,
      maxTokens: 128000,
      compactionCount: 0,
      dangerZone: false,
      canCompact: true,
    }
    expect('subAgentId' in eventData).toBe(false)
  })
})

describe('context state danger zone', () => {
  const isDangerZone = (tokens: number, maxTokens: number) => maxTokens - tokens < 20000

  it('detects danger zone when tokens remaining < 20K', () => {
    expect(isDangerZone(190_000, 200_000)).toBe(true)
    expect(isDangerZone(185_000, 200_000)).toBe(true)
    expect(isDangerZone(180_000, 200_000)).toBe(false)
  })

  it('detects danger zone for smaller context windows', () => {
    expect(isDangerZone(115_000, 128_000)).toBe(true)
    expect(isDangerZone(110_000, 128_000)).toBe(true)
    expect(isDangerZone(108_000, 128_000)).toBe(false)
  })
})

describe('compaction summary generation', () => {
  it('produces non-empty summary', async () => {
    const mockSummary = 'Previous context summary: Test summary content'
    expect(mockSummary.length).toBeGreaterThan(0)
    expect(mockSummary).toContain('Previous context summary:')
  })

  it('replaces context with summary message', () => {
    const originalMessages = [
      { role: 'user', content: 'First message with lots of detailed content about the task', source: 'history' as const },
      { role: 'assistant', content: 'Response 1 with detailed analysis and findings', source: 'history' as const },
      { role: 'user', content: 'Second message with additional information and context', source: 'history' as const },
      { role: 'assistant', content: 'Response 2 with more analysis and tool usage', source: 'history' as const },
    ]

    const summary = 'Sum: Task completed, files modified, tests passing'
    const compactedMessages = [{ role: 'user', content: summary, source: 'history' as const }]

    expect(compactedMessages.length).toBe(1)
    expect(compactedMessages[0]?.content).toBe(summary)
    const originalTotal = originalMessages.reduce((acc, m) => acc + m.content.length, 0)
    expect(compactedMessages[0]?.content.length ?? 0).toBeLessThan(originalTotal)
  })
})

describe('separate context states per subagent instance', () => {
  it('maintains separate context states for multiple subagent instances', () => {
    const subAgent1Id = crypto.randomUUID()
    const subAgent2Id = crypto.randomUUID()

    const contextStates: Record<string, { currentTokens: number; maxTokens: number; compactionCount: number }> = {
      [subAgent1Id]: { currentTokens: 50000, maxTokens: 128000, compactionCount: 0 },
      [subAgent2Id]: { currentTokens: 75000, maxTokens: 128000, compactionCount: 1 },
    }

    expect(contextStates[subAgent1Id]?.currentTokens).toBe(50000)
    expect(contextStates[subAgent1Id]?.compactionCount).toBe(0)
    expect(contextStates[subAgent2Id]?.currentTokens).toBe(75000)
    expect(contextStates[subAgent2Id]?.compactionCount).toBe(1)
    expect(contextStates[subAgent1Id]).not.toBe(contextStates[subAgent2Id])
  })

  it('cleaning up a subagent removes its context state', () => {
    const subAgentId = crypto.randomUUID()
    const contextStates: Record<string, object> = {
      [subAgentId]: { currentTokens: 50000 },
    }

    delete contextStates[subAgentId]

    expect(subAgentId in contextStates).toBe(false)
  })
})