import { useState, useRef, useEffect, useMemo, type RefObject } from 'react'
import { CheckIcon, EditSmallIcon, EyeIcon, StarIcon, StarFilledIcon, WarningIcon } from '../shared/icons'
import type { Provider } from '../../stores/config'
import { isSmallContext } from '../../lib/context-warning'

export function formatContextWindow(context: number): string {
  if (context >= 1000000) return `${(context / 1000000).toFixed(1)}M`
  if (context >= 1000) return `${(context / 1000).toFixed(0)}K`
  return `${context}`
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
  return source.map((m) => ({
    id: m.id,
    ...(m.name !== undefined ? { name: m.name } : {}),
    contextWindow: m.contextWindow,
    source: m.source ?? 'default',
    ...(m.supportsVision !== undefined ? { supportsVision: m.supportsVision } : {}),
    ...(m.reasoningEfforts?.length ? { reasoningEfforts: m.reasoningEfforts } : {}),
    ...(m.reasoningEffortOverride ? { reasoningEffortOverride: m.reasoningEffortOverride } : {}),
    ...(m.thinkingLevel ? { thinkingLevel: m.thinkingLevel } : {}),
    ...(m.thinkingEnabled !== undefined ? { thinkingEnabled: m.thinkingEnabled } : {}),
  }))
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
  disabled?: boolean
  hasSession?: boolean
  settingDefault?: boolean
  onSetDefault?: (e: React.MouseEvent, providerId: string, modelId: string) => void
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
  disabled,
  hasSession,
  settingDefault,
  highlighted,
  onModelClick,
  onSetDefault,
  onEditModel,
  reasoningEfforts,
  selectedEffort,
  onSelectEffort,
}: ModelEntryRowProps) {
  const showEfforts = (reasoningEfforts?.length ?? 0) > 0 && !!onSelectEffort
  return (
    <div
      className={`${highlighted ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary'} ${disabled ? 'opacity-50 cursor-wait' : ''}`}
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
          className="flex-1 truncate text-left"
        >
          {modelConfig.name ?? modelConfig.id.split('/').pop()?.replace(/-/g, ' ') ?? modelConfig.id}
        </button>
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
          {modelConfig.supportsVision && (
            <span data-vision className="text-text-muted flex-shrink-0" title="Vision model" aria-label="Vision model">
              <EyeIcon className="w-3.5 h-3.5" />
            </span>
          )}
          <span className="text-xs text-text-muted">{formatContextWindow(modelConfig.contextWindow)}</span>
          {isSmallContext(modelConfig.contextWindow) && (
            <span
              data-small-context
              className="text-accent-warning"
              title="Small context window — agent prompts may be truncated by the provider"
            >
              <WarningIcon className="w-3.5 h-3.5" />
            </span>
          )}
          {hasSession && onSetDefault && (
            <button
              type="button"
              onClick={(e) => onSetDefault(e, providerId, modelConfig.id)}
              disabled={settingDefault}
              className="p-0.5 hover:bg-bg-tertiary rounded transition-colors disabled:opacity-40"
              title={isDef ? 'Default model' : 'Set as default model'}
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
              title="Edit model context"
            >
              <EditSmallIcon className="w-3 h-3 text-text-muted" />
            </button>
          )}
          {isActive && (
            <span className="text-accent-success flex-shrink-0" title="Session model">
              <CheckIcon className="w-3.5 h-3.5" />
            </span>
          )}
        </div>
      </div>
      {showEfforts && (
        <div
          className="flex flex-wrap items-center gap-1 px-4 pb-1.5"
          aria-label={`Reasoning efforts for ${modelConfig.id}`}
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
