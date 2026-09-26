import { useEffect, useMemo } from 'react'
import { Modal } from '../shared/SelfContainedModal'
import { usePlugins } from '../../hooks/usePlugins'
import { useLocalizedString } from '../../hooks/useLocalizedString'
import { usePluginUiStore } from '../../stores/pluginUi'
import { getSessionToken } from '../../lib/api'
import { DeclarativeRenderer } from './DeclarativeRenderer'
import { invokePluginRpc } from '../../lib/plugin-actions'
import {
  applyPanelContent,
  extractScopedValues,
  nodeDeclarativeKey,
  pluginRpcContext,
  type PluginActionContext,
} from './plugin-ui-utils'
import type { DeclarativeNode, PluginUiPanel } from '@shared/plugin.js'

const PANEL_SIZES: Record<NonNullable<PluginUiPanel['size']>, 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | 'full'> = {
  sm: 'sm',
  md: 'md',
  lg: 'lg',
  xl: 'xl',
  '2xl': '2xl',
  '3xl': '3xl',
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

  const targetPluginId = panel?.pluginId && panel.pluginId !== 'unknown' ? panel.pluginId : activePanel?.pluginId

  useEffect(() => {
    if (!activePanel || !targetPluginId) return
    // The panel was opened by an action that already supplied its content —
    // an initPanel refresh here would clobber it (see ActivePluginPanel.skipInitPanel).
    if (activePanel.skipInitPanel) return
    let cancelled = false
    const refresh = async () => {
      try {
        const res = await invokePluginRpc(
          targetPluginId,
          'initPanel',
          { panelId: activePanel.panelId },
          pluginRpcContext(activePanel.context ?? {}),
        )
        if (!cancelled) {
          applyPanelContent(targetPluginId, activePanel.panelId, res)
        }
      } catch {
        // ignore
      }
    }
    void refresh()
    return () => {
      cancelled = true
    }
  }, [activePanel, targetPluginId])

  if (!activePanel || !panel || !targetPluginId) return null

  const panelContext = activePanel.context ?? {}
  const context: PluginActionContext & { pluginId: string } = { pluginId: targetPluginId, ...panelContext }
  const values = extractScopedValues(publishedValues, targetPluginId, activePanel.panelId)

  const iframeUrl = (() => {
    if (panel.kind !== 'iframe' || !panel.url) return undefined
    if (panel.url.startsWith('http://') || panel.url.startsWith('https://')) {
      return `/api/plugins/${encodeURIComponent(targetPluginId)}/proxy?url=${encodeURIComponent(panel.url)}`
    }
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
            <DeclarativeRenderer key={nodeDeclarativeKey(node, index)} node={node} values={values} context={context} />
          ))}
        </div>
      )}
    </Modal>
  )
}
