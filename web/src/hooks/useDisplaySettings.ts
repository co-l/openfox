import { SETTINGS_KEYS } from '../lib/resources'
import { useSetting } from './useSetting'

export interface ModelPriceThresholds {
  input: { low: number; medium: number }
  output: { low: number; medium: number }
  cacheRead: { low: number; medium: number }
  cacheWrite: { low: number; medium: number }
}

export interface MultiCurrencyPriceThresholds {
  usd: ModelPriceThresholds
  eur: ModelPriceThresholds
  tokens: ModelPriceThresholds
}

export const DEFAULT_USD_THRESHOLDS: ModelPriceThresholds = {
  input: { low: 0.5, medium: 2.0 },
  output: { low: 1.5, medium: 6.0 },
  cacheRead: { low: 0.1, medium: 0.5 },
  cacheWrite: { low: 0.5, medium: 2.0 },
}

export const DEFAULT_EUR_THRESHOLDS: ModelPriceThresholds = { ...DEFAULT_USD_THRESHOLDS }

export const DEFAULT_TOKENS_THRESHOLDS: ModelPriceThresholds = {
  input: { low: 50, medium: 250 },
  output: { low: 200, medium: 1000 },
  cacheRead: { low: 10, medium: 50 },
  cacheWrite: { low: 50, medium: 250 },
}

export const DEFAULT_PRICE_THRESHOLDS: MultiCurrencyPriceThresholds = {
  usd: DEFAULT_USD_THRESHOLDS,
  eur: DEFAULT_EUR_THRESHOLDS,
  tokens: DEFAULT_TOKENS_THRESHOLDS,
}

export function parseMultiCurrencyPriceThresholds(raw?: string): MultiCurrencyPriceThresholds {
  if (!raw) return DEFAULT_PRICE_THRESHOLDS
  try {
    const parsed = JSON.parse(raw) as Partial<MultiCurrencyPriceThresholds & ModelPriceThresholds>
    // Check if flat (old format)
    if (parsed.input && (parsed.input.low !== undefined || parsed.input.medium !== undefined)) {
      const flat = parsed as ModelPriceThresholds
      return {
        usd: {
          input: {
            low: flat.input?.low ?? DEFAULT_USD_THRESHOLDS.input.low,
            medium: flat.input?.medium ?? DEFAULT_USD_THRESHOLDS.input.medium,
          },
          output: {
            low: flat.output?.low ?? DEFAULT_USD_THRESHOLDS.output.low,
            medium: flat.output?.medium ?? DEFAULT_USD_THRESHOLDS.output.medium,
          },
          cacheRead: {
            low: flat.cacheRead?.low ?? DEFAULT_USD_THRESHOLDS.cacheRead.low,
            medium: flat.cacheRead?.medium ?? DEFAULT_USD_THRESHOLDS.cacheRead.medium,
          },
          cacheWrite: {
            low: flat.cacheWrite?.low ?? DEFAULT_USD_THRESHOLDS.cacheWrite.low,
            medium: flat.cacheWrite?.medium ?? DEFAULT_USD_THRESHOLDS.cacheWrite.medium,
          },
        },
        eur: DEFAULT_EUR_THRESHOLDS,
        tokens: DEFAULT_TOKENS_THRESHOLDS,
      }
    }

    return {
      usd: {
        input: {
          low: parsed.usd?.input?.low ?? DEFAULT_USD_THRESHOLDS.input.low,
          medium: parsed.usd?.input?.medium ?? DEFAULT_USD_THRESHOLDS.input.medium,
        },
        output: {
          low: parsed.usd?.output?.low ?? DEFAULT_USD_THRESHOLDS.output.low,
          medium: parsed.usd?.output?.medium ?? DEFAULT_USD_THRESHOLDS.output.medium,
        },
        cacheRead: {
          low: parsed.usd?.cacheRead?.low ?? DEFAULT_USD_THRESHOLDS.cacheRead.low,
          medium: parsed.usd?.cacheRead?.medium ?? DEFAULT_USD_THRESHOLDS.cacheRead.medium,
        },
        cacheWrite: {
          low: parsed.usd?.cacheWrite?.low ?? DEFAULT_USD_THRESHOLDS.cacheWrite.low,
          medium: parsed.usd?.cacheWrite?.medium ?? DEFAULT_USD_THRESHOLDS.cacheWrite.medium,
        },
      },
      eur: {
        input: {
          low: parsed.eur?.input?.low ?? DEFAULT_EUR_THRESHOLDS.input.low,
          medium: parsed.eur?.input?.medium ?? DEFAULT_EUR_THRESHOLDS.input.medium,
        },
        output: {
          low: parsed.eur?.output?.low ?? DEFAULT_EUR_THRESHOLDS.output.low,
          medium: parsed.eur?.output?.medium ?? DEFAULT_EUR_THRESHOLDS.output.medium,
        },
        cacheRead: {
          low: parsed.eur?.cacheRead?.low ?? DEFAULT_EUR_THRESHOLDS.cacheRead.low,
          medium: parsed.eur?.cacheRead?.medium ?? DEFAULT_EUR_THRESHOLDS.cacheRead.medium,
        },
        cacheWrite: {
          low: parsed.eur?.cacheWrite?.low ?? DEFAULT_EUR_THRESHOLDS.cacheWrite.low,
          medium: parsed.eur?.cacheWrite?.medium ?? DEFAULT_EUR_THRESHOLDS.cacheWrite.medium,
        },
      },
      tokens: {
        input: {
          low: parsed.tokens?.input?.low ?? DEFAULT_TOKENS_THRESHOLDS.input.low,
          medium: parsed.tokens?.input?.medium ?? DEFAULT_TOKENS_THRESHOLDS.input.medium,
        },
        output: {
          low: parsed.tokens?.output?.low ?? DEFAULT_TOKENS_THRESHOLDS.output.low,
          medium: parsed.tokens?.output?.medium ?? DEFAULT_TOKENS_THRESHOLDS.output.medium,
        },
        cacheRead: {
          low: parsed.tokens?.cacheRead?.low ?? DEFAULT_TOKENS_THRESHOLDS.cacheRead.low,
          medium: parsed.tokens?.cacheRead?.medium ?? DEFAULT_TOKENS_THRESHOLDS.cacheRead.medium,
        },
        cacheWrite: {
          low: parsed.tokens?.cacheWrite?.low ?? DEFAULT_TOKENS_THRESHOLDS.cacheWrite.low,
          medium: parsed.tokens?.cacheWrite?.medium ?? DEFAULT_TOKENS_THRESHOLDS.cacheWrite.medium,
        },
      },
    }
  } catch {
    return DEFAULT_PRICE_THRESHOLDS
  }
}

export function parsePriceThresholds(raw?: string): ModelPriceThresholds {
  return parseMultiCurrencyPriceThresholds(raw).usd
}

/**
 * Derived display preferences. Each value is its own setting key; before the
 * server answers, the documented default applies (matching the retired store).
 */
export function useDisplaySettings() {
  const modelPriceThresholdsRaw = useSetting(SETTINGS_KEYS.DISPLAY_MODEL_PRICE_THRESHOLDS).value

  return {
    showThinking: useSetting(SETTINGS_KEYS.DISPLAY_SHOW_THINKING, 'true').value === 'true',
    showVerboseToolOutput: useSetting(SETTINGS_KEYS.DISPLAY_SHOW_VERBOSE_TOOL_OUTPUT, 'true').value === 'true',
    showStats: useSetting(SETTINGS_KEYS.DISPLAY_SHOW_STATS, 'true').value === 'true',
    showAgentDefinitions: useSetting(SETTINGS_KEYS.DISPLAY_SHOW_AGENT_DEFINITIONS, 'true').value === 'true',
    showWorkflowBars: useSetting(SETTINGS_KEYS.DISPLAY_SHOW_WORKFLOW_BARS, 'true').value === 'true',
    showSyntaxHighlighting: useSetting(SETTINGS_KEYS.DISPLAY_SHOW_SYNTAX_HIGHLIGHTING, 'true').value === 'true',
    showModelPrices: useSetting(SETTINGS_KEYS.DISPLAY_SHOW_MODEL_PRICES, 'false').value === 'true',
    showModelPriceInput: useSetting(SETTINGS_KEYS.DISPLAY_SHOW_MODEL_PRICE_INPUT, 'true').value === 'true',
    showModelPriceOutput: useSetting(SETTINGS_KEYS.DISPLAY_SHOW_MODEL_PRICE_OUTPUT, 'true').value === 'true',
    showModelPriceCacheRead: useSetting(SETTINGS_KEYS.DISPLAY_SHOW_MODEL_PRICE_CACHE_READ, 'true').value === 'true',
    showModelPriceCacheWrite: useSetting(SETTINGS_KEYS.DISPLAY_SHOW_MODEL_PRICE_CACHE_WRITE, 'true').value === 'true',
    showModelPricePopover: useSetting(SETTINGS_KEYS.DISPLAY_SHOW_MODEL_PRICE_POPOVER, 'true').value === 'true',
    enableModelPriceColors: useSetting(SETTINGS_KEYS.DISPLAY_ENABLE_MODEL_PRICE_COLORS, 'true').value === 'true',
    colorModelNameByOutputPrice:
      useSetting(SETTINGS_KEYS.DISPLAY_COLOR_MODEL_NAME_BY_OUTPUT_PRICE, 'false').value === 'true',
    showModelPriceInBar: useSetting(SETTINGS_KEYS.DISPLAY_SHOW_MODEL_PRICE_IN_BAR, 'false').value === 'true',
    showModelPriceInBarInput: useSetting(SETTINGS_KEYS.DISPLAY_SHOW_MODEL_PRICE_IN_BAR_INPUT, 'true').value === 'true',
    showModelPriceInBarOutput:
      useSetting(SETTINGS_KEYS.DISPLAY_SHOW_MODEL_PRICE_IN_BAR_OUTPUT, 'true').value === 'true',
    showModelPriceInBarCacheRead:
      useSetting(SETTINGS_KEYS.DISPLAY_SHOW_MODEL_PRICE_IN_BAR_CACHE_READ, 'true').value === 'true',
    showModelPriceInBarCacheWrite:
      useSetting(SETTINGS_KEYS.DISPLAY_SHOW_MODEL_PRICE_IN_BAR_CACHE_WRITE, 'true').value === 'true',
    modelPriceCurrency: (useSetting(SETTINGS_KEYS.DISPLAY_MODEL_PRICE_CURRENCY, 'usd').value ?? 'usd') as
      'usd' | 'eur' | 'tokens',
    modelPriceThresholds: parsePriceThresholds(modelPriceThresholdsRaw),
    multiCurrencyPriceThresholds: parseMultiCurrencyPriceThresholds(modelPriceThresholdsRaw),
    maxVisibleItems: Number(useSetting(SETTINGS_KEYS.DISPLAY_MAX_VISIBLE_ITEMS, '300').value),
    useNativeScrollbars: useSetting(SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS, 'false').value === 'true',
    useNativeScrollbarsCodeBlocks:
      useSetting(SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS_CODE_BLOCKS, 'false').value === 'true',
    collapseLargeToolCalls: useSetting(SETTINGS_KEYS.DISPLAY_COLLAPSE_LARGE_TOOL_CALLS, 'false').value === 'true',
    deferCodeHighlightWhileStreaming:
      useSetting(SETTINGS_KEYS.DISPLAY_DEFER_CODE_HIGHLIGHT_WHILE_STREAMING, 'false').value === 'true',
    feedVirtualization: useSetting(SETTINGS_KEYS.DISPLAY_FEED_VIRTUALIZATION, 'false').value === 'true',
    modelSelectorHeight: useSetting(SETTINGS_KEYS.DISPLAY_MODEL_SELECTOR_HEIGHT, 'default').value || 'default',
    collapseProvidersByDefault:
      useSetting(SETTINGS_KEYS.DISPLAY_COLLAPSE_PROVIDERS_BY_DEFAULT, 'false').value === 'true',
    collapseFavoritesByDefault:
      useSetting(SETTINGS_KEYS.DISPLAY_COLLAPSE_FAVORITES_BY_DEFAULT, 'false').value === 'true',
    modelFavoritesRaw: useSetting(SETTINGS_KEYS.DISPLAY_MODEL_FAVORITES, '[]').value,
  }
}
