import { useState } from 'react'
import { Modal } from '../shared/SelfContainedModal'
import { NotificationSettings } from './NotificationSettings'
import { SkillsContent } from './SkillsModal'
import { InstructionsTab } from './tabs/InstructionsTab'
import { DisplayTab } from './tabs/DisplayTab'
import { AdvancedTab } from './tabs/AdvancedTab'
import { KeybindingsTab } from './tabs/KeybindingsTab'
import { ToolsTab } from './tabs/ToolsTab'
import { wsClient } from '../../lib/ws'

interface GlobalSettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

type Tab = 'instructions' | 'skills' | 'notifications' | 'display' | 'keybindings' | 'advanced' | 'tools'

export function GlobalSettingsModal({ isOpen, onClose }: GlobalSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('instructions')

  const handleClose = () => {
    try {
      wsClient.send('context.checkDynamic', {})
    } catch {
      // WS might not be connected
    }
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Settings" size="xl" minHeight="500px">
      <div data-global-settings className="flex flex-col h-full">
        {/* Tab bar - horizontally scrollable on mobile */}
        <div className="flex border-b border-border mb-4 -mt-1 overflow-x-auto scrollbar-hide">
          <TabButton
            label="Instructions"
            active={activeTab === 'instructions'}
            onClick={() => setActiveTab('instructions')}
          />
          <TabButton label="Tools" active={activeTab === 'tools'} onClick={() => setActiveTab('tools')} />
          <TabButton label="Skills" active={activeTab === 'skills'} onClick={() => setActiveTab('skills')} />
          <TabButton
            label="Notifications"
            active={activeTab === 'notifications'}
            onClick={() => setActiveTab('notifications')}
          />
          <TabButton label="Display" active={activeTab === 'display'} onClick={() => setActiveTab('display')} />
          <TabButton
            label="Keybindings"
            active={activeTab === 'keybindings'}
            onClick={() => setActiveTab('keybindings')}
          />
          <TabButton label="Advanced" active={activeTab === 'advanced'} onClick={() => setActiveTab('advanced')} />
        </div>

        {/* Tab content */}
        {activeTab === 'instructions' && <InstructionsTab isOpen={isOpen} />}
        {activeTab === 'skills' && <SkillsContent isOpen={isOpen} />}
        {activeTab === 'notifications' && (
          <div className="max-h-[60vh] overflow-y-auto">
            <NotificationSettings />
          </div>
        )}
        {activeTab === 'display' && <DisplayTab />}
        {activeTab === 'keybindings' && <KeybindingsTab />}
        {activeTab === 'tools' && (
          <div className="max-h-[60vh] overflow-y-auto">
            <ToolsTab />
          </div>
        )}
        {activeTab === 'advanced' && <AdvancedTab onClose={onClose} />}
      </div>
    </Modal>
  )
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        active
          ? 'border-accent-primary text-accent-primary'
          : 'border-transparent text-text-muted hover:text-text-secondary hover:border-border'
      }`}
    >
      {label}
    </button>
  )
}
