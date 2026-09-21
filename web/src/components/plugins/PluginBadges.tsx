import { useEffect, useState } from 'react'
import { usePlugins } from '../../hooks/usePlugins'
import { useLocalizedString } from '../../hooks/useLocalizedString'
import { invokePluginRpc } from '../../lib/plugin-actions'
import { fetchBadgeValue, readBadgeCache } from '../../lib/plugin-badge-cache'
import { badgeToneClasses, isContributionVisible, pluginRpcContext, type PluginActionContext } from './plugin-ui-utils'
import type { PluginUiBadge } from '@shared/plugin.js'

function PluginBadgeView({ badge, context }: { badge: PluginUiBadge; context: PluginActionContext }) {
  const localize = useLocalizedString()
  const cacheKey =
    badge.pluginId && badge.source
      ? `${badge.pluginId}:${badge.source.method}:${context.sessionId ?? context.workdir ?? ''}`
      : undefined
  const [value, setValue] = useState<string | undefined>(() => {
    if (badge.value !== undefined) return badge.value
    if (!cacheKey) return undefined
    const cached = readBadgeCache(cacheKey)
    return cached.hit ? String(cached.value) : undefined
  })

  useEffect(() => {
    if (!badge.source || !badge.pluginId || !cacheKey) return
    let cancelled = false
    void fetchBadgeValue(cacheKey, () =>
      invokePluginRpc(badge.pluginId!, badge.source!.method, {}, pluginRpcContext(context)),
    )
      .then((result) => {
        if (!cancelled && (typeof result === 'string' || typeof result === 'number')) setValue(String(result))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [badge.pluginId, badge.source, cacheKey, context.sessionId, context.workdir, context.projectId])

  const label = localize(badge.label)
  const tooltip = localize(badge.tooltip ?? badge.label)
  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${badgeToneClasses(
        badge.tone,
      )}`}
    >
      {value ? `${label} ${value}` : label}
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
