import { createHash } from 'node:crypto'

export function contentHash(data: string): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 16)
}

export function cacheSet<V>(cache: Map<string, V>, key: string, value: V): void {
  const max = 50
  if (cache.size >= max) {
    const first = cache.keys().next().value
    if (first !== undefined) cache.delete(first)
  }
  cache.set(key, value)
}
