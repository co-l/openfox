import { DeclarativeRenderer } from '../plugins/DeclarativeRenderer'
import type { PluginSettingsTab } from '@shared/plugin.js'

export function PluginSettingsTabContent({ tab }: { tab: PluginSettingsTab }) {
  return (
    <div className="space-y-3">
      {tab.content.map((node, index) => (
        <DeclarativeRenderer key={index} node={node} context={{ pluginId: tab.pluginId }} />
      ))}
    </div>
  )
}
