import { useState, useEffect, useCallback } from 'react'
import { authFetch } from '../../lib/api'
import { useT } from '../../hooks/useT'
import { Modal } from '../shared/Modal'
import { Button } from '../shared/Button'
import type { PluginSettingField, PluginSettingsSpec } from '../../lib/pluginSettings'

export interface PluginSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  pluginName: string
  pluginDisplayName: string
}

export function PluginSettingsModal({ isOpen, onClose, pluginName, pluginDisplayName }: PluginSettingsModalProps) {
  const t = useT()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [spec, setSpec] = useState<PluginSettingsSpec | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [configuredKeys, setConfiguredKeys] = useState<string[]>([])
  const [rawJson, setRawJson] = useState<string>('{}')

  const fetchSettings = useCallback(async () => {
    if (!isOpen || !pluginName) return
    setLoading(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const res = await authFetch(`/api/plugins/${encodeURIComponent(pluginName)}/settings`)
      if (!res.ok) {
        throw new Error(
          t(
            {
              en: 'Failed to load settings (HTTP {{status}})',
              fr: 'Échec du chargement des paramètres (HTTP {{status}})',
            },
            { status: String(res.status) },
          ),
        )
      }
      const data = (await res.json()) as {
        hasSpec: boolean
        spec: PluginSettingsSpec | null
        values: Record<string, unknown>
        configuredKeys?: string[]
      }
      setSpec(data.spec)
      setValues(data.values ?? {})
      setConfiguredKeys(data.configuredKeys ?? [])
      setRawJson(JSON.stringify(data.values ?? {}, null, 2))
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t({ en: 'Error loading plugin settings', fr: 'Erreur lors du chargement des paramètres du plugin' }),
      )
    } finally {
      setLoading(false)
    }
  }, [isOpen, pluginName, t])

  useEffect(() => {
    if (isOpen) {
      fetchSettings()
    }
  }, [isOpen, fetchSettings])

  const handleFieldValueChange = (key: string, val: unknown) => {
    setValues((prev) => ({ ...prev, [key]: val }))
  }

  const validateRequired = (): string | null => {
    if (!spec?.fields) return null
    for (const field of spec.fields) {
      if (!field.required) continue
      const v = values[field.key]
      if (field.type === 'password') {
        const hasNew = v !== undefined && v !== null && v !== ''
        const hasExisting = configuredKeys.includes(field.key)
        if (!hasNew && !hasExisting) {
          return t({ en: '{{label}} is required', fr: '{{label}} est requis' }, { label: field.label })
        }
      } else if (field.type === 'boolean') {
        if (typeof v !== 'boolean' && v !== true && v !== false) {
          return t({ en: '{{label}} is required', fr: '{{label}} est requis' }, { label: field.label })
        }
      } else if (v === undefined || v === null || v === '') {
        return t({ en: '{{label}} is required', fr: '{{label}} est requis' }, { label: field.label })
      }
    }
    return null
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccessMsg(null)
    try {
      let payloadValues = values
      if (!spec?.fields || spec.fields.length === 0) {
        try {
          payloadValues = JSON.parse(rawJson)
        } catch {
          throw new Error(t({ en: 'Invalid JSON settings format', fr: 'Format JSON des paramètres invalide' }))
        }
      } else {
        const requiredError = validateRequired()
        if (requiredError) throw new Error(requiredError)
      }

      const res = await authFetch(`/api/plugins/${encodeURIComponent(pluginName)}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: payloadValues }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(
          data.error ?? t({ en: 'Failed to save settings', fr: 'Échec de l’enregistrement des paramètres' }),
        )
      }
      setValues(payloadValues)
      const newConfigured = [...configuredKeys]
      if (spec?.fields) {
        for (const field of spec.fields) {
          if (field.type === 'password' && payloadValues[field.key]) {
            if (!newConfigured.includes(field.key)) newConfigured.push(field.key)
          }
        }
      }
      setConfiguredKeys(newConfigured)
      setSuccessMsg(t({ en: 'Settings saved successfully!', fr: 'Paramètres enregistrés avec succès !' }))
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t({ en: 'Failed to save settings', fr: 'Échec de l’enregistrement des paramètres' }),
      )
    } finally {
      setSaving(false)
    }
  }

  const renderField = (field: PluginSettingField) => {
    const val = values[field.key] ?? field.defaultValue ?? ''

    switch (field.type) {
      case 'boolean':
        return (
          <label className="flex items-center gap-2 cursor-pointer mt-1">
            <input
              type="checkbox"
              checked={Boolean(val)}
              onChange={(e) => handleFieldValueChange(field.key, e.target.checked)}
              className="rounded bg-bg-tertiary border-border text-accent-primary focus:ring-accent-primary"
            />
            <span className="text-sm text-text-primary font-medium">{field.label}</span>
          </label>
        )
      case 'select':
        return (
          <div>
            <label className="text-xs font-medium text-text-primary block mb-1">
              {field.label} {field.required && <span className="text-accent-error">*</span>}
            </label>
            <select
              value={String(val)}
              onChange={(e) => handleFieldValueChange(field.key, e.target.value)}
              className="w-full px-3 py-1.5 text-sm text-text-primary bg-bg-tertiary border border-border rounded focus:outline-none focus:border-accent-primary"
            >
              {field.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )
      case 'textarea':
        return (
          <div>
            <label className="text-xs font-medium text-text-primary block mb-1">
              {field.label} {field.required && <span className="text-accent-error">*</span>}
            </label>
            <textarea
              rows={3}
              value={String(val)}
              placeholder={field.placeholder}
              onChange={(e) => handleFieldValueChange(field.key, e.target.value)}
              className="w-full px-3 py-1.5 text-sm text-text-primary bg-bg-tertiary border border-border rounded focus:outline-none focus:border-accent-primary"
            />
          </div>
        )
      case 'number':
        return (
          <div>
            <label className="text-xs font-medium text-text-primary block mb-1">
              {field.label} {field.required && <span className="text-accent-error">*</span>}
            </label>
            <input
              type="number"
              value={val === '' ? '' : Number(val)}
              placeholder={field.placeholder}
              onChange={(e) => handleFieldValueChange(field.key, e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full px-3 py-1.5 text-sm text-text-primary bg-bg-tertiary border border-border rounded focus:outline-none focus:border-accent-primary"
            />
          </div>
        )
      case 'password': {
        const isConfigured = configuredKeys.includes(field.key)
        return (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor={`field-${field.key}`} className="text-xs font-medium text-text-primary block">
                {field.label} {field.required && <span className="text-accent-error">*</span>}
              </label>
              {isConfigured && !val && (
                <span className="text-xs text-text-muted">{t({ en: '(configured)', fr: '(configuré)' })}</span>
              )}
            </div>
            <input
              id={`field-${field.key}`}
              type="password"
              value={String(val)}
              placeholder={
                isConfigured && !val
                  ? t({ en: '•••••••• (leave blank to keep current)', fr: '•••••••• (laisser vide pour conserver)' })
                  : field.placeholder
              }
              onChange={(e) => handleFieldValueChange(field.key, e.target.value)}
              className="w-full px-3 py-1.5 text-sm text-text-primary bg-bg-tertiary border border-border rounded focus:outline-none focus:border-accent-primary"
            />
          </div>
        )
      }
      case 'text':
      default:
        return (
          <div>
            <label className="text-xs font-medium text-text-primary block mb-1">
              {field.label} {field.required && <span className="text-accent-error">*</span>}
            </label>
            <input
              type="text"
              value={String(val)}
              placeholder={field.placeholder}
              onChange={(e) => handleFieldValueChange(field.key, e.target.value)}
              className="w-full px-3 py-1.5 text-sm text-text-primary bg-bg-tertiary border border-border rounded focus:outline-none focus:border-accent-primary"
            />
          </div>
        )
    }
  }

  const title = spec?.title ?? t({ en: '{{name}} Settings', fr: 'Paramètres de {{name}}' }, { name: pluginDisplayName })

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {successMsg ? t({ en: 'Close', fr: 'Fermer' }) : t({ en: 'Cancel', fr: 'Annuler' })}
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving || loading}>
            {saving
              ? t({ en: 'Saving…', fr: 'Enregistrement…' })
              : t({ en: 'Save Settings', fr: 'Enregistrer les paramètres' })}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 p-1">
        {error && (
          <div className="text-sm text-accent-error bg-accent-error/10 border border-accent-error/30 rounded p-2.5">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="text-sm text-accent-success bg-accent-success/10 border border-accent-success/30 rounded p-2.5">
            {successMsg}
          </div>
        )}

        {loading ? (
          <div className="text-sm text-text-muted py-4">
            {t({ en: 'Loading settings…', fr: 'Chargement des paramètres…' })}
          </div>
        ) : spec?.customUiUrl ? (
          <div className="w-full h-80 border border-border rounded overflow-hidden">
            <iframe
              src={spec.customUiUrl}
              title={t(
                { en: '{{name}} Custom UI', fr: 'Interface personnalisée de {{name}}' },
                { name: pluginDisplayName },
              )}
              className="w-full h-full border-none"
            />
          </div>
        ) : spec?.fields && spec.fields.length > 0 ? (
          <div className="space-y-3">
            {spec.description && <p className="text-xs text-text-muted mb-2">{spec.description}</p>}
            {spec.fields.map((field) => (
              <div key={field.key} className="space-y-1">
                {renderField(field)}
                {field.description && field.type !== 'boolean' && (
                  <p className="text-xs text-text-muted">{field.description}</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-text-muted">
              {t(
                {
                  en: 'Configure JSON settings for {{name}}:',
                  fr: 'Configurer les paramètres JSON pour {{name}} :',
                },
                { name: pluginDisplayName },
              )}
            </p>
            <textarea
              rows={8}
              value={rawJson}
              onChange={(e) => setRawJson(e.target.value)}
              className="w-full font-mono text-xs px-3 py-2 text-text-primary bg-bg-tertiary border border-border rounded focus:outline-none focus:border-accent-primary"
            />
          </div>
        )}
      </div>
    </Modal>
  )
}
