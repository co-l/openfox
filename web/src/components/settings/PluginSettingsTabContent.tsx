import { useEffect } from 'react'
import { usePluginUiStore } from '../../stores/pluginUi'
import { useCurrentProject } from '../../hooks/useCurrentProject'
import { DeclarativeRenderer } from '../plugins/DeclarativeRenderer'
import { invokePluginRpc } from '../../lib/plugin-actions'
import { applyPanelContent, extractScopedValues, nodeDeclarativeKey } from '../plugins/plugin-ui-utils'
import type { DeclarativeNode, PluginSettingsTab } from '@shared/plugin.js'

export function PluginSettingsTabContent({ tab }: { tab: PluginSettingsTab }) {
  const publishedValues = usePluginUiStore((state) => state.values)
  const project = useCurrentProject()
  const pluginId = tab.pluginId ?? 'unknown'
  const projectId = project?.id
  const projectWorkdir = project?.workdir

  useEffect(() => {
    if (!pluginId || pluginId === 'unknown') return
    let cancelled = false
    const refresh = async () => {
      try {
        const res = await invokePluginRpc(
          pluginId,
          'initPanel',
          { panelId: tab.id, tabId: tab.id },
          {
            ...(projectId ? { projectId } : {}),
            ...(projectWorkdir ? { workdir: projectWorkdir } : {}),
          },
        )
        if (!cancelled) {
          applyPanelContent(pluginId, tab.id, res)
        }
      } catch {
        // ignore
      }
    }
    void refresh()
    return () => {
      cancelled = true
    }
  }, [pluginId, tab.id, projectId, projectWorkdir])

  const values = extractScopedValues(publishedValues, pluginId, tab.id)

  const contentNodes = Array.isArray(values['content']) ? (values['content'] as DeclarativeNode[]) : tab.content

  return (
    <div className="space-y-3">
      {contentNodes.map((node, index) => (
        <DeclarativeRenderer
          key={nodeDeclarativeKey(node, index)}
          node={node}
          values={values}
          context={{ pluginId: tab.pluginId, tabId: tab.id }}
        />
      ))}
    </div>
  )
}
