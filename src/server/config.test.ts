import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig } from './config.js'

describe('loadConfig digestRound env', () => {
  const originalEnv = process.env['OPENFOX_DIGEST_ROUND']

  beforeEach(() => {
    delete process.env['OPENFOX_DIGEST_ROUND']
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['OPENFOX_DIGEST_ROUND']
    } else {
      process.env['OPENFOX_DIGEST_ROUND'] = originalEnv
    }
  })

  it('omits context.digestRound when the env var is unset', () => {
    const config = loadConfig()
    expect(config.context.digestRound).toBeUndefined()
  })

  it('accepts -1 (all prior summaries)', () => {
    process.env['OPENFOX_DIGEST_ROUND'] = '-1'
    const config = loadConfig()
    expect(config.context.digestRound).toBe(-1)
  })

  it('accepts a positive cap (most recent k)', () => {
    process.env['OPENFOX_DIGEST_ROUND'] = '3'
    const config = loadConfig()
    expect(config.context.digestRound).toBe(3)
  })

  it('accepts 0 (explicit off)', () => {
    process.env['OPENFOX_DIGEST_ROUND'] = '0'
    const config = loadConfig()
    expect(config.context.digestRound).toBe(0)
  })

  it('rejects -2 (below the allowed range)', () => {
    process.env['OPENFOX_DIGEST_ROUND'] = '-2'
    expect(() => loadConfig()).toThrow()
  })

  it('rejects non-integer values', () => {
    process.env['OPENFOX_DIGEST_ROUND'] = '1.5'
    expect(() => loadConfig()).toThrow()
  })

  it('preserves the rest of the context config', () => {
    process.env['OPENFOX_DIGEST_ROUND'] = '-1'
    const config = loadConfig()
    expect(config.context.maxTokens).toBe(200000)
    expect(config.context.compactionThreshold).toBe(0.85)
    expect(config.context.compactionTarget).toBe(0.6)
  })
})
