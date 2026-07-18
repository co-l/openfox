import { describe, expect, it } from 'vitest'

import config from './vitest.config.js'
import { DEFAULT_CHAT_TIMEOUT_MS, DEFAULT_WAIT_TIMEOUT_MS } from './utils/ws-client.js'
import { DEFAULT_COLLECTION_TIMEOUT_MS, DEFAULT_PHASE_TIMEOUT_MS } from './utils/event-collector.js'

const CI_MULTIPLIER = process.env['CI'] === 'true' ? 10 : 1

describe('E2E timeouts', () => {
  it('keeps the per-test timeout at 15 seconds (scaled in CI)', () => {
    expect(config.test?.testTimeout).toBe(15_000 * CI_MULTIPLIER)
  })

  it('keeps websocket waits within the per-test budget', () => {
    const budget = 2_000 * CI_MULTIPLIER
    expect(DEFAULT_WAIT_TIMEOUT_MS).toBeLessThanOrEqual(budget)
    expect(DEFAULT_CHAT_TIMEOUT_MS).toBeLessThanOrEqual(budget)
  })

  it('keeps event collection within the per-test budget', () => {
    const budget = 2_000 * CI_MULTIPLIER
    expect(DEFAULT_COLLECTION_TIMEOUT_MS).toBeLessThanOrEqual(budget)
    expect(DEFAULT_PHASE_TIMEOUT_MS).toBeLessThanOrEqual(budget)
  })
})
