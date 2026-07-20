export function decodeDataUrl(data: string): Buffer | null {
  const match = data.match(/^data:.*?;base64,(.+)$/)
  if (!match?.[1]) return null
  try {
    return Buffer.from(match[1], 'base64')
  } catch {
    return null
  }
}
