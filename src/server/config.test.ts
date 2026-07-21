import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

const originalThreshold = process.env['OPENFOX_COMPACTION_THRESHOLD']

afterEach(() => {
  if (originalThreshold === undefined) {
    delete process.env['OPENFOX_COMPACTION_THRESHOLD']
  } else {
    process.env['OPENFOX_COMPACTION_THRESHOLD'] = originalThreshold
  }
})

describe('compaction configuration', () => {
  it('uses the default auto-compaction threshold', () => {
    delete process.env['OPENFOX_COMPACTION_THRESHOLD']

    expect(loadConfig().context.compactionThreshold).toBe(0.85)
  })

  it('reads the auto-compaction threshold from the environment', () => {
    process.env['OPENFOX_COMPACTION_THRESHOLD'] = '0.7'

    expect(loadConfig().context.compactionThreshold).toBe(0.7)
  })

  it('allows zero to disable auto-compaction', () => {
    process.env['OPENFOX_COMPACTION_THRESHOLD'] = '0'

    expect(loadConfig().context.compactionThreshold).toBe(0)
  })

  it('rejects thresholds outside the 0 to 1 range', () => {
    process.env['OPENFOX_COMPACTION_THRESHOLD'] = '1.1'

    expect(() => loadConfig()).toThrow()
  })
})
