import { describe, expect, it } from 'vitest'
import { formatPluginPrice } from './plugin-model-meta'

describe('formatPluginPrice', () => {
  it('formats input/output rates with a currency symbol', () => {
    expect(formatPluginPrice({ input: 0.15, output: 0.6, currency: 'USD' })).toBe('$0.15/0.60')
    expect(formatPluginPrice({ input: 1, output: 2, currency: 'EUR' })).toBe('€1.00/2.00')
  })

  it('falls back to the currency code when unknown', () => {
    expect(formatPluginPrice({ input: 0.1, currency: 'CHF' })).toBe('CHF 0.10/?')
  })

  it('includes cache rates and discount', () => {
    expect(
      formatPluginPrice({
        input: 0.5,
        output: 1.5,
        cacheRead: 0.05,
        cacheWrite: 0.2,
        discountPercent: 20,
        currency: 'USD',
      }),
    ).toBe('$0.50/1.50 · $0.05/0.20 cache · -20.00%')
  })

  it('returns null when nothing is priced', () => {
    expect(formatPluginPrice({})).toBeNull()
    expect(formatPluginPrice({ discountPercent: 0 })).toBeNull()
  })
})
