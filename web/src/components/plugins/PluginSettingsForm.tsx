import { useEffect, useState } from 'react'
import { useResource } from '../../hooks/useResource'
import { useT } from '../../hooks/useT'
import { useLocalizedString } from '../../hooks/useLocalizedString'
import { pluginSettingsResource } from '../../lib/resources'
import { savePluginSettings } from '../../lib/plugin-actions'
import { Button } from '../shared/Button'
import { Toggle } from '../shared/Toggle'
import type { PluginSettingsField, PluginSettingScope, PluginSettingValue } from '@shared/plugin.js'
type FormValues = Record<string, PluginSettingValue | string>

const FIELD_CLASS = 'w-full px-2 py-1.5 text-sm text-text-primary bg-bg-tertiary border border-border rounded'

function FieldInput({
  id,
  value,
  onChange,
  multiline,
  type,
  placeholder,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  multiline?: boolean
  type?: string
  placeholder?: string
}) {
  if (multiline) {
    return (
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        className={FIELD_CLASS}
      />
    )
  }
  return (
    <input
      id={id}
      type={type ?? 'text'}
      value={value}
      placeholder={placeholder ?? ''}
      onChange={(event) => onChange(event.target.value)}
      className={FIELD_CLASS}
    />
  )
}

function initialValue(
  field: PluginSettingsField,
  values: Record<string, unknown>,
  secretsSet: string[],
): FormValues[string] {
  const stored = values[field.key]
  if (field.type === 'boolean') return typeof stored === 'boolean' ? stored : ((field.default as boolean) ?? false)
  if (field.type === 'number') return typeof stored === 'number' ? stored : ((field.default as number) ?? '')
  if (typeof stored === 'string') return stored
  if (secretsSet.includes(field.key)) return ''
  return (field.default as string) ?? ''
}

export function PluginSettingsForm({
  pluginId,
  scope: initialScope = 'global',
  projectId,
}: {
  pluginId: string
  scope?: PluginSettingScope
  projectId?: string
}) {
  const t = useT()
  const localize = useLocalizedString()
  const [scope, setScope] = useState<PluginSettingScope>(initialScope)
  const { data } = useResource(pluginSettingsResource, pluginId, scope, projectId)
  const [values, setValues] = useState<FormValues>({})
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!data) return
    const next: FormValues = {}
    for (const field of data.schema.fields) next[field.key] = initialValue(field, data.values, data.secretsSet)
    setValues(next)
  }, [data])

  if (!data) {
    return <p className="text-sm text-text-muted">{t({ en: 'Loading settings…', fr: 'Chargement des paramètres…' })}</p>
  }

  const projectScoped = projectId !== undefined && data.schema.fields.some((field) => field.scope === 'project')

  const handleSave = async () => {
    const payload: Record<string, unknown> = {}
    for (const field of data.schema.fields) {
      const value = values[field.key]
      if (field.secret && (value === '' || value === undefined)) continue
      if (field.type === 'number' && value === '') continue
      payload[field.key] = value
    }
    const result = await savePluginSettings(pluginId, payload, scope, projectId)
    if (!result.ok) {
      setError(result.error ?? t({ en: 'Failed to save settings', fr: 'Échec de l’enregistrement des paramètres' }))
      return
    }
    setError(null)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="flex flex-col gap-4">
      {projectScoped ? (
        <div>
          <label className="block text-xs text-text-secondary mb-1" htmlFor="plugin-setting-scope">
            {t({ en: 'Applies to', fr: 'S’applique à' })}
          </label>
          <select
            id="plugin-setting-scope"
            value={scope}
            onChange={(event) => setScope(event.target.value as PluginSettingScope)}
            className={FIELD_CLASS}
          >
            <option value="global">{t({ en: 'All projects', fr: 'Tous les projets' })}</option>
            <option value="project">{t({ en: 'This project', fr: 'Ce projet' })}</option>
          </select>
        </div>
      ) : null}
      {data.schema.fields.map((field) => {
        const label = localize(field.label)
        const description = field.description ? localize(field.description) : undefined
        const value = values[field.key]
        return (
          <div key={field.key}>
            <label className="block text-xs text-text-secondary mb-1" htmlFor={`plugin-setting-${field.key}`}>
              {label}
            </label>
            {field.type === 'boolean' ? (
              <Toggle
                enabled={value === true}
                onClick={() => setValues((state) => ({ ...state, [field.key]: !(state[field.key] === true) }))}
              />
            ) : field.type === 'select' ? (
              <select
                id={`plugin-setting-${field.key}`}
                value={String(value ?? '')}
                onChange={(event) => setValues((state) => ({ ...state, [field.key]: event.target.value }))}
                className={FIELD_CLASS}
              >
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {localize(option.label)}
                  </option>
                ))}
              </select>
            ) : field.type === 'textarea' ? (
              <FieldInput
                id={`plugin-setting-${field.key}`}
                value={String(value ?? '')}
                onChange={(next) => setValues((state) => ({ ...state, [field.key]: next }))}
                multiline
              />
            ) : (
              <FieldInput
                id={`plugin-setting-${field.key}`}
                value={String(value ?? '')}
                onChange={(next) =>
                  setValues((state) => ({
                    ...state,
                    [field.key]: field.type === 'number' ? (next === '' ? '' : Number(next)) : next,
                  }))
                }
                type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
                {...(field.placeholder ? { placeholder: field.placeholder } : {})}
              />
            )}
            {description ? <p className="mt-1 text-xs text-text-muted">{description}</p> : null}
          </div>
        )
      })}
      {error ? <p className="text-xs text-accent-error">{error}</p> : null}
      <div className="flex justify-end">
        <Button variant="primary" size="sm" onClick={() => void handleSave()}>
          {saved ? t({ en: 'Saved', fr: 'Enregistré' }) : t({ en: 'Save', fr: 'Enregistrer' })}
        </Button>
      </div>
    </div>
  )
}
