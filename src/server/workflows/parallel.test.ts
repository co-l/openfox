/**
 * Workflow Parallel Step – Pure Function Tests
 *
 * Covers the bounded-concurrency pool (mapPool) and the result aggregator
 * (aggregateParallel) used by `parallel` workflow steps. No mocks: both are
 * pure functions.
 */

import { describe, it, expect } from 'vitest'
import { mapPool, aggregateParallel } from './parallel.js'
import type { ChildOutcome } from './parallel.js'

// ============================================================================
// Helpers
// ============================================================================

class Deferred<T> {
  readonly promise: Promise<T>
  private resolveFn!: (value: T) => void
  private rejectFn!: (error: unknown) => void
  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolveFn = resolve
      this.rejectFn = reject
    })
  }
  resolve(value: T): void {
    this.resolveFn(value)
  }
  reject(error: unknown): void {
    this.rejectFn(error)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function outcome(id: string, result: string, output: Record<string, string> = {}): ChildOutcome {
  return { id, result, output }
}

// ============================================================================
// mapPool
// ============================================================================

describe('mapPool', () => {
  it('returns an empty array for empty items', async () => {
    const results = await mapPool<number, number>([], 2, (n) => Promise.resolve(n * 2))
    expect(results).toEqual([])
  })

  it('preserves input order regardless of completion order', async () => {
    const delays: Record<number, number> = { 1: 30, 2: 5, 3: 15, 4: 1 }
    const results = await mapPool([1, 2, 3, 4], 4, async (n) => {
      await sleep(delays[n] ?? 0)
      return n * 2
    })
    expect(results).toEqual([2, 4, 6, 8])
  })

  it('runs strictly sequentially when limit is 1', async () => {
    const events: string[] = []
    const gates: Record<string, Deferred<void>> = { a: new Deferred(), b: new Deferred(), c: new Deferred() }
    const pending = mapPool(['a', 'b', 'c'], 1, async (item) => {
      events.push(`start ${item}`)
      await gates[item]!.promise
      events.push(`end ${item}`)
      return item
    })
    await sleep(20)
    expect(events).toEqual(['start a'])
    gates['a']!.resolve(undefined)
    await sleep(20)
    expect(events).toEqual(['start a', 'end a', 'start b'])
    gates['b']!.resolve(undefined)
    gates['c']!.resolve(undefined)
    const results = await pending
    expect(results).toEqual(['a', 'b', 'c'])
    expect(events).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c'])
  })

  it('never exceeds the configured concurrency limit', async () => {
    let inFlight = 0
    let peak = 0
    const results = await mapPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await sleep(10)
      inFlight -= 1
      return n
    })
    expect(peak).toBeLessThanOrEqual(2)
    expect(results).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('runs everything at once when the limit exceeds the item count', async () => {
    let inFlight = 0
    let peak = 0
    await mapPool([1, 2, 3], 10, async (n) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await sleep(10)
      inFlight -= 1
      return n
    })
    expect(peak).toBe(3)
  })

  it('rejects with the first error after every task has settled', async () => {
    const ran: string[] = []
    const pending = mapPool(['a', 'b', 'c'], 3, async (item) => {
      ran.push(item)
      if (item === 'a') throw new Error('boom-a')
      await sleep(10)
      return item
    })
    const error = await pending.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('boom-a')
    // All-settled semantics: the other tasks still ran to completion
    expect([...ran].sort()).toEqual(['a', 'b', 'c'])
  })

  it('rethrows abort-style errors even when other tasks succeed', async () => {
    const pending = mapPool(['a', 'b'], 2, async (item) => {
      if (item === 'a') throw new Error('Aborted')
      await sleep(5)
      return item
    })
    const error = await pending.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Aborted')
  })
})

// ============================================================================
// aggregateParallel
// ============================================================================

describe('aggregateParallel', () => {
  it('aggregates all-success children as success', () => {
    const { result, output } = aggregateParallel([
      outcome('lint', 'success', { stdout: 'clean', exitCode: '0' }),
      outcome('review', 'success', { content: 'LGTM' }),
    ])
    expect(result).toBe('success')
    expect(output['result']).toBe('success')
    expect(output['summary']).toBe('- lint: success\n- review: success')
  })

  it('aggregates all-failure children as failure', () => {
    const { result } = aggregateParallel([
      outcome('lint', 'failure', { exitCode: '1' }),
      outcome('review', 'failed', { content: 'issues found' }),
    ])
    expect(result).toBe('failure')
  })

  it('aggregates mixed results as partial', () => {
    const { result } = aggregateParallel([
      outcome('lint', 'success'),
      outcome('review', 'failed', { content: 'issues found' }),
    ])
    expect(result).toBe('partial')
  })

  it('treats child errors as non-success (mixed with a success => partial)', () => {
    const { result } = aggregateParallel([outcome('ok', 'success'), outcome('bad', 'error', { error: 'unknown type' })])
    expect(result).toBe('partial')
  })

  it('returns failure for empty children', () => {
    const { result, output } = aggregateParallel([])
    expect(result).toBe('failure')
    expect(output['result']).toBe('failure')
    expect(output['summary']).toBe('')
  })

  it('flattens per-child keys under the child id (flat, dotted)', () => {
    const { output } = aggregateParallel([
      outcome('lint', 'success', { stdout: 'clean', stderr: '', exitCode: '0' }),
      outcome('review', 'failed', { content: 'issues' }),
    ])
    expect(output['lint.result']).toBe('success')
    expect(output['lint.stdout']).toBe('clean')
    expect(output['lint.stderr']).toBe('')
    expect(output['lint.exitCode']).toBe('0')
    expect(output['review.result']).toBe('failed')
    expect(output['review.content']).toBe('issues')
  })

  it('keeps child order in the summary', () => {
    const { output } = aggregateParallel([
      outcome('b', 'failure'),
      outcome('a', 'success'),
      outcome('c', 'error', { error: 'x' }),
    ])
    expect(output['summary']).toBe('- b: failure\n- a: success\n- c: error')
  })

  it('prefers the per-child result key over a duplicate child output key', () => {
    const { output } = aggregateParallel([outcome('a', 'success', { result: 'success' })])
    expect(output['a.result']).toBe('success')
  })
})
