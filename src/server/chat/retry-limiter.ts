export interface RetryLimiter {
  canRetry: () => boolean
  increment: () => void
  reset: () => void
  count: () => number
  maxRetries: () => number
  setMaxRetries: (max: number) => void
}

export function createRetryLimiter(max: number): RetryLimiter {
  let current = 0
  let limit = max

  return {
    canRetry: () => current < limit,
    increment: () => {
      current += 1
    },
    reset: () => {
      current = 0
    },
    count: () => current,
    maxRetries: () => limit,
    setMaxRetries: (next: number) => {
      limit = next
    },
  }
}
