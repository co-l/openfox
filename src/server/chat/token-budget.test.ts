import { describe, it, expect } from 'vitest'
import {
  estimateToolResultTokens,
  isContextLengthError,
  promptOverflow,
  fitToolResults,
  messageChars,
  CHARS_PER_TOKEN,
  TOOL_MESSAGE_OVERHEAD_TOKENS,
} from './token-budget.js'

const LLAMA_CPP_OVERFLOW =
  'LLMError: HTTP 400: {"error":{"code":400,"message":"request (88901 tokens) exceeds the available context size (81920 tokens), try increasing it","type":"exceed_context_size_error","n_prompt_tokens":88901,"n_ctx":81920}}'

describe('estimateToolResultTokens', () => {
  it('returns 0 for no tool messages', () => {
    expect(estimateToolResultTokens([])).toBe(0)
  })

  it('estimates content tokens plus per-message overhead', () => {
    const content = 'a'.repeat(CHARS_PER_TOKEN * 10)
    expect(estimateToolResultTokens([{ content }])).toBe(TOOL_MESSAGE_OVERHEAD_TOKENS + 10)
  })

  it('rounds partial token buckets up per message', () => {
    expect(estimateToolResultTokens([{ content: 'abc' }])).toBe(TOOL_MESSAGE_OVERHEAD_TOKENS + 1)
    expect(estimateToolResultTokens([{ content: 'abcde' }])).toBe(TOOL_MESSAGE_OVERHEAD_TOKENS + 2)
  })

  it('sums estimates across multiple tool messages', () => {
    const a = 'a'.repeat(CHARS_PER_TOKEN * 5)
    const b = 'b'.repeat(CHARS_PER_TOKEN * 7)
    expect(estimateToolResultTokens([{ content: a }, { content: b }])).toBe(2 * TOOL_MESSAGE_OVERHEAD_TOKENS + 12)
  })
})

describe('isContextLengthError', () => {
  it('detects OpenAI-style maximum context length errors', () => {
    expect(
      isContextLengthError(
        "HTTP 400: This model's maximum context length is 128000 tokens. However, you requested 130000 tokens (120000 in the messages, 10000 in the completion).",
      ),
    ).toBe(true)
  })

  it('detects context window and context_length markers', () => {
    expect(isContextLengthError('context window exceeded')).toBe(true)
    expect(isContextLengthError('context_length is too long')).toBe(true)
  })

  it('detects prompt-too-long framing', () => {
    expect(isContextLengthError('Prompt is too long (12345 tokens > 8192 tokens)')).toBe(true)
  })

  it('does not match generic token errors without context framing', () => {
    expect(isContextLengthError('too many tokens')).toBe(false)
    expect(isContextLengthError('maximum output tokens exceeded')).toBe(false)
  })

  it("detects llama.cpp's context size overflow", () => {
    // Not matched before: the request was retried as-is, with backoff, forever.
    expect(isContextLengthError(LLAMA_CPP_OVERFLOW)).toBe(true)
  })

  it('returns false for unrelated errors and empty input', () => {
    expect(isContextLengthError('Connection refused')).toBe(false)
    expect(isContextLengthError('HTTP 500: internal server error')).toBe(false)
    expect(isContextLengthError(undefined)).toBe(false)
    expect(isContextLengthError('')).toBe(false)
  })
})

describe('promptOverflow', () => {
  it('reads the prompt and window sizes of a llama.cpp overflow', () => {
    expect(promptOverflow(LLAMA_CPP_OVERFLOW)).toEqual({ promptTokens: 88901, windowTokens: 81920 })
  })

  it('reads an OpenAI-style error whose messages alone exceed the window', () => {
    expect(
      promptOverflow(
        "This model's maximum context length is 128000 tokens. However, you requested 140000 tokens (135000 in the messages, 5000 in the completion).",
      ),
    ).toEqual({ promptTokens: 135000, windowTokens: 128000 })
  })

  it('is undefined when only the requested output overflows (a smaller maxTokens fixes it)', () => {
    expect(
      promptOverflow(
        "This model's maximum context length is 128000 tokens. However, you requested 130000 tokens (120000 in the messages, 10000 in the completion).",
      ),
    ).toBeUndefined()
    expect(promptOverflow('context window exceeded')).toBeUndefined()
    expect(promptOverflow(undefined)).toBeUndefined()
  })
})

describe('fitToolResults', () => {
  const tool = (content: string) => ({ role: 'tool' as const, content, source: 'history' as const })
  const user = (content: string) => ({ role: 'user' as const, content, source: 'history' as const })

  const assistant = (content: string) => ({ role: 'assistant' as const, content, source: 'history' as const })

  it('shortens the most recent results before the latest round first, keeping their start and end', () => {
    // The request before this one ended with the previous round: everything
    // up to there is in the provider's prompt cache. A change near the start
    // makes the backend prefill the whole conversation again (seen live with
    // llama.cpp: 28-69k tokens, 25-55 s per compaction when the oldest result
    // was shortened); a change near the end only the part after it.
    // The latest round is the one the agent is about to act on (seen live:
    // cutting the middle of a command output that just arrived dropped the
    // value the agent needed, so it ran the command again after the summary):
    // it is shortened last.
    const oldest = 'o'.repeat(200_000)
    const recent = `HEAD${'r'.repeat(200_000)}TAIL`
    const latest = 'n'.repeat(200_000)
    const messages = [
      user('u'.repeat(50_000)),
      assistant('a1'),
      tool(oldest),
      assistant('a2'),
      tool(recent),
      assistant('a3'),
      tool(latest),
      user('summarize'),
    ]

    const { messages: fitted, savedTokens } = fitToolResults(messages, 30_000)

    expect(savedTokens).toBeGreaterThanOrEqual(30_000)
    expect(fitted[4]!.content.startsWith('HEAD')).toBe(true)
    expect(fitted[4]!.content.endsWith('TAIL')).toBe(true)
    expect(fitted[4]!.content).toMatch(/characters omitted/)
    // Enough was saved there: the conversation up to it is unchanged (cached
    // prefix), and the latest round too.
    for (const index of [0, 1, 2, 3, 5, 6, 7]) expect(fitted[index]).toBe(messages[index])
    // The input is not mutated.
    expect(messages[4]!.content).toBe(recent)
  })

  it('goes back to older results when the recent ones are not enough', () => {
    const messages = [
      assistant('a1'),
      tool('o'.repeat(100_000)),
      assistant('a2'),
      tool('r'.repeat(20_000)),
      assistant('a3'),
      tool('n'.repeat(100_000)),
    ]

    const { messages: fitted, savedTokens } = fitToolResults(messages, 10_000)

    expect(savedTokens).toBeGreaterThanOrEqual(10_000)
    expect(fitted[3]!.content.length).toBeLessThan(20_000)
    expect(fitted[1]!.content.length).toBeLessThan(100_000)
    expect(fitted[5]).toBe(messages[5])
  })

  it('shortens the newest tool result only when the older ones are not enough', () => {
    const messages = [tool('o'.repeat(10_000)), tool('n'.repeat(200_000))]
    const { messages: fitted, savedTokens } = fitToolResults(messages, 20_000)

    expect(savedTokens).toBeGreaterThanOrEqual(20_000)
    expect(fitted[0]!.content.length).toBeLessThan(10_000)
    expect(fitted[1]!.content.length).toBeLessThan(200_000)
  })

  it('moves on to the next tool result when one is not enough', () => {
    const messages = [tool('a'.repeat(40_000)), tool('b'.repeat(40_000))]
    const { messages: fitted, savedTokens } = fitToolResults(messages, 15_000)

    expect(savedTokens).toBeGreaterThanOrEqual(15_000)
    expect(fitted[0]!.content.length).toBeLessThan(40_000)
    expect(fitted[1]!.content.length).toBeLessThan(40_000)
  })

  it('changes nothing when nothing needs to be saved', () => {
    const messages = [tool('a'.repeat(40_000))]
    const { messages: fitted, savedTokens } = fitToolResults(messages, 0)
    expect(savedTokens).toBe(0)
    expect(fitted[0]).toBe(messages[0])
  })

  it('reports what it could save when tool results are not enough', () => {
    const { savedTokens } = fitToolResults([tool('a'.repeat(8_000)), user('u'.repeat(400_000))], 50_000)
    expect(savedTokens).toBeLessThan(50_000)
    expect(savedTokens).toBeGreaterThan(0)
  })
})

describe('messageChars', () => {
  it('counts message contents and tool call arguments', () => {
    expect(
      messageChars([
        { content: 'abcd' },
        { content: '', toolCalls: [{ id: 'c', name: 'read_file', arguments: { path: 'a.py' } }] },
      ]),
    ).toBe(4 + 'read_file'.length + JSON.stringify({ path: 'a.py' }).length)
  })
})
