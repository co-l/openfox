import { Component, useMemo, type ReactNode } from 'react'
import { usePlugins } from '../../hooks/usePlugins'
import { isContributionVisible, type PluginActionContext } from './plugin-ui-utils'
import { DeclarativeRenderer } from './DeclarativeRenderer'
import type { PluginUiComponent, PluginUiOverride, PluginZoneId } from '@shared/plugin.js'

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
      <DeclarativeRenderer node={comp.component} context={{ ...context, pluginId: comp.pluginId }} />
    </PluginErrorBoundary>
  )

  // Determine native/replaced content
  let mainContent: ReactNode = children

  if (override) {
    if (override.mode === 'hide') {
      mainContent = null
    } else if (override.mode === 'replace' && override.replacement) {
      mainContent = (
        <PluginErrorBoundary fallback={children}>
          <DeclarativeRenderer node={override.replacement} context={{ ...context, pluginId: override.pluginId }} />
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
