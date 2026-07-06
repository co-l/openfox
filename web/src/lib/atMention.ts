export function getAtMentionAtCursor(text: string, cursorPos: number): { query: string; startIndex: number } | null {
  const beforeCursor = text.slice(0, cursorPos)
  const lastAt = beforeCursor.lastIndexOf('@')

  if (lastAt === -1) {
    return null
  }

  const query = beforeCursor.slice(lastAt + 1)

  if (query.includes(' ') || query.includes('\n') || query.includes('\t')) {
    return null
  }

  return { query, startIndex: lastAt }
}
