import { describe, expect, it } from 'vitest'
import { availableParallelism, cpus } from 'node:os'

import config, { resolveMaxWorkers } from './vitest.config.js'
import { DEFAULT_CHAT_TIMEOUT_MS, DEFAULT_WAIT_TIMEOUT_MS } from './utils/ws-client.js'
import { DEFAULT_COLLECTION_TIMEOUT_MS, DEFAULT_PHASE_TIMEOUT_MS } from './utils/event-collector.js'

const CI_MULTIPLIER = process.env['CI'] === 'true' ? 10 : 1

describe('E2E timeouts', () => {
  it('defaults to a CPU-aware worker count, 1 on CI, overridable via OPENFOX_E2E_MAX_WORKERS', () => {
    const parallelism = typeof availableParallelism === 'function' ? availableParallelism() : cpus().length
    expect(resolveMaxWorkers({})).toBe(Math.max(1, Math.min(12, Math.floor(parallelism / 2))))
    expect(resolveMaxWorkers({ CI: 'true' })).toBe(1)
    expect(resolveMaxWorkers({ OPENFOX_E2E_MAX_WORKERS: '4' })).toBe(4)
    expect(resolveMaxWorkers({ CI: 'true', OPENFOX_E2E_MAX_WORKERS: '6' })).toBe(6)
  })

  it('applies the resolved worker count to the vitest config', () => {
    expect(config.test?.maxWorkers).toBe(resolveMaxWorkers())
  })
  it('keeps the per-test timeout at 15 seconds (scaled in CI)', () => {
    expect(config.test?.testTimeout).toBe(15_000 * CI_MULTIPLIER)
  })

  it('keeps websocket waits within the per-test budget', () => {
    const budget = 8_000 * CI_MULTIPLIER
    expect(DEFAULT_WAIT_TIMEOUT_MS).toBeLessThanOrEqual(budget)
    expect(DEFAULT_CHAT_TIMEOUT_MS).toBeLessThanOrEqual(budget)
  })

  it('keeps event collection within the per-test budget', () => {
    const budget = 8_000 * CI_MULTIPLIER
    expect(DEFAULT_COLLECTION_TIMEOUT_MS).toBeLessThanOrEqual(budget)
    expect(DEFAULT_PHASE_TIMEOUT_MS).toBeLessThanOrEqual(budget)
  })
})
