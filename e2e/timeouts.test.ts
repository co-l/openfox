import { describe, expect, it } from 'vitest'

import config from './vitest.config.js'
import {
  DEFAULT_CHAT_TIMEOUT_MS,
  DEFAULT_WAIT_TIMEOUT_MS,
} from './utils/ws-client.js'
import {
  DEFAULT_COLLECTION_TIMEOUT_MS,
  DEFAULT_PHASE_TIMEOUT_MS,
} from './utils/event-collector.js'

describe('E2E timeouts', () => {
  it('keeps the per-test timeout at 2 seconds', () => {
    expect(config.test?.testTimeout).toBe(2_000)
  })

  it('keeps websocket waits within the per-test budget', () => {
    expect(DEFAULT_WAIT_TIMEOUT_MS).toBeLessThanOrEqual(2_000)
    expect(DEFAULT_CHAT_TIMEOUT_MS).toBeLessThanOrEqual(2_000)
  })

  it('keeps event collection within the per-test budget', () => {
    expect(DEFAULT_COLLECTION_TIMEOUT_MS).toBeLessThanOrEqual(2_000)
    expect(DEFAULT_PHASE_TIMEOUT_MS).toBeLessThanOrEqual(2_000)
  })
})
