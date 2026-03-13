// Approximate token counting (tiktoken would be more accurate but adds complexity)
// For English text, approximately 4 characters = 1 token
const CHARS_PER_TOKEN = 4

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export function estimateMessagesTokens(messages: { content: string }[]): number {
  let total = 0
  
  for (const msg of messages) {
    // Add message overhead (~4 tokens per message)
    total += 4
    total += estimateTokens(msg.content)
  }
  
  return total
}
