import type { RequestContextMessage } from './request-context.js'

/** Rough token estimate: ~4 chars per token, matching the tool-definition estimate in mcp/manager.ts. */
export const CHARS_PER_TOKEN = 4

/** JSON framing overhead per tool message (role, tool_call_id, content key). */
export const TOOL_MESSAGE_OVERHEAD_TOKENS = 16

export function estimateToolResultTokens(toolMessages: Array<Pick<RequestContextMessage, 'content'>>): number {
  return toolMessages.reduce(
    (sum, message) => sum + TOOL_MESSAGE_OVERHEAD_TOKENS + Math.ceil(message.content.length / CHARS_PER_TOKEN),
    0,
  )
}

// llama.cpp: "request (N tokens) exceeds the available context size (M tokens)",
// type exceed_context_size_error. Missing it made the agent loop retry the very
// same oversized request with backoff, again and again.
const CONTEXT_LENGTH_ERROR_PATTERN =
  /context\s*length|context_length|context window|context size|exceed_context_size|prompt (?:is )?too long/i

export function isContextLengthError(message: string | undefined): boolean {
  if (!message) return false
  return CONTEXT_LENGTH_ERROR_PATTERN.test(message)
}

/**
 * Prompt and window sizes when the backend rejected a request because its
 * prompt alone does not fit the context window: a smaller maxTokens cannot fix
 * that, only a smaller prompt can. Undefined for any other error, including an
 * overflow caused by the requested output only.
 */
export function promptOverflow(
  message: string | undefined,
): { promptTokens: number; windowTokens: number } | undefined {
  if (!message) return undefined
  // llama.cpp: request (88901 tokens) exceeds the available context size (81920 tokens)
  const llama = /request \((\d+) tokens\) exceeds the available context size \((\d+) tokens\)/i.exec(message)
  if (llama) return { promptTokens: Number(llama[1]), windowTokens: Number(llama[2]) }
  // OpenAI-style: maximum context length is M tokens ... (N in the messages, ...)
  const window = /maximum context length is (\d+) tokens/i.exec(message)
  const prompt = /\((\d+) in the messages/i.exec(message)
  if (window && prompt && Number(prompt[1]) >= Number(window[1])) {
    return { promptTokens: Number(prompt[1]), windowTokens: Number(window[1]) }
  }
  return undefined
}

/** What a shortened tool result keeps of its start and end, at least. */
const FIT_MIN_KEPT_CHARS = 2_000

/**
 * Shorten tool results until about `excessTokens` are saved, keeping the start
 * and end of each (with a marker in between). Used for a compaction request
 * that would not fit the context window otherwise: the summary loses detail of
 * a huge tool output, instead of the request failing.
 *
 * Order: the results before the latest round, most recent first, then the
 * latest round. The conversation up to the previous request is in the
 * provider's prompt cache, and a change invalidates everything after it:
 * shortening near the end keeps most of the prompt cached. The latest round
 * (tool results after the last assistant message) is what the agent is about
 * to act on — the compaction often runs right after it arrives — so it is
 * shortened last.
 *
 * Returns new messages (the input is not mutated) and the tokens saved, which
 * can be less than asked when tool results alone are not enough.
 */
export function fitToolResults<T extends Pick<RequestContextMessage, 'role' | 'content'>>(
  messages: T[],
  excessTokens: number,
): { messages: T[]; savedTokens: number } {
  const fitted = [...messages]
  let remaining = excessTokens * CHARS_PER_TOKEN
  let savedChars = 0
  const candidates = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.role === 'tool' && message.content.length > FIT_MIN_KEPT_CHARS)
  let lastAssistant = -1
  messages.forEach((message, index) => {
    if (message.role === 'assistant') lastAssistant = index
  })
  // Without an assistant message, the newest result stands for the latest round.
  const roundStart = lastAssistant >= 0 ? lastAssistant : (candidates[candidates.length - 1]?.index ?? 0) - 1
  const earlier = candidates.filter(({ index }) => index <= roundStart).reverse()
  const latestRound = candidates.filter(({ index }) => index > roundStart)
  for (const { message, index } of [...earlier, ...latestRound]) {
    if (remaining <= 0) break
    const length = message.content.length
    // The omission marker costs ~70 characters: keep that much less.
    const keep = Math.max(FIT_MIN_KEPT_CHARS, length - remaining - 100)
    if (keep >= length) continue
    const head = message.content.slice(0, Math.ceil(keep * 0.7))
    const tail = message.content.slice(length - Math.floor(keep * 0.3))
    const content = `${head}\n[... ${length - head.length - tail.length} characters omitted to fit the summary request ...]\n${tail}`
    const saved = length - content.length
    if (saved <= 0) continue
    fitted[index] = { ...message, content }
    savedChars += saved
    remaining -= saved
  }
  return { messages: fitted, savedTokens: Math.floor(savedChars / CHARS_PER_TOKEN) }
}

/** Characters of a request's messages: content plus tool call arguments. */
export function messageChars(messages: Array<Pick<RequestContextMessage, 'content' | 'toolCalls'>>): number {
  let chars = 0
  for (const message of messages) {
    chars += message.content.length
    for (const call of message.toolCalls ?? []) chars += JSON.stringify(call.arguments).length + call.name.length
  }
  return chars
}
