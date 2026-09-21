import { useState, useEffect } from 'react'
import { Button } from '../../shared/Button'
import { useT } from '../../../hooks/useT'
import { SETTINGS_KEYS, setSetting } from '../../../lib/resources'
import { useSetting } from '../../../hooks/useSetting'

const LANGUAGE_TO_VALUE: Record<string, string> = {
  automatic: 'automatic',
  english: 'English',
  french: 'French',
}

function resolvePreset(value: string): string {
  const lower = value.trim().toLowerCase()
  if (lower === '' || lower === 'automatic') return 'automatic'
  if (lower === 'english') return 'english'
  if (lower === 'french') return 'french'
  return 'other'
}

function resolveCustom(value: string): string {
  return resolvePreset(value) === 'other' ? value : ''
}

function normalizeCustom(value: string): string {
  const trimmed = value.trim()
  const lower = trimmed.toLowerCase()
  if (lower === 'english') return 'English'
  if (lower === 'french') return 'French'
  return trimmed
}

function computeSaveValue(preset: string, custom: string, current: string): string {
  if (preset === 'other') {
    const trimmed = custom.trim()
    return trimmed === '' ? current : normalizeCustom(custom)
  }
  return LANGUAGE_TO_VALUE[preset] ?? current
}

export function InstructionsTab() {
  const t = useT()
  const { value: globalInstructions, loading } = useSetting(SETTINGS_KEYS.GLOBAL_INSTRUCTIONS)
  const { value: language, loading: languageLoading } = useSetting(SETTINGS_KEYS.LANGUAGE, 'automatic')

  const [localValue, setLocalValue] = useState(globalInstructions)
  const [preset, setPreset] = useState(() => resolvePreset(language))
  const [customLanguage, setCustomLanguage] = useState(() => resolveCustom(language))
  const [saving, setSaving] = useState(false)

  const isLoading = loading || languageLoading

  useEffect(() => {
    setLocalValue(globalInstructions)
    setPreset(resolvePreset(language))
    setCustomLanguage(resolveCustom(language))
  }, [globalInstructions, language])

  const isDirty = localValue !== globalInstructions || computeSaveValue(preset, customLanguage, language) !== language

  const handleSave = async () => {
    setSaving(true)
    await setSetting(SETTINGS_KEYS.GLOBAL_INSTRUCTIONS, localValue)
    await setSetting(SETTINGS_KEYS.LANGUAGE, computeSaveValue(preset, customLanguage, language))
    setSaving(false)
  }

  const handleDiscard = () => {
    setLocalValue(globalInstructions)
    setPreset(resolvePreset(language))
    setCustomLanguage(resolveCustom(language))
  }

  const isBusy = isLoading || saving

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">
          {t({ en: 'Language', fr: 'Langue' })}
        </label>
        <p className="text-sm text-text-muted mb-2">
          {t({
            en: 'In what language should the agent talk to you?',
            fr: 'Dans quelle langue l’agent doit-il s’adresser à vous ?',
          })}
        </p>
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
          disabled={isBusy}
        >
          <option value="automatic">{t({ en: 'Automatic', fr: 'Automatique' })}</option>
          <option value="english">{t({ en: 'English', fr: 'Anglais' })}</option>
          <option value="french">{t({ en: 'French', fr: 'Français' })}</option>
          <option value="other">{t({ en: 'Other', fr: 'Autre' })}</option>
        </select>
        {preset === 'other' && (
          <input
            type="text"
            value={customLanguage}
            onChange={(e) => setCustomLanguage(e.target.value)}
            placeholder={t({ en: 'e.g. German, Spanish, Japanese...', fr: 'ex. allemand, espagnol, japonais…' })}
            className="w-full mt-2 px-3 py-2 text-sm bg-bg-tertiary border border-border rounded text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
            disabled={isBusy}
          />
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">
          {t({ en: 'Global Instructions', fr: 'Instructions globales' })}
        </label>
        <p className="text-sm text-text-muted mb-2">
          {t({
            en: 'These instructions are injected into every prompt, regardless of project.',
            fr: 'Ces instructions sont injectées dans chaque prompt, quel que soit le projet.',
          })}
        </p>
        <textarea
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          placeholder={t({
            en: 'Enter global instructions that apply to all projects...',
            fr: 'Saisissez des instructions globales applicables à tous les projets…',
          })}
          className="w-full min-h-80 px-3 py-2 bg-bg-tertiary border border-border rounded text-sm font-mono resize-y focus:outline-none focus:ring-1 focus:ring-accent-primary"
          disabled={isBusy}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={handleDiscard} disabled={!isDirty}>
          {t({ en: 'Discard', fr: 'Annuler' })}
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={!isDirty || isBusy}>
          {saving ? t({ en: 'Saving...', fr: 'Enregistrement…' }) : t({ en: 'Save', fr: 'Enregistrer' })}
        </Button>
      </div>
    </div>
  )
}
