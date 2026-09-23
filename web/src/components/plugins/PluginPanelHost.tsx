import { useMemo } from 'react'
import { Modal } from '../shared/SelfContainedModal'
import { usePlugins } from '../../hooks/usePlugins'
import { useLocalizedString } from '../../hooks/useLocalizedString'
import { usePluginUiStore } from '../../stores/pluginUi'
import { getSessionToken } from '../../lib/api'
import { DeclarativeRenderer } from './DeclarativeRenderer'
import type { PluginActionContext } from './plugin-ui-utils'
import type { DeclarativeNode, PluginUiPanel } from '@shared/plugin.js'

const PANEL_SIZES: Record<NonNullable<PluginUiPanel['size']>, 'sm' | 'md' | 'lg' | 'xl' | 'full'> = {
  sm: 'sm',
  md: 'md',
  lg: 'lg',
  xl: 'xl',
  full: 'full',
}

export function PluginPanelHost() {
  const { contributions } = usePlugins()
  const activePanel = usePluginUiStore((state) => state.activePanel)
  const closePanel = usePluginUiStore((state) => state.closePanel)
  const publishedValues = usePluginUiStore((state) => state.values)
  const localize = useLocalizedString()
  const token = getSessionToken()

  const panel = useMemo(
    () =>
      activePanel
        ? contributions.panels.find(
            (candidate) =>
              candidate.id === activePanel.panelId &&
              (!candidate.pluginId || candidate.pluginId === 'unknown' || candidate.pluginId === activePanel.pluginId),
          )
        : undefined,
    [activePanel, contributions.panels],
  )

  if (!activePanel || !panel) return null

  const targetPluginId = panel.pluginId && panel.pluginId !== 'unknown' ? panel.pluginId : activePanel.pluginId
  const panelContext = activePanel.context ?? {}
  const context: PluginActionContext & { pluginId: string } = { pluginId: targetPluginId, ...panelContext }
  const values: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(publishedValues)) {
    const prefix = `${targetPluginId}:${activePanel.panelId}:`
    if (key.startsWith(prefix)) values[key.slice(prefix.length)] = value
  }

  const iframeUrl = (() => {
    if (panel.kind !== 'iframe' || !panel.url) return undefined
    const params = new URLSearchParams()
    if (token) params.set('token', token)
    if (panelContext.sessionId) params.set('sessionId', panelContext.sessionId)
    if (panelContext.projectId) params.set('projectId', panelContext.projectId)
    if (panelContext.workdir) params.set('workdir', panelContext.workdir)
    const query = params.toString()
    return `/api/plugins/${encodeURIComponent(targetPluginId)}/assets/${panel.url.replace(/^\//, '')}${
      query ? `?${query}` : ''
    }`
  })()

  const contentNodes = Array.isArray(values['content'])
    ? (values['content'] as DeclarativeNode[])
    : (panel.content ?? [])

  const handleClose = () => {
    usePluginUiStore.getState().clearPanel(activePanel.pluginId, activePanel.panelId)
    closePanel()
  }

  return (
    <Modal isOpen onClose={handleClose} size={PANEL_SIZES[panel.size ?? 'md']} title={localize(panel.title)}>
      {iframeUrl ? (
        <iframe
          src={iframeUrl}
          sandbox="allow-scripts allow-forms"
          className="w-full h-[78vh] border-0 rounded bg-bg-primary"
          title={localize(panel.title)}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {contentNodes.map((node, index) => (
            <DeclarativeRenderer
              key={`${index}-${node.type}-${node.type === 'card' && node.title ? node.title.en : ''}`}
              node={node}
              values={values}
              context={context}
            />
          ))}
        </div>
      )}
    </Modal>
  )
}
