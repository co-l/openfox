import { useEffect, useState } from 'react'
import { usePlugins } from '../../hooks/usePlugins'
import { useLocalizedString } from '../../hooks/useLocalizedString'
import { invokePluginRpc } from '../../lib/plugin-actions'
import { fetchBadgeValue, readBadgeCache } from '../../lib/plugin-badge-cache'
import {
  badgeToneClasses,
  isContributionVisible,
  pluginIcon,
  pluginRpcContext,
  type PluginActionContext,
} from './plugin-ui-utils'
import type { PluginBadgeTone, PluginUiBadge, PluginUiBadgeDynamicState } from '@shared/plugin.js'

const DEFAULT_BADGE_TTL_MS = 30_000
const MIN_REFRESH_MS = 250

interface ResolvedBadgeValue {
  key?: string
  loaded: boolean
  value?: string | number
  dynamic?: PluginUiBadgeDynamicState
}

function normalizeRpcValue(value: unknown, key: string): ResolvedBadgeValue {
  if (typeof value === 'string' || typeof value === 'number') {
    return { key, loaded: true, value }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { key, loaded: true, dynamic: value as PluginUiBadgeDynamicState }
  }
  return { key, loaded: true }
}

function badgeScopeKey(badge: PluginUiBadge, context: PluginActionContext): string {
  const fallback = context.sessionId ?? context.workdir ?? context.projectId ?? ''
  switch (badge.source?.cacheScope) {
    case 'session':
      return context.sessionId ?? fallback
    case 'workdir':
      return context.workdir ?? fallback
    case 'project':
      return context.projectId ?? fallback
    case 'context':
      return [context.sessionId ?? '', context.workdir ?? '', context.projectId ?? ''].join('|')
    default:
      // Preserve the v2 badge cache behavior for existing plugins.
      return fallback
  }
}

function iconToneClass(tone: PluginBadgeTone | undefined): string {
  switch (tone) {
    case 'info':
      return 'text-accent-primary'
    case 'success':
      return 'text-accent-success'
    case 'warning':
      return 'text-accent-warning'
    case 'danger':
      return 'text-accent-error'
    case 'neutral':
    default:
      return 'text-text-muted'
  }
}

function PluginBadgeView({ badge, context }: { badge: PluginUiBadge; context: PluginActionContext }) {
  const localize = useLocalizedString()
  const cacheKey =
    badge.pluginId && badge.source
      ? `${badge.pluginId}:${badge.source.method}:${badgeScopeKey(badge, context)}`
      : undefined
  const initialTtl = badge.source?.refreshMs ? Math.max(MIN_REFRESH_MS, badge.source.refreshMs) : DEFAULT_BADGE_TTL_MS
  const [resolved, setResolved] = useState<ResolvedBadgeValue>(() => {
    if (!cacheKey) return { loaded: badge.source === undefined, value: badge.value }
    const cached = readBadgeCache(cacheKey, initialTtl)
    return cached.hit ? normalizeRpcValue(cached.value, cacheKey) : { key: cacheKey, loaded: false, value: badge.value }
  })

  useEffect(() => {
    if (!badge.source || !badge.pluginId || !cacheKey) return
    let cancelled = false

    const load = (ttlMs: number) =>
      fetchBadgeValue(
        cacheKey,
        () => invokePluginRpc(badge.pluginId!, badge.source!.method, {}, pluginRpcContext(context)),
        ttlMs,
      )
        .then((result) => {
          if (!cancelled) setResolved(normalizeRpcValue(result, cacheKey))
        })
        .catch(() => undefined)

    const initialRefreshTtl = badge.source.refreshMs
      ? Math.max(MIN_REFRESH_MS, badge.source.refreshMs)
      : DEFAULT_BADGE_TTL_MS
    void load(initialRefreshTtl)

    const requestedRefreshMs = badge.source.refreshMs
    if (!requestedRefreshMs || requestedRefreshMs <= 0) {
      return () => {
        cancelled = true
      }
    }

    const refreshMs = Math.max(MIN_REFRESH_MS, requestedRefreshMs)
    const interval = window.setInterval(() => {
      // A zero TTL keeps the single-flight de-duplication but forces a fresh
      // value once the interval elapses.
      void load(0)
    }, refreshMs)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [
    badge.pluginId,
    badge.source,
    cacheKey,
    context.sessionId,
    context.workdir,
    context.projectId,
  ])

  const current: ResolvedBadgeValue =
    resolved.key === undefined || resolved.key === cacheKey ? resolved : { loaded: false }
  const dynamic = current.dynamic
  if (badge.source && !current.loaded && badge.value === undefined) return null
  if (dynamic?.visible === false) return null

  const tone = dynamic?.tone ?? badge.tone
  const label = localize(dynamic?.label ?? badge.label)
  const tooltip = localize(dynamic?.tooltip ?? badge.tooltip ?? dynamic?.label ?? badge.label)
  const value = dynamic?.value ?? current.value ?? badge.value
  const iconName = dynamic?.icon ?? badge.icon
  const Icon = iconName ? pluginIcon(iconName) : undefined

  if (badge.appearance === 'icon') {
    const accessibleLabel = tooltip || label
    return (
      <span
        role="img"
        aria-label={accessibleLabel || undefined}
        title={tooltip}
        data-testid="plugin-badge"
        className={`inline-flex items-center justify-center flex-shrink-0 ${iconToneClass(tone)}`}
      >
        {Icon ? <Icon className="w-3 h-3" /> : <span className="text-[10px] font-medium">{value ?? label}</span>}
      </span>
    )
  }

  const hasValue = value !== undefined && value !== ''
  const displayText = hasValue ? `${label}${label ? ' ' : ''}${String(value)}` : label

  return (
    <span
      title={tooltip}
      data-testid="plugin-badge"
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${badgeToneClasses(
        tone,
      )}`}
    >
      {Icon && <Icon className="w-3 h-3" />}
      {displayText}
    </span>
  )
}

export function PluginBadges({ slot, context }: { slot: PluginUiBadge['slot']; context: PluginActionContext }) {
  const { contributions } = usePlugins()
  const badges = contributions.badges.filter(
    (badge) => badge.slot === slot && isContributionVisible(badge.visibleWhen, context),
  )
  if (badges.length === 0) return null
  return (
    <>
      {badges.map((badge) => (
        <PluginBadgeView key={`${badge.pluginId}:${badge.id}`} badge={badge} context={context} />
      ))}
    </>
  )
}
