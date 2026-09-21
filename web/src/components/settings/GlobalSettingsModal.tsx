import { ScrollArea } from '../shared/ScrollArea'
import { useEffect, useState } from 'react'
import { Modal } from '../shared/SelfContainedModal'
import { useT } from '../../hooks/useT'
import { NotificationSettings } from './NotificationSettings'
import { SkillsContent } from './SkillsModal'
import { InstructionsTab } from './tabs/InstructionsTab'
import { DisplayTab } from './tabs/DisplayTab'
import { AdvancedTab } from './tabs/AdvancedTab'
import { KeybindingsTab } from './tabs/KeybindingsTab'
import { ToolsTab } from './tabs/ToolsTab'
import { PluginsTab } from './tabs/PluginsTab'
import { useUpdateStore } from '../../stores/update'
import { wsClient } from '../../lib/ws'
import { PluginZone } from '../plugins/PluginZone'
import { PluginSettingsTabContent } from './PluginSettingsTabContent'
import { usePlugins } from '../../hooks/usePlugins'
import { useLocalizedString } from '../../hooks/useLocalizedString'

export type CoreTab =
  'instructions' | 'skills' | 'plugins' | 'notifications' | 'display' | 'keybindings' | 'advanced' | 'tools'

export type Tab = CoreTab | `plugin:${string}:${string}`

export const OPEN_SETTINGS_EVENT = 'open-global-settings'

export function openSettings(tab?: Tab) {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { tab } }))
}

interface GlobalSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  /** Tab to show when the modal opens. Defaults to 'instructions'. */
  initialTab?: Tab
}

export function GlobalSettingsModal({ isOpen, onClose, initialTab }: GlobalSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('instructions')
  const updateAvailable = useUpdateStore((state) => state.status === 'available')
  const { contributions } = usePlugins()
  const localize = useLocalizedString()
  const t = useT()

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab ?? 'instructions')
    }
  }, [isOpen, initialTab])

  const pluginTabs = [...(contributions.settingsTabs ?? [])].sort((a, b) => (a.order ?? 50) - (b.order ?? 50))
  const activePluginTab = pluginTabs.find((tab) => `plugin:${tab.pluginId}:${tab.id}` === activeTab)

  const tabs: { id: Tab; label: string; showDot?: boolean }[] = [
    { id: 'instructions', label: t({ en: 'Instructions', fr: 'Instructions' }) },
    { id: 'tools', label: t({ en: 'Tools', fr: 'Outils' }) },
    { id: 'skills', label: t({ en: 'Skills', fr: 'Compétences' }) },
    { id: 'plugins', label: t({ en: 'Plugins', fr: 'Plugins' }) },
    { id: 'notifications', label: t({ en: 'Notifications', fr: 'Notifications' }) },
    { id: 'display', label: t({ en: 'Display', fr: 'Affichage' }) },
    { id: 'keybindings', label: t({ en: 'Keybindings', fr: 'Raccourcis clavier' }) },
    { id: 'advanced', label: t({ en: 'Advanced', fr: 'Avancé' }), showDot: updateAvailable },
    ...pluginTabs.map((tab) => ({
      id: `plugin:${tab.pluginId}:${tab.id}` as Tab,
      label: localize(tab.label),
    })),
  ]

  const handleClose = () => {
    try {
      wsClient.send('context.checkDynamic', {})
    } catch {
      // WS might not be connected
    }
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t({ en: 'Settings', fr: 'Paramètres' })}
      size="xl"
      scrollable={false}
    >
      <div data-global-settings className="flex flex-col h-full min-h-0 -m-4">
        {/* Tab bar - always visible, horizontally scrollable on mobile */}
        <ScrollArea
          horizontal
          options={{ scrollbars: { visibility: 'hidden' } }}
          className="flex border-b border-border mb-4 flex-shrink-0 px-4 pt-4"
        >
          {tabs.map((tab) => (
            <TabButton
              key={tab.id}
              label={tab.label}
              active={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              showDot={tab.showDot}
            />
          ))}
        </ScrollArea>

        {/* Tab content - scrolls independently, scrollbar at modal edge */}
        <ScrollArea className="flex-1 min-h-0 px-4 pb-4">
          <PluginZone id="settings.content" context={{ tab: activeTab }}>
            {activeTab === 'instructions' && <InstructionsTab />}
            {activeTab === 'skills' && <SkillsContent isOpen={isOpen} />}
            {activeTab === 'plugins' && <PluginsTab />}
            {activeTab === 'notifications' && <NotificationSettings />}
            {activeTab === 'display' && <DisplayTab />}
            {activeTab === 'keybindings' && <KeybindingsTab />}
            {activeTab === 'tools' && <ToolsTab />}
            {activeTab === 'advanced' && <AdvancedTab onClose={onClose} />}
            {activePluginTab && <PluginSettingsTabContent tab={activePluginTab} />}
          </PluginZone>
        </ScrollArea>
      </div>
    </Modal>
  )
}

function TabButton({
  label,
  active,
  onClick,
  showDot,
}: {
  label: string
  active: boolean
  onClick: () => void
  showDot?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`relative px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        active
          ? 'border-accent-primary text-accent-primary'
          : 'border-transparent text-text-muted hover:text-text-secondary hover:border-border'
      }`}
    >
      {label}
      {showDot && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent-primary" />}
    </button>
  )
}
