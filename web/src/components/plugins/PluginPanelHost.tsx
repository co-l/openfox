import { useMemo } from 'react'
import { Modal } from '../shared/SelfContainedModal'
import { usePlugins } from '../../hooks/usePlugins'
import { useLocalizedString } from '../../hooks/useLocalizedString'
import { usePluginUiStore } from '../../stores/pluginUi'
import { getSessionToken } from '../../lib/api'
import { DeclarativeRenderer } from './DeclarativeRenderer'
import type { PluginActionContext } from './plugin-ui-utils'
import type { PluginUiPanel } from '@shared/plugin.js'

const PANEL_SIZES: Record<NonNullable<PluginUiPanel['size']>, 'sm' | 'md' | 'lg'> = {
  sm: 'sm',
  md: 'md',
  lg: 'lg',
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
            (candidate) => candidate.pluginId === activePanel.pluginId && candidate.id === activePanel.panelId,
          )
        : undefined,
    [activePanel, contributions.panels],
  )

  if (!activePanel || !panel) return null

  const context: PluginActionContext & { pluginId: string } = { pluginId: activePanel.pluginId }
  const values: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(publishedValues)) {
    const prefix = `${activePanel.pluginId}:${activePanel.panelId}:`
    if (key.startsWith(prefix)) values[key.slice(prefix.length)] = value
  }

  const iframeUrl =
    panel.kind === 'iframe' && panel.url
      ? `/api/plugins/${encodeURIComponent(activePanel.pluginId)}/assets/${panel.url.replace(/^\//, '')}${
          token ? `?token=${encodeURIComponent(token)}` : ''
        }`
      : undefined

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
          className="w-full h-[60vh] border border-border rounded bg-bg-primary"
          title={localize(panel.title)}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {(panel.content ?? []).map((node, index) => (
            <DeclarativeRenderer key={index} node={node} values={values} context={context} />
          ))}
        </div>
      )}
    </Modal>
  )
}
