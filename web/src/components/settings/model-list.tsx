import { useState, useRef, useEffect, useMemo, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import {
  CheckIcon,
  EditSmallIcon,
  EyeIcon,
  HeartIcon,
  HeartFilledIcon,
  StarIcon,
  StarFilledIcon,
  WarningIcon,
} from '../shared/icons'
import type { ModelPriceThresholds } from '../../hooks/useDisplaySettings'
import { useDisplaySettings } from '../../hooks/useDisplaySettings'
import type { Provider } from '../../stores/config'
import type { ModelPricing } from '@shared/types.js'
import { formatPriceValue, type PriceCurrency } from '@shared/stats-view.js'
import { isSmallContext } from '../../lib/context-warning'
import { formatRelativePricingDate } from '../../lib/format-date'
import { useT } from '../../hooks/useT'

export function formatContextWindow(context: number): string {
  if (context >= 1000000) return `${(context / 1000000).toFixed(1)}M`
  if (context >= 1000) return `${(context / 1000).toFixed(0)}K`
  return `${context}`
}

export function formatDiscountBadge(discount: number | string): string {
  if (typeof discount === 'number') {
    return `${discount}% off`
  }
  const trimmed = discount.trim()
  if (trimmed.toLowerCase().includes('off')) {
    return trimmed
  }
  const clean = trimmed.endsWith('%') ? trimmed.slice(0, -1).trim() : trimmed
  return `${clean}% off`
}

export function parseDiscountPercentage(discount?: number | string): number | null {
  if (discount === undefined || discount === null) return null
  if (typeof discount === 'number') {
    return discount > 0 && discount < 100 ? discount : null
  }
  const match = String(discount).match(/(\d+(?:\.\d+)?)/)
  if (!match || !match[1]) return null
  const num = parseFloat(match[1])
  return !isNaN(num) && num > 0 && num < 100 ? num : null
}

export function calculateDiscountedPrice(price: number, discountPercent: number): number {
  const discounted = price * (1 - discountPercent / 100)
  return Number(discounted.toPrecision(4))
}

export interface PricePart {
  label: string
  price: number
  tier: 'low' | 'medium' | 'high'
  formatted: string
}

export function getPriceTier(price: number, thresholds?: { low: number; medium: number }): 'low' | 'medium' | 'high' {
  if (!thresholds) return 'low'
  if (price <= thresholds.low) return 'low'
  if (price <= thresholds.medium) return 'medium'
  return 'high'
}

export function getPriceTierColor(tier: 'low' | 'medium' | 'high', enabled = true): string {
  if (!enabled) return 'text-text-muted'
  switch (tier) {
    case 'low':
      return 'text-accent-success'
    case 'medium':
      return 'text-accent-warning'
    case 'high':
      return 'text-accent-error'
  }
}

export function formatSublinePriceValue(value: number, currency: PriceCurrency = 'usd'): string {
  const suffix = currency === 'tokens' ? ' tk/M' : '/M'
  switch (currency) {
    case 'usd':
      return `$${value}${suffix}`
    case 'eur':
      return `${value} €${suffix}`
    case 'tokens':
      return `${value}${suffix}`
  }
}

export function getEffectiveModelCurrency(
  pricing?: ModelPricing,
  globalCurrency: PriceCurrency = 'usd',
): PriceCurrency {
  return (pricing?.currency as PriceCurrency | undefined) ?? globalCurrency
}

export function getGranularPriceParts(
  pricing: ModelPricing | undefined,
  options: {
    showInput?: boolean
    showOutput?: boolean
    showCacheRead?: boolean
    showCacheWrite?: boolean
  },
  thresholds?: ModelPriceThresholds,
  fallbackCurrency: PriceCurrency = 'usd',
): PricePart[] {
  if (!pricing) return []
  const currency = getEffectiveModelCurrency(pricing, fallbackCurrency)
  const discountPercent = parseDiscountPercentage(pricing.discount)
  const parts: PricePart[] = []

  if (options.showInput && pricing.input !== undefined) {
    const discounted =
      discountPercent !== null ? calculateDiscountedPrice(pricing.input, discountPercent) : pricing.input
    const tier = getPriceTier(discounted, thresholds?.input)
    parts.push({
      label: 'In',
      price: discounted,
      tier,
      formatted: `In: ${formatSublinePriceValue(discounted, currency)}`,
    })
  }

  if (options.showOutput && pricing.output !== undefined) {
    const discounted =
      discountPercent !== null ? calculateDiscountedPrice(pricing.output, discountPercent) : pricing.output
    const tier = getPriceTier(discounted, thresholds?.output)
    parts.push({
      label: 'Out',
      price: discounted,
      tier,
      formatted: `Out: ${formatSublinePriceValue(discounted, currency)}`,
    })
  }

  if (options.showCacheRead && pricing.cacheRead !== undefined) {
    const discounted =
      discountPercent !== null ? calculateDiscountedPrice(pricing.cacheRead, discountPercent) : pricing.cacheRead
    const tier = getPriceTier(discounted, thresholds?.cacheRead)
    parts.push({
      label: 'Cache R',
      price: discounted,
      tier,
      formatted: `Cache R: ${formatSublinePriceValue(discounted, currency)}`,
    })
  }

  if (options.showCacheWrite && pricing.cacheWrite !== undefined) {
    const discounted =
      discountPercent !== null ? calculateDiscountedPrice(pricing.cacheWrite, discountPercent) : pricing.cacheWrite
    const tier = getPriceTier(discounted, thresholds?.cacheWrite)
    parts.push({
      label: 'Cache W',
      price: discounted,
      tier,
      formatted: `Cache W: ${formatSublinePriceValue(discounted, currency)}`,
    })
  }

  return parts
}

export function formatGranularPriceSubline(
  pricing: ModelPricing | undefined,
  options: {
    showInput?: boolean
    showOutput?: boolean
    showCacheRead?: boolean
    showCacheWrite?: boolean
  },
  thresholds?: ModelPriceThresholds,
  currency: PriceCurrency = 'usd',
): string | null {
  const parts = getGranularPriceParts(pricing, options, thresholds, currency)
  return parts.length > 0 ? parts.map((p) => p.formatted).join(' · ') : null
}

export function formatPricingSummary(pricing?: ModelPricing, currency: PriceCurrency = 'usd'): string | null {
  if (!pricing) return null
  const effectiveCurrency = (pricing.currency as PriceCurrency | undefined) ?? currency
  const discountPercent = parseDiscountPercentage(pricing.discount)
  const hasInput = pricing.input !== undefined
  const hasOutput = pricing.output !== undefined
  const inputPrice = hasInput
    ? discountPercent !== null
      ? calculateDiscountedPrice(pricing.input!, discountPercent)
      : pricing.input
    : undefined
  const outputPrice = hasOutput
    ? discountPercent !== null
      ? calculateDiscountedPrice(pricing.output!, discountPercent)
      : pricing.output
    : undefined

  if (inputPrice !== undefined && outputPrice !== undefined) {
    return `in ${formatPriceValue(inputPrice, effectiveCurrency, false)} / out ${formatPriceValue(outputPrice, effectiveCurrency, false)}`
  }
  if (inputPrice !== undefined) {
    return `in ${formatPriceValue(inputPrice, effectiveCurrency, false)}`
  }
  if (outputPrice !== undefined) {
    return `out ${formatPriceValue(outputPrice, effectiveCurrency, false)}`
  }
  if (pricing.cacheRead !== undefined) {
    const cachePrice =
      discountPercent !== null ? calculateDiscountedPrice(pricing.cacheRead, discountPercent) : pricing.cacheRead
    return `cache ${formatPriceValue(cachePrice, effectiveCurrency, false)}`
  }
  return null
}

export function formatPricingTooltip(pricing?: ModelPricing, currency: PriceCurrency = 'usd'): string | undefined {
  if (!pricing) return undefined
  const discountPercent = parseDiscountPercentage(pricing.discount)
  const lines: string[] = []
  if (pricing.discount !== undefined) {
    const d = typeof pricing.discount === 'number' ? `${pricing.discount}% off` : pricing.discount
    lines.push(`Discount: ${d}`)
  }
  if (pricing.input !== undefined) {
    if (discountPercent !== null) {
      const discounted = calculateDiscountedPrice(pricing.input, discountPercent)
      lines.push(`Input: ${formatPriceValue(discounted, currency)} (was ${formatPriceValue(pricing.input, currency)})`)
    } else {
      lines.push(`Input: ${formatPriceValue(pricing.input, currency)}`)
    }
  }
  if (pricing.output !== undefined) {
    if (discountPercent !== null) {
      const discounted = calculateDiscountedPrice(pricing.output, discountPercent)
      lines.push(
        `Output: ${formatPriceValue(discounted, currency)} (was ${formatPriceValue(pricing.output, currency)})`,
      )
    } else {
      lines.push(`Output: ${formatPriceValue(pricing.output, currency)}`)
    }
  }
  if (pricing.cacheRead !== undefined) {
    if (discountPercent !== null) {
      const discounted = calculateDiscountedPrice(pricing.cacheRead, discountPercent)
      lines.push(
        `Cache read: ${formatPriceValue(discounted, currency)} (was ${formatPriceValue(pricing.cacheRead, currency)})`,
      )
    } else {
      lines.push(`Cache read: ${formatPriceValue(pricing.cacheRead, currency)}`)
    }
  }
  if (pricing.cacheWrite !== undefined) {
    if (discountPercent !== null) {
      const discounted = calculateDiscountedPrice(pricing.cacheWrite, discountPercent)
      lines.push(
        `Cache write: ${formatPriceValue(discounted, currency)} (was ${formatPriceValue(pricing.cacheWrite, currency)})`,
      )
    } else {
      lines.push(`Cache write: ${formatPriceValue(pricing.cacheWrite, currency)}`)
    }
  }
  if (pricing.lastUpdatedAt) {
    lines.push(`Last updated: ${formatRelativePricingDate(pricing.lastUpdatedAt)}`)
  }
  return lines.length > 0 ? lines.join('\n') : undefined
}

export interface ModelWithConfig {
  id: string
  name?: string
  contextWindow: number
  source: 'backend' | 'user' | 'default'
  supportsVision?: boolean
  reasoningEfforts?: string[]
  reasoningEffortOverride?: string
  thinkingLevel?: string
  thinkingEnabled?: boolean
  pricing?: ModelPricing
}

export function modelMatchesQuery(model: { name?: string; id: string }, query: string): boolean {
  const q = query.toLowerCase()
  const name = (model.name ?? '').toLowerCase()
  const id = model.id.toLowerCase()
  const idDisplay = id.replace(/-/g, ' ')
  return name.includes(q) || id.includes(q) || idDisplay.includes(q)
}

export function getVisibleModels(provider: Provider): ModelWithConfig[] {
  const hasSelected = provider.models.some((m) => m.selected)
  const source = hasSelected ? provider.models.filter((m) => m.selected) : provider.models
  return source.map((m) => {
    // A merged mode model exposes its levels via `modes`; surface them as
    // reasoning efforts so the picker renders mode chips.
    const reasoningEfforts = m.reasoningEfforts?.length
      ? m.reasoningEfforts
      : m.modes?.length
        ? m.modes.map((mode) => mode.level)
        : undefined
    return {
      id: m.id,
      ...(m.name !== undefined ? { name: m.name } : {}),
      contextWindow: m.contextWindow,
      source: m.source ?? 'default',
      ...(m.supportsVision !== undefined ? { supportsVision: m.supportsVision } : {}),
      ...(reasoningEfforts?.length ? { reasoningEfforts } : {}),
      ...(m.reasoningEffortOverride ? { reasoningEffortOverride: m.reasoningEffortOverride } : {}),
      ...(m.thinkingLevel ? { thinkingLevel: m.thinkingLevel } : {}),
      ...(m.thinkingEnabled !== undefined ? { thinkingEnabled: m.thinkingEnabled } : {}),
      ...(m.pricing ? { pricing: m.pricing } : {}),
    }
  })
}

// ============================================================================
// ModelEntryRow
// ============================================================================

export interface ModelEntryRowProps {
  providerId: string
  modelConfig: ModelWithConfig
  isActive: boolean
  highlighted: boolean
  onModelClick: (providerId: string, modelId: string) => void
  isDefault?: boolean
  isFavorite?: boolean
  disabled?: boolean
  hasSession?: boolean
  settingDefault?: boolean
  onSetDefault?: (e: React.MouseEvent, providerId: string, modelId: string) => void
  onToggleFavorite?: (e: React.MouseEvent, providerId: string, modelId: string) => void
  onEditModel?: (providerId: string, model: ModelWithConfig) => void
  /** Available reasoning efforts for this model (shown as compact chips). */
  reasoningEfforts?: string[]
  /** Currently effective effort for this model (override/session/default). */
  selectedEffort?: string
  onSelectEffort?: (providerId: string, modelId: string, effort: string) => void
}

export function ModelEntryRow({
  providerId,
  modelConfig,
  isActive,
  isDefault: isDef,
  isFavorite,
  disabled,
  hasSession,
  settingDefault,
  highlighted,
  onModelClick,
  onSetDefault,
  onToggleFavorite,
  onEditModel,
  reasoningEfforts,
  selectedEffort,
  onSelectEffort,
}: ModelEntryRowProps) {
  const t = useT()
  const showEfforts = (reasoningEfforts?.length ?? 0) > 0 && !!onSelectEffort
  const displaySettings = useDisplaySettings()
  const modelCurrency = getEffectiveModelCurrency(modelConfig.pricing, displaySettings.modelPriceCurrency)
  const currencyThresholds =
    displaySettings.multiCurrencyPriceThresholds?.[modelCurrency] ?? displaySettings.modelPriceThresholds
  const priceParts = displaySettings.showModelPrices
    ? getGranularPriceParts(
        modelConfig.pricing,
        {
          showInput: displaySettings.showModelPriceInput,
          showOutput: displaySettings.showModelPriceOutput,
          showCacheRead: displaySettings.showModelPriceCacheRead,
          showCacheWrite: displaySettings.showModelPriceCacheWrite,
        },
        currencyThresholds,
        modelCurrency,
      )
    : []
  const [showPopover, setShowPopover] = useState(false)
  const [popoverCoords, setPopoverCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const rowRef = useRef<HTMLDivElement>(null)

  const handleMouseEnter = (e: React.MouseEvent) => {
    if (modelConfig.pricing && displaySettings.showModelPricePopover) {
      // Find the dropdown container to place the popover to its right,
      // or fall back to the row rect.
      const dropdown = (e.currentTarget as HTMLElement).closest('[data-dropdown-container]') as HTMLElement | null
      const targetRect = dropdown ? dropdown.getBoundingClientRect() : (rowRef.current?.getBoundingClientRect() ?? null)
      const rowRect = rowRef.current?.getBoundingClientRect()
      if (targetRect && rowRect) {
        // If placing to the right overflows the viewport, place it to the left of the dropdown
        const spaceOnRight = window.innerWidth - targetRect.right
        const popoverWidth = 200 // estimated popover width
        const left =
          spaceOnRight > popoverWidth ? targetRect.right + 8 : Math.max(8, targetRect.left - popoverWidth - 8)
        setPopoverCoords({
          top: rowRect.top,
          left,
        })
        setShowPopover(true)
      }
    }
  }

  const handleMouseLeave = () => {
    setShowPopover(false)
  }

  const outputPriceDiscounted =
    modelConfig.pricing?.output !== undefined
      ? parseDiscountPercentage(modelConfig.pricing.discount) !== null
        ? calculateDiscountedPrice(modelConfig.pricing.output, parseDiscountPercentage(modelConfig.pricing.discount)!)
        : modelConfig.pricing.output
      : undefined
  const outputPriceTier =
    outputPriceDiscounted !== undefined ? getPriceTier(outputPriceDiscounted, currencyThresholds?.output) : undefined
  const modelNameColorClass =
    displaySettings.colorModelNameByOutputPrice && outputPriceTier
      ? getPriceTierColor(outputPriceTier, displaySettings.enableModelPriceColors)
      : ''

  return (
    <div
      ref={rowRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`relative ${highlighted ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary'} ${disabled ? 'opacity-50 cursor-wait' : ''}`}
    >
      <div
        className={`flex items-center px-4 py-1.5 text-sm transition-colors group ${
          isActive ? 'text-accent-primary' : 'text-text-secondary'
        }`}
      >
        <button
          type="button"
          onClick={() => onModelClick(providerId, modelConfig.id)}
          disabled={disabled}
          className={`flex-1 min-w-0 text-left truncate ${modelNameColorClass}`}
        >
          {modelConfig.name ?? modelConfig.id.split('/').pop()?.replace(/-/g, ' ') ?? modelConfig.id}
          {modelConfig.pricing?.discount !== undefined && (
            <span
              data-pricing-discount-badge
              className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium leading-none rounded bg-accent-primary/15 text-accent-primary border border-accent-primary/30 shrink-0 ml-1.5 align-middle"
            >
              {formatDiscountBadge(modelConfig.pricing.discount)}
            </span>
          )}
          {priceParts.length > 0 && (
            <div
              data-pricing-subline
              className="text-[11px] font-mono flex items-center gap-1.5 whitespace-nowrap overflow-hidden text-ellipsis mt-0.5"
            >
              {priceParts.map((part, index) => (
                <span key={part.label} className="inline-flex items-center shrink-0">
                  <span className={getPriceTierColor(part.tier, displaySettings.enableModelPriceColors)}>
                    {part.formatted}
                  </span>
                  {index < priceParts.length - 1 && <span className="text-text-muted ml-1.5">·</span>}
                </span>
              ))}
            </div>
          )}
        </button>
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
          {modelConfig.supportsVision && (
            <span
              data-vision
              className="text-text-muted flex-shrink-0"
              title={t({ en: 'Vision model', fr: 'Modèle vision' })}
              aria-label={t({ en: 'Vision model', fr: 'Modèle vision' })}
            >
              <EyeIcon className="w-3.5 h-3.5" />
            </span>
          )}
          <span className="text-xs text-text-muted">{formatContextWindow(modelConfig.contextWindow)}</span>
          {isSmallContext(modelConfig.contextWindow) && (
            <span
              data-small-context
              className="text-accent-warning"
              title={t({
                en: 'Small context window — agent prompts may be truncated by the provider',
                fr: 'Fenêtre de contexte réduite — les invites de l’agent peuvent être tronquées par le fournisseur',
              })}
            >
              <WarningIcon className="w-3.5 h-3.5" />
            </span>
          )}
          {onToggleFavorite && (
            <button
              type="button"
              onClick={(e) => onToggleFavorite(e, providerId, modelConfig.id)}
              disabled={disabled}
              className="p-0.5 hover:bg-bg-tertiary rounded transition-colors"
              title={
                isFavorite
                  ? t({ en: 'Remove from favorites', fr: 'Retirer des favoris' })
                  : t({ en: 'Add to favorites', fr: 'Ajouter aux favoris' })
              }
            >
              {isFavorite ? (
                <HeartFilledIcon className="w-3.5 h-3.5 text-rose-500" />
              ) : (
                <HeartIcon className="w-3.5 h-3.5 text-text-muted hover:text-rose-500" />
              )}
            </button>
          )}
          {hasSession && onSetDefault && (
            <button
              type="button"
              onClick={(e) => onSetDefault(e, providerId, modelConfig.id)}
              disabled={settingDefault}
              className="p-0.5 hover:bg-bg-tertiary rounded transition-colors disabled:opacity-40"
              title={
                isDef
                  ? t({ en: 'Default model', fr: 'Modèle par défaut' })
                  : t({ en: 'Set as default model', fr: 'Définir comme modèle par défaut' })
              }
            >
              {isDef ? (
                <StarFilledIcon className="w-3.5 h-3.5 text-accent-warning" />
              ) : (
                <StarIcon className="w-3.5 h-3.5 text-text-muted hover:text-accent-warning" />
              )}
            </button>
          )}
          {onEditModel && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onEditModel(providerId, modelConfig)
              }}
              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-bg-tertiary rounded transition-opacity"
              title={t({ en: 'Edit model context', fr: 'Modifier le contexte du modèle' })}
            >
              <EditSmallIcon className="w-3 h-3 text-text-muted" />
            </button>
          )}
          {isActive && (
            <span
              className="text-accent-success flex-shrink-0"
              title={t({ en: 'Session model', fr: 'Modèle de session' })}
            >
              <CheckIcon className="w-3.5 h-3.5" />
            </span>
          )}
        </div>
      </div>
      {showEfforts && (
        <div
          className="flex flex-wrap items-center gap-1 px-4 pb-1.5"
          aria-label={t({
            en: `Reasoning efforts for ${modelConfig.id}`,
            fr: `Niveaux de raisonnement pour ${modelConfig.id}`,
          })}
        >
          {reasoningEfforts!.map((effort) => {
            const isEffortActive = selectedEffort === effort
            return (
              <button
                key={effort}
                type="button"
                onClick={() => onSelectEffort!(providerId, modelConfig.id, effort)}
                disabled={disabled}
                className={`text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ${
                  isEffortActive
                    ? 'text-accent-primary border-accent-primary/50 bg-accent-primary/10'
                    : 'text-text-muted border-border hover:text-text-primary hover:border-text-muted'
                }`}
              >
                {effort}
              </button>
            )
          })}
        </div>
      )}
      {showPopover &&
        displaySettings.showModelPricePopover &&
        modelConfig.pricing &&
        createPortal(
          <div
            data-pricing-popover
            className="fixed z-[9999] px-3 py-2 bg-bg-secondary border border-border rounded-lg shadow-xl text-xs space-y-1 pointer-events-none whitespace-nowrap"
            style={{
              top: `${popoverCoords.top}px`,
              left: `${popoverCoords.left}px`,
            }}
          >
            <div className="font-medium text-text-primary pb-0.5 border-b border-border/50 flex items-center justify-between gap-2">
              <span>{modelConfig.name ?? modelConfig.id}</span>
              {modelConfig.pricing.discount !== undefined && (
                <span className="px-1.5 py-0.5 text-[9px] font-medium leading-none rounded bg-accent-primary/15 text-accent-primary border border-accent-primary/30">
                  {formatDiscountBadge(modelConfig.pricing.discount)}
                </span>
              )}
            </div>
            {modelConfig.pricing.input !== undefined && (
              <div className="text-text-secondary flex justify-between gap-3">
                <span>{t({ en: 'Input:', fr: 'Entrée :' })}</span>
                <span className="font-mono text-text-primary">
                  {parseDiscountPercentage(modelConfig.pricing.discount) !== null ? (
                    <>
                      <span className="line-through text-text-muted mr-1.5">
                        {formatPriceValue(modelConfig.pricing.input, modelCurrency, false)}
                      </span>
                      <span
                        className={getPriceTierColor(
                          getPriceTier(
                            calculateDiscountedPrice(
                              modelConfig.pricing.input,
                              parseDiscountPercentage(modelConfig.pricing.discount)!,
                            ),
                            currencyThresholds?.input,
                          ),
                          displaySettings.enableModelPriceColors,
                        )}
                      >
                        {formatPriceValue(
                          calculateDiscountedPrice(
                            modelConfig.pricing.input,
                            parseDiscountPercentage(modelConfig.pricing.discount)!,
                          ),
                          modelCurrency,
                        )}
                      </span>
                    </>
                  ) : (
                    <span
                      className={getPriceTierColor(
                        getPriceTier(modelConfig.pricing.input, currencyThresholds?.input),
                        displaySettings.enableModelPriceColors,
                      )}
                    >
                      {formatPriceValue(modelConfig.pricing.input, modelCurrency)}
                    </span>
                  )}
                </span>
              </div>
            )}
            {modelConfig.pricing.output !== undefined && (
              <div className="text-text-secondary flex justify-between gap-3">
                <span>{t({ en: 'Output:', fr: 'Sortie :' })}</span>
                <span className="font-mono text-text-primary">
                  {parseDiscountPercentage(modelConfig.pricing.discount) !== null ? (
                    <>
                      <span className="line-through text-text-muted mr-1.5">
                        {formatPriceValue(modelConfig.pricing.output, modelCurrency, false)}
                      </span>
                      <span
                        className={getPriceTierColor(
                          getPriceTier(
                            calculateDiscountedPrice(
                              modelConfig.pricing.output,
                              parseDiscountPercentage(modelConfig.pricing.discount)!,
                            ),
                            currencyThresholds?.output,
                          ),
                          displaySettings.enableModelPriceColors,
                        )}
                      >
                        {formatPriceValue(
                          calculateDiscountedPrice(
                            modelConfig.pricing.output,
                            parseDiscountPercentage(modelConfig.pricing.discount)!,
                          ),
                          modelCurrency,
                        )}
                      </span>
                    </>
                  ) : (
                    <span
                      className={getPriceTierColor(
                        getPriceTier(modelConfig.pricing.output, currencyThresholds?.output),
                        displaySettings.enableModelPriceColors,
                      )}
                    >
                      {formatPriceValue(modelConfig.pricing.output, modelCurrency)}
                    </span>
                  )}
                </span>
              </div>
            )}
            {modelConfig.pricing.cacheRead !== undefined && (
              <div className="text-text-secondary flex justify-between gap-3">
                <span>{t({ en: 'Cache read:', fr: 'Lecture cache :' })}</span>
                <span className="font-mono text-text-primary">
                  {parseDiscountPercentage(modelConfig.pricing.discount) !== null ? (
                    <>
                      <span className="line-through text-text-muted mr-1.5">
                        {formatPriceValue(modelConfig.pricing.cacheRead, modelCurrency, false)}
                      </span>
                      <span
                        className={getPriceTierColor(
                          getPriceTier(
                            calculateDiscountedPrice(
                              modelConfig.pricing.cacheRead,
                              parseDiscountPercentage(modelConfig.pricing.discount)!,
                            ),
                            currencyThresholds?.cacheRead,
                          ),
                          displaySettings.enableModelPriceColors,
                        )}
                      >
                        {formatPriceValue(
                          calculateDiscountedPrice(
                            modelConfig.pricing.cacheRead,
                            parseDiscountPercentage(modelConfig.pricing.discount)!,
                          ),
                          modelCurrency,
                        )}
                      </span>
                    </>
                  ) : (
                    <span
                      className={getPriceTierColor(
                        getPriceTier(modelConfig.pricing.cacheRead, currencyThresholds?.cacheRead),
                        displaySettings.enableModelPriceColors,
                      )}
                    >
                      {formatPriceValue(modelConfig.pricing.cacheRead, modelCurrency)}
                    </span>
                  )}
                </span>
              </div>
            )}
            {modelConfig.pricing.cacheWrite !== undefined && (
              <div className="text-text-secondary flex justify-between gap-3">
                <span>{t({ en: 'Cache write:', fr: 'Écriture cache :' })}</span>
                <span className="font-mono text-text-primary">
                  {parseDiscountPercentage(modelConfig.pricing.discount) !== null ? (
                    <>
                      <span className="line-through text-text-muted mr-1.5">
                        {formatPriceValue(modelConfig.pricing.cacheWrite, modelCurrency, false)}
                      </span>
                      <span
                        className={getPriceTierColor(
                          getPriceTier(
                            calculateDiscountedPrice(
                              modelConfig.pricing.cacheWrite,
                              parseDiscountPercentage(modelConfig.pricing.discount)!,
                            ),
                            currencyThresholds?.cacheWrite,
                          ),
                          displaySettings.enableModelPriceColors,
                        )}
                      >
                        {formatPriceValue(
                          calculateDiscountedPrice(
                            modelConfig.pricing.cacheWrite,
                            parseDiscountPercentage(modelConfig.pricing.discount)!,
                          ),
                          modelCurrency,
                        )}
                      </span>
                    </>
                  ) : (
                    <span
                      className={getPriceTierColor(
                        getPriceTier(modelConfig.pricing.cacheWrite, currencyThresholds?.cacheWrite),
                        displaySettings.enableModelPriceColors,
                      )}
                    >
                      {formatPriceValue(modelConfig.pricing.cacheWrite, modelCurrency)}
                    </span>
                  )}
                </span>
              </div>
            )}
            {modelConfig.pricing.lastUpdatedAt && (
              <div className="text-text-muted text-[10px] pt-1 border-t border-border/40 flex justify-between gap-3">
                <span>{t({ en: 'Updated:', fr: 'Mis à jour :' })}</span>
                <span>{formatRelativePricingDate(modelConfig.pricing.lastUpdatedAt)}</span>
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}

// ============================================================================
// useModelSearch hook
// ============================================================================

export interface UseModelSearchOptions {
  providers: Provider[]
  onSelect: (providerId: string, modelId: string) => void
  onEscape?: () => void
  /** Number of extra items after the model list (e.g. "Manage providers") */
  extraItemCount?: number
}

export interface UseModelSearchReturn {
  searchQuery: string
  setSearchQuery: (q: string) => void
  highlightedIndex: number
  setHighlightedIndex: (i: number) => void
  visibleGroups: Array<{ provider: Provider; models: ModelWithConfig[] }>
  flatItems: Array<{ providerId: string; modelConfig: ModelWithConfig }>
  totalNavItems: number
  handleSearchKeyDown: (e: React.KeyboardEvent) => void
  highlightedRef: RefObject<HTMLDivElement | null>
  inputRef: RefObject<HTMLInputElement | null>
}

export function useModelSearch({
  providers,
  onSelect,
  onEscape,
  extraItemCount = 0,
}: UseModelSearchOptions): UseModelSearchReturn {
  const [searchQuery, setSearchQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const highlightedRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Compute visible providers and their models, filtered by search query
  const visibleGroups = useMemo(() => {
    if (searchQuery.trim()) {
      return providers
        .map((p) => ({
          provider: p,
          models: getVisibleModels(p).filter((m) => modelMatchesQuery(m, searchQuery)),
        }))
        .filter((g) => g.models.length > 0)
    }
    return providers.map((p) => ({
      provider: p,
      models: getVisibleModels(p),
    }))
  }, [providers, searchQuery])

  // Flat list of all visible model items for keyboard navigation
  const flatItems = useMemo(
    () => visibleGroups.flatMap((g) => g.models.map((m) => ({ providerId: g.provider.id, modelConfig: m }))),
    [visibleGroups],
  )

  const totalNavItems = flatItems.length + extraItemCount

  // Auto-highlight first item when filtered results change, clamp otherwise
  useEffect(() => {
    if (totalNavItems <= 1) {
      setHighlightedIndex(-1)
    } else if (highlightedIndex >= totalNavItems) {
      setHighlightedIndex(totalNavItems - 1)
    } else if (highlightedIndex < 0 && searchQuery.trim()) {
      setHighlightedIndex(0)
    }
  }, [totalNavItems, highlightedIndex, searchQuery])

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && highlightedRef.current) {
      highlightedRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIndex])

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        onEscape?.()
        break
      case 'ArrowDown':
        e.preventDefault()
        if (totalNavItems > 0) {
          setHighlightedIndex((prev) => (prev < totalNavItems - 1 ? prev + 1 : 0))
        }
        break
      case 'ArrowUp':
        e.preventDefault()
        if (totalNavItems > 0) {
          setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : totalNavItems - 1))
        }
        break
      case 'Home':
        e.preventDefault()
        setHighlightedIndex(0)
        break
      case 'End':
        e.preventDefault()
        setHighlightedIndex(totalNavItems - 1)
        break
      case 'Enter':
        e.preventDefault()
        if (highlightedIndex >= 0 && highlightedIndex < flatItems.length) {
          const item = flatItems[highlightedIndex]
          if (item) {
            onSelect(item.providerId, item.modelConfig.id)
          }
        }
        break
    }
  }

  return {
    searchQuery,
    setSearchQuery,
    highlightedIndex,
    setHighlightedIndex,
    visibleGroups,
    flatItems,
    totalNavItems,
    handleSearchKeyDown,
    highlightedRef,
    inputRef,
  }
}
