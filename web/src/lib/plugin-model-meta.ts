import type { PluginModelPricingView } from '@shared/plugin.js'

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' }

function currencyPrefix(currency: string | undefined): string {
  if (!currency) return ''
  return CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency.toUpperCase()} `
}

function rate(value: number): string {
  if (value >= 1) return value.toFixed(2)
  const trimmed = value.toFixed(4).replace(/0+$/, '')
  const [whole = '0', decimals = ''] = trimmed.split('.')
  return `${whole}.${decimals.padEnd(2, '0')}`
}

/**
 * Compact pricing label for a model row, e.g. "$0.15/0.60 · -20%".
 * Pure so the format is unit-testable independently of the React row.
 */
export function formatPluginPrice(pricing: PluginModelPricingView): string | null {
  const parts: string[] = []
  const prefix = currencyPrefix(pricing.currency)
  if (pricing.input !== undefined || pricing.output !== undefined) {
    const input = pricing.input !== undefined ? rate(pricing.input) : '?'
    const output = pricing.output !== undefined ? rate(pricing.output) : '?'
    parts.push(`${prefix}${input}/${output}`)
  }
  if (pricing.cacheRead !== undefined || pricing.cacheWrite !== undefined) {
    const read = pricing.cacheRead !== undefined ? rate(pricing.cacheRead) : '?'
    const write = pricing.cacheWrite !== undefined ? rate(pricing.cacheWrite) : '?'
    parts.push(`${prefix}${read}/${write} cache`)
  }
  if (pricing.discountPercent !== undefined && pricing.discountPercent > 0) {
    parts.push(`-${rate(pricing.discountPercent)}%`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}
