export function getMinimumCompactionPercent(maxTokens: number, minimumTokens: number): number {
  if (maxTokens <= 0 || minimumTokens <= 0) return 0
  return Math.min(100, Math.ceil((minimumTokens / maxTokens) * 100))
}

export function normalizeCompactionPercent(value: number, minimumPercent: number): number {
  if (value <= 0) return 0
  if (minimumPercent <= 0 || value >= minimumPercent) return Math.min(100, value)
  return value < minimumPercent / 2 ? 0 : minimumPercent
}

export function getCompactionTokenThreshold(maxTokens: number, percent: number): number {
  return Math.floor((maxTokens * percent) / 100)
}
