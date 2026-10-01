import { Component, useEffect, useMemo, useState, type ReactNode } from 'react'
import { usePlugins } from '../../hooks/usePlugins'
import { extractScopedValues, isContributionVisible, type PluginActionContext } from './plugin-ui-utils'
import { invokePluginRpc } from '../../lib/plugin-actions'
import { DeclarativeRenderer } from './DeclarativeRenderer'
import { usePluginUiStore } from '../../stores/pluginUi'
import type {
  DeclarativeNode,
  PluginUiComponent,
  PluginUiContentSource,
  PluginUiOverride,
  PluginZoneId,
} from '@shared/plugin.js'

function contextString(context: PluginActionContext, key: string): string | undefined {
  const value = context[key]
  return typeof value === 'string' && value ? value : undefined
}

function contentFromResult(result: unknown): DeclarativeNode | undefined {
  if (!result || typeof result !== 'object') return undefined
  const body = result as { content?: unknown; nodes?: unknown }
  if (body.content && typeof body.content === 'object') return body.content as DeclarativeNode
  if (Array.isArray(body.nodes) && body.nodes.length > 0) {
    return { type: 'stack', direction: 'column', gap: 'sm', children: body.nodes as DeclarativeNode[] }
  }
  return undefined
}

/**
 * Resolve a contribution's node from its `contentSource` RPC, passing the zone
 * context so the plugin can render per-context (e.g. per provider) content. The
 * RPC is re-called on `refreshMs` while the contribution stays mounted; a
 * failing call keeps the last rendered content.
 */
function useContentSource(
  source: PluginUiContentSource | undefined,
  pluginId: string | undefined,
  itemId: string,
  context: PluginActionContext,
): DeclarativeNode | undefined {
  const [content, setContent] = useState<DeclarativeNode | undefined>(undefined)
  const method = source?.method
  const refreshMs = source?.refreshMs
  const providerId = contextString(context, 'providerId')
  const modelId = contextString(context, 'modelId')
  const tabId = contextString(context, 'tabId')
  const sessionId = contextString(context, 'sessionId')
  const workdir = contextString(context, 'workdir')
  const projectId = contextString(context, 'projectId')
  const projectName = contextString(context, 'projectName')

  useEffect(() => {
    if (!pluginId || pluginId === 'unknown' || !method) {
      setContent(undefined)
      return
    }
    let cancelled = false
    const params: Record<string, unknown> = { contributionId: itemId }
    if (providerId) params['providerId'] = providerId
    if (modelId) params['modelId'] = modelId
    if (tabId) params['tabId'] = tabId
    if (workdir) params['workdir'] = workdir
    if (projectName) params['projectName'] = projectName

    const load = async () => {
      try {
        const result = await invokePluginRpc(pluginId, method, params, {
          ...(sessionId ? { sessionId } : {}),
          ...(workdir ? { workdir } : {}),
          ...(projectId ? { projectId } : {}),
        })
        if (cancelled) return
        const node = contentFromResult(result)
        if (node !== undefined) setContent(node)
      } catch {
        // Keep the last rendered content — a failing source must not blank the zone.
      }
    }

    void load()
    if (!refreshMs || refreshMs <= 0) {
      return () => {
        cancelled = true
      }
    }
    const timer = window.setInterval(() => void load(), refreshMs)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [pluginId, method, itemId, refreshMs, providerId, modelId, tabId, sessionId, workdir, projectId, projectName])

  return content
}

function extractValuesWithSession(
  publishedValues: Record<string, unknown>,
  pluginId: string,
  itemId: string,
  sessionId?: string,
) {
  const values = extractScopedValues(publishedValues, pluginId, itemId)
  if (sessionId) {
    const sessionPrefix = `${pluginId}:${itemId}:${sessionId}:`
    for (const [k, v] of Object.entries(publishedValues)) {
      if (k.startsWith(sessionPrefix)) values[k.slice(sessionPrefix.length)] = v
    }
  }
  return values
}

function DynamicPluginComponent({ comp, context }: { comp: PluginUiComponent; context: PluginActionContext }) {
  const publishedValues = usePluginUiStore((state) => state.values)
  const pluginId = comp.pluginId ?? 'unknown'
  const values = extractValuesWithSession(publishedValues, pluginId, comp.id, context.sessionId)
  const sourced = useContentSource(comp.contentSource, comp.pluginId, comp.id, context)
  const node: DeclarativeNode = sourced ?? (values['content'] as DeclarativeNode) ?? comp.component

  return <DeclarativeRenderer node={node} values={values} context={{ ...context, pluginId: comp.pluginId }} />
}

function DynamicPluginOverride({
  override,
  fallback,
  context,
}: {
  override: PluginUiOverride
  fallback: ReactNode
  context: PluginActionContext
}) {
  const publishedValues = usePluginUiStore((state) => state.values)
  const pluginId = override.pluginId ?? 'unknown'
  const values = extractValuesWithSession(publishedValues, pluginId, override.id, context.sessionId)
  const sourced = useContentSource(override.contentSource, override.pluginId, override.id, context)

  // If the active panel or tab published updated content directly into state under pluginId or override.id, prioritize it
  const node: DeclarativeNode = sourced ?? (values['content'] as DeclarativeNode) ?? override.replacement

  if (!node) return <>{fallback}</>

  return (
    <DeclarativeRenderer
      node={node}
      values={values}
      context={{ ...context, pluginId: override.pluginId, tabId: override.id }}
    />
  )
}

interface ErrorBoundaryProps {
  fallback?: ReactNode
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

class PluginErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  override componentDidCatch(error: unknown) {
    console.error('PluginZone caught rendering error:', error)
  }

  override render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null
    }
    return this.props.children
  }
}

export interface PluginZoneProps {
  id: PluginZoneId
  context?: PluginActionContext
  children?: ReactNode
  className?: string
}

export function PluginZone({ id, context = {}, children, className }: PluginZoneProps) {
  const { contributions } = usePlugins()

  const { beforeComponents, insideComponents, afterComponents, override } = useMemo(() => {
    const rawComponents = contributions.components ?? []
    const components = rawComponents.filter(
      (comp: PluginUiComponent) => comp.zone === id && isContributionVisible(comp.visibleWhen, context),
    )

    // Sort components by order ascending (default 50)
    components.sort((a: PluginUiComponent, b: PluginUiComponent) => (a.order ?? 50) - (b.order ?? 50))

    const before: PluginUiComponent[] = []
    const inside: PluginUiComponent[] = []
    const after: PluginUiComponent[] = []

    for (const comp of components) {
      const pos = comp.position ?? 'inside'
      if (pos === 'before') before.push(comp)
      else if (pos === 'after') after.push(comp)
      else inside.push(comp)
    }

    const rawOverrides = contributions.overrides ?? []
    const overrides = rawOverrides.filter(
      (ov: PluginUiOverride) => ov.zone === id && isContributionVisible(ov.visibleWhen, context),
    )

    // Highest order override wins, sorted ascending so last is highest
    overrides.sort((a: PluginUiOverride, b: PluginUiOverride) => (a.order ?? 50) - (b.order ?? 50))
    const winningOverride = overrides.length > 0 ? overrides[overrides.length - 1] : undefined

    return {
      beforeComponents: before,
      insideComponents: inside,
      afterComponents: after,
      override: winningOverride,
    }
  }, [contributions.components, contributions.overrides, id, context])

  const renderComponent = (comp: PluginUiComponent) => (
    <PluginErrorBoundary key={`${comp.pluginId ?? 'unknown'}:${comp.id}`}>
      <DynamicPluginComponent comp={comp} context={context} />
    </PluginErrorBoundary>
  )

  // Determine native/replaced content
  let mainContent: ReactNode = children

  if (override) {
    if (override.mode === 'hide') {
      mainContent = null
    } else if (override.mode === 'replace' && (override.replacement || override.contentSource)) {
      mainContent = (
        <PluginErrorBoundary fallback={children}>
          <DynamicPluginOverride override={override} fallback={children} context={context} />
        </PluginErrorBoundary>
      )
    }
  }

  const hasAnyContent =
    beforeComponents.length > 0 || afterComponents.length > 0 || insideComponents.length > 0 || mainContent !== null

  if (!hasAnyContent) return null

  return (
    <div className={className} data-plugin-zone={id}>
      {beforeComponents.map(renderComponent)}
      {mainContent}
      {insideComponents.map(renderComponent)}
      {afterComponents.map(renderComponent)}
    </div>
  )
}
