import { useState, useEffect } from 'react'
import { Modal } from '../shared/Modal'
import { Button } from '../shared/Button'
import { Tooltip } from '../shared/Tooltip'
import { useConfigStore } from '../../stores/config'

function defaultModelSettings(model: ModelConfig): ModelSettings {
  return {
    contextWindow: model.contextWindow,
    temperature: model.temperature ?? null,
    topP: model.topP ?? null,
    topK: model.topK ?? null,
    maxTokens: model.maxTokens ?? null,
    supportsVision: model.supportsVision ?? null,
  }
}

interface ModelConfig {
  id: string
  contextWindow: number
  source: 'backend' | 'user' | 'default'
  temperature?: number
  topP?: number
  topK?: number
  maxTokens?: number
  supportsVision?: boolean
  defaultTemperature?: number
  defaultTopP?: number
  defaultTopK?: number
  defaultMaxTokens?: number
}

interface ModelPropertiesModalProps {
  isOpen: boolean
  onClose: () => void
  providerId: string
  model: ModelConfig
}

interface ModelSettings {
  contextWindow: number
  temperature: number | null
  topP: number | null
  topK: number | null
  maxTokens: number | null
  supportsVision: boolean | null
}

function SettingsGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-text-secondary border-b border-border/50 pb-1">{label}</h4>
      {children}
    </div>
  )
}

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  helpText,
  defaultValue,
  profileDefault,
  tooltip,
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  min: number
  max: number
  step?: number
  helpText?: string
  defaultValue?: number
  profileDefault?: number
  tooltip?: string
}) {
  const [localValue, setLocalValue] = useState(value?.toString() ?? '')
  const [useDefault, setUseDefault] = useState(value === null)

  useEffect(() => {
    setLocalValue(value?.toString() ?? '')
    setUseDefault(value === null)
  }, [value])

  const handleLocalChange = (text: string) => {
    setLocalValue(text)
    if (text === '') {
      onChange(null)
    } else {
      const num = parseFloat(text)
      if (!isNaN(num)) onChange(num)
    }
  }

  const handleToggle = () => {
    if (useDefault) {
      setUseDefault(false)
      if (defaultValue !== undefined) {
        setLocalValue(defaultValue.toString())
        onChange(defaultValue)
      }
    } else {
      setUseDefault(true)
      onChange(null)
    }
  }

  const labelContent = (
    <label className="flex items-center gap-2 text-sm font-medium text-text-secondary mb-1">
      {tooltip && (
        <Tooltip content={tooltip}>
          <span className="inline-flex items-center justify-center w-4 h-4 text-xs text-text-muted hover:text-text-secondary cursor-help rounded-full border border-border/50">
            ?
          </span>
        </Tooltip>
      )}
      {label}
      <button
        type="button"
        onClick={handleToggle}
        className={`text-xs px-1.5 py-0.5 rounded border ${
          useDefault
            ? 'border-accent-primary/50 bg-accent-primary/10 text-accent-primary'
            : 'border-border text-text-muted hover:text-text-secondary'
        }`}
        title={useDefault ? 'Click to set a custom value' : 'Click to use default'}
      >
        {useDefault ? 'default' : 'custom'}
      </button>
    </label>
  )

  return (
    <div>
      {labelContent}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={localValue}
        readOnly={useDefault}
        onChange={(e) => handleLocalChange(e.target.value)}
        onClick={() => useDefault && handleToggle()}
        placeholder={
          useDefault ? `${profileDefault !== undefined ? profileDefault : 'Using default'} (click to edit)` : ''
        }
        className={`w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-text-primary focus:outline-none focus:border-accent-primary ${useDefault ? 'opacity-50 cursor-pointer' : ''}`}
      />
      {helpText && (
        <div className="flex items-center gap-2 mt-1">
          <p className="text-xs text-text-muted">{helpText}</p>
          {profileDefault !== undefined && (
            <span className="text-xs text-text-muted/60">(default: {profileDefault})</span>
          )}
        </div>
      )}
      {!helpText && profileDefault !== undefined && (
        <p className="text-xs text-text-muted mt-1">Profile default: {profileDefault}</p>
      )}
    </div>
  )
}

export function ModelPropertiesModal({ isOpen, onClose, providerId, model }: ModelPropertiesModalProps) {
  const [settings, setSettings] = useState<ModelSettings>(() => defaultModelSettings(model))
  const [saving, setSaving] = useState(false)
  const updateModelSettings = useConfigStore((state) => state.updateModelSettings)

  useEffect(() => {
    setSettings(defaultModelSettings(model))
  }, [model])

  const handleSave = async () => {
    if (settings.contextWindow < 1024 || settings.contextWindow > 10000000) return
    setSaving(true)
    const hasNonContextChanges =
      settings.temperature !== (model.temperature ?? null) ||
      settings.topP !== (model.topP ?? null) ||
      settings.topK !== (model.topK ?? null) ||
      settings.maxTokens !== (model.maxTokens ?? null) ||
      settings.supportsVision !== (model.supportsVision ?? null)

    await updateModelSettings(providerId, model.id, {
      contextWindow: settings.contextWindow,
      ...(hasNonContextChanges && {
        temperature: settings.temperature,
        topP: settings.topP,
        topK: settings.topK,
        maxTokens: settings.maxTokens,
        supportsVision: settings.supportsVision ?? undefined,
      }),
    })
    setSaving(false)
    onClose()
  }

  const handleCancel = () => {
    setSettings(defaultModelSettings(model))
    onClose()
  }

  if (!isOpen) return null

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Model Properties"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={handleCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={saving || settings.contextWindow < 1024 || settings.contextWindow > 10000000}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Model Name</label>
          <p className="text-text-primary bg-bg-tertiary px-3 py-2 rounded font-mono text-sm break-all">{model.id}</p>
        </div>

        <NumberInput
          label="Context Window"
          value={settings.contextWindow}
          onChange={(v) => v !== null && setSettings((s) => ({ ...s, contextWindow: v }))}
          min={1024}
          max={10000000}
          helpText="Range: 1,024 - 10,000,000 tokens"
        />

        <SettingsGroup label="Sampling Parameters">
          <div className="grid grid-cols-2 gap-3">
            <NumberInput
              label="Temperature"
              value={settings.temperature}
              onChange={(v) => setSettings((s) => ({ ...s, temperature: v }))}
              min={0}
              max={2}
              step={0.1}
              helpText="0.0 - 2.0"
              defaultValue={1}
              profileDefault={model.defaultTemperature}
              tooltip="How random the response is. Low (0.1-0.3) = precise and predictable. High (0.7-1.5) = creative and varied."
            />
            <NumberInput
              label="Top P"
              value={settings.topP}
              onChange={(v) => setSettings((s) => ({ ...s, topP: v }))}
              min={0}
              max={1}
              step={0.05}
              helpText="0.0 - 1.0"
              defaultValue={1}
              profileDefault={model.defaultTopP}
              tooltip="How to pick the next word. Low (0.5-0.8) = stick to obvious choices. High (0.95-1.0) = allow surprising words."
            />
          </div>
          <NumberInput
            label="Top K"
            value={settings.topK}
            onChange={(v) => setSettings((s) => ({ ...s, topK: v }))}
            min={1}
            max={200}
            helpText="1 - 200 (leave as default if not supported)"
            profileDefault={model.defaultTopK}
            tooltip="Restricts word choices to the top K most likely ones. Low (10-20) = focused. High (50-200) = diverse. Not all backends support this."
          />
        </SettingsGroup>

        <NumberInput
          label="Max Tokens"
          value={settings.maxTokens}
          onChange={(v) => setSettings((s) => ({ ...s, maxTokens: v }))}
          min={256}
          max={32000}
          helpText="Maximum tokens to generate per response"
          profileDefault={model.defaultMaxTokens}
          tooltip="Longest response length. Higher values let the model write more, but use up your context window faster."
        />

        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-text-secondary mb-1">
            <input
              type="checkbox"
              checked={settings.supportsVision ?? false}
              onChange={(e) => setSettings((s) => ({ ...s, supportsVision: e.target.checked }))}
              className="rounded border-border bg-bg-tertiary text-accent-primary focus:ring-accent-primary focus:ring-offset-0"
            />
            Vision Enabled
          </label>
          <p className="text-xs text-text-muted">
            Allow sending images directly to this model. Disable if the model doesn't support vision.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Source</label>
          <p className="text-text-primary bg-bg-tertiary px-3 py-2 rounded text-sm">
            {model.source === 'backend' && 'Auto-detected from backend'}
            {model.source === 'user' && 'Manually set'}
            {model.source === 'default' && 'Default value'}
          </p>
        </div>
      </div>
    </Modal>
  )
}
