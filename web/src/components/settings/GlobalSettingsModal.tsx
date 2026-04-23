import { useState, useEffect } from 'react'
import { useLocation } from 'wouter'
import { Modal } from '../shared/SelfContainedModal'
import { Button } from '../shared/Button'
import { useSettingsStore, SETTINGS_KEYS } from '../../stores/settings'
import { NotificationSettings } from './NotificationSettings'
import { SkillsContent } from './SkillsModal'
import { KvCacheWarning } from '../shared/KvCacheWarning'

interface GlobalSettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

type Tab = 'instructions' | 'skills' | 'notifications' | 'display' | 'advanced'

export function GlobalSettingsModal({ isOpen, onClose }: GlobalSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('instructions')

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" size="xl" minHeight="500px">
      <div className="flex flex-col h-full">
        {/* Tab bar */}
        <div className="flex border-b border-border mb-4 -mt-1">
          <TabButton
            label="Instructions"
            active={activeTab === 'instructions'}
            onClick={() => setActiveTab('instructions')}
          />
          <TabButton
            label="Skills"
            active={activeTab === 'skills'}
            onClick={() => setActiveTab('skills')}
          />
          <TabButton
            label="Notifications"
            active={activeTab === 'notifications'}
            onClick={() => setActiveTab('notifications')}
          />
          <TabButton
            label="Display"
            active={activeTab === 'display'}
            onClick={() => setActiveTab('display')}
          />
          <TabButton
            label="Advanced"
            active={activeTab === 'advanced'}
            onClick={() => setActiveTab('advanced')}
          />
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
        {activeTab === 'advanced' && <AdvancedTab onClose={onClose} />}
      </div>
    </Modal>
  )
}

function AdvancedTab({ onClose }: { onClose: () => void }) {
  const [, navigate] = useLocation()

  function handleLaunchOnboarding() {
    onClose()
    navigate('/onboarding')
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-1">Onboarding</h3>
        <p className="text-sm text-text-muted mb-4">
          Reset your OpenFox setup and go through the initial configuration again.
        </p>
        <Button variant="secondary" onClick={handleLaunchOnboarding}>
          Launch Onboarding
        </Button>
      </div>
    </div>
  )
}

function ThemePicker() {
  const settings = useSettingsStore(state => state.settings)
  const setSetting = useSettingsStore(state => state.setSetting)

  const currentTheme = settings[SETTINGS_KEYS.DISPLAY_THEME] ?? 'dark'

  const handleThemeChange = async (theme: string) => {
    await setSetting(SETTINGS_KEYS.DISPLAY_THEME, theme)
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.classList.toggle('light', theme === 'light')
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-text-primary">Theme</h3>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => handleThemeChange('dark')}
          className={`flex-1 px-4 py-3 rounded-lg border transition-colors ${
            currentTheme === 'dark'
              ? 'border-accent-primary bg-bg-tertiary text-text-primary'
              : 'border-border bg-bg-secondary text-text-muted hover:border-text-muted'
          }`}
        >
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 rounded bg-[#0d1117] border border-[#30363d] flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-[#8b949e]" />
            </div>
            <span className="text-sm">Dark</span>
          </div>
        </button>
        <button
          type="button"
          onClick={() => handleThemeChange('light')}
          className={`flex-1 px-4 py-3 rounded-lg border transition-colors ${
            currentTheme === 'light'
              ? 'border-accent-primary bg-bg-tertiary text-text-primary'
              : 'border-border bg-bg-secondary text-text-muted hover:border-text-muted'
          }`}
        >
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 rounded bg-white border border-slate-200 flex items-center justify-center shadow-sm">
              <div className="w-3 h-3 rounded-full bg-slate-400" />
            </div>
            <span className="text-sm">Light</span>
          </div>
        </button>
      </div>
    </div>
  )
}

function DisplayTab() {
  const settings = useSettingsStore(state => state.settings)
  const loading = useSettingsStore(state => state.loading)
  const getSetting = useSettingsStore(state => state.getSetting)
  const setSetting = useSettingsStore(state => state.setSetting)

  const isLoading = loading[SETTINGS_KEYS.DISPLAY_SHOW_THINKING] ?? false

  useEffect(() => {
    getSetting(SETTINGS_KEYS.DISPLAY_THEME)
  }, [getSetting])

  const toggles = [
    { key: SETTINGS_KEYS.DISPLAY_SHOW_THINKING, label: 'Show thinking blocks', description: 'Display AI reasoning content in the feed' },
    { key: SETTINGS_KEYS.DISPLAY_SHOW_VERBOSE_TOOL_OUTPUT, label: 'Show expanded tool output', description: 'Always show full tool call details instead of compact view' },
    { key: SETTINGS_KEYS.DISPLAY_SHOW_STATS, label: 'Show stats bar', description: 'Display model, tokens, and timing information' },
    { key: SETTINGS_KEYS.DISPLAY_SHOW_AGENT_DEFINITIONS, label: 'Show agent definitions', description: 'Display agent definition injections in the feed' },
    { key: SETTINGS_KEYS.DISPLAY_SHOW_WORKFLOW_BARS, label: 'Show workflow bars', description: 'Display workflow start and end markers' },
  ] as const

  const localValues = Object.fromEntries(
    toggles.map(t => [t.key, settings[t.key] ?? 'true'])
  ) as Record<typeof toggles[number]['key'], string>
  const [local, setLocal] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(toggles.map(t => [t.key, localValues[t.key] === 'true']))
  )

  useEffect(() => {
    toggles.forEach(t => getSetting(t.key))
  }, [getSetting])

  useEffect(() => {
    setLocal(Object.fromEntries(toggles.map(t => [t.key, localValues[t.key] === 'true'])))
  }, [JSON.stringify(localValues)])

  const handleToggle = async (key: string) => {
    const newValue = String(!local[key as keyof typeof local])
    setLocal(prev => ({ ...prev, [key]: !prev[key as keyof typeof local] }))
    await setSetting(key, newValue)
  }

  if (isLoading) {
    return <div className="text-sm text-text-muted">Loading...</div>
  }

  return (
    <div className="space-y-6">
      <ThemePicker />
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-4">Feed Display</h3>
        <div className="space-y-4">
          {toggles.map(({ key, label, description }) => (
            <label key={key} className="flex items-center justify-between cursor-pointer">
              <div>
                <div className="text-sm text-text-primary">{label}</div>
                <div className="text-xs text-text-muted">{description}</div>
              </div>
              <button
                type="button"
                onClick={() => handleToggle(key)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  local[key] ? 'bg-accent-primary' : 'bg-bg-tertiary'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    local[key] ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-accent-primary text-accent-primary'
          : 'border-transparent text-text-muted hover:text-text-secondary hover:border-border'
      }`}
    >
      {label}
    </button>
  )
}

function InstructionsTab({ isOpen }: { isOpen: boolean }) {
  const settings = useSettingsStore(state => state.settings)
  const loading = useSettingsStore(state => state.loading)
  const getSetting = useSettingsStore(state => state.getSetting)
  const setSetting = useSettingsStore(state => state.setSetting)

  const globalInstructions = settings[SETTINGS_KEYS.GLOBAL_INSTRUCTIONS] ?? ''
  const isLoading = loading[SETTINGS_KEYS.GLOBAL_INSTRUCTIONS] ?? false

  const [localValue, setLocalValue] = useState(globalInstructions)
  const [isDirty, setIsDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen) {
      getSetting(SETTINGS_KEYS.GLOBAL_INSTRUCTIONS)
    }
  }, [isOpen, getSetting])

  useEffect(() => {
    setLocalValue(globalInstructions)
    setIsDirty(false)
  }, [globalInstructions])

  const handleSave = async () => {
    setSaving(true)
    setSetting(SETTINGS_KEYS.GLOBAL_INSTRUCTIONS, localValue)
    setSaving(false)
    setIsDirty(false)
  }

  const handleDiscard = () => {
    setLocalValue(globalInstructions)
    setIsDirty(false)
  }

  const isBusy = isLoading || saving

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">
          Global Instructions
        </label>
        <p className="text-sm text-text-muted mb-2">
          These instructions are injected into every prompt, regardless of project.
        </p>
        <textarea
          value={localValue}
          onChange={(e) => { setLocalValue(e.target.value); setIsDirty(true) }}
          placeholder="Enter global instructions that apply to all projects..."
          className="w-full min-h-80 px-3 py-2 bg-bg-tertiary border border-border rounded text-sm font-mono resize-y focus:outline-none focus:ring-1 focus:ring-accent-primary"
          disabled={isBusy}
        />
      </div>

      {isDirty && <KvCacheWarning />}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={handleDiscard} disabled={!isDirty}>
          Discard
        </Button>
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={!isDirty || isBusy}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
