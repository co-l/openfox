export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface RetryOptions {
  maxRetries: number
  backoffMs: number[]
  shouldRetry?: (error: unknown) => boolean
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error

      if (options.shouldRetry && !options.shouldRetry(error)) {
        throw error
      }

      if (attempt < options.maxRetries) {
        const backoff = options.backoffMs[attempt] ?? options.backoffMs[options.backoffMs.length - 1]!
        await sleep(backoff)
      }
    }
  }

  throw lastError
}

export function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

export type Unsubscribe = () => void

export class EventEmitter<T extends Record<string, unknown[]>> {
  private listeners = new Map<keyof T, Set<(...args: unknown[]) => void>>()

  on<K extends keyof T>(event: K, listener: (...args: T[K]) => void): Unsubscribe {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }

    const listeners = this.listeners.get(event)!
    listeners.add(listener as (...args: unknown[]) => void)

    return () => {
      listeners.delete(listener as (...args: unknown[]) => void)
    }
  }

  emit<K extends keyof T>(event: K, ...args: T[K]): void {
    const listeners = this.listeners.get(event)
    if (listeners) {
      for (const listener of listeners) {
        listener(...args)
      }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear()
  }
}
